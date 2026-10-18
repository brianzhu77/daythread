import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { closeHistory, isHistoryTransaction, undo as historyUndo, redo as historyRedo } from '@tiptap/pm/history'
import { BlockNoteSchema, blockToNode, defaultBlockSpecs, docToBlocks, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import { toast } from '@heroui/react'
import { BasicTextStyleButton, BlockTypeSelect, CreateLinkButton, createReactBlockSpec, FormattingToolbar, FormattingToolbarController, getDefaultReactSlashMenuItems, SideMenu, SuggestionMenuController, SideMenuController, useBlockNoteEditor, useComponentsContext, useCreateBlockNote, useExtensionState } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { offset } from '@floating-ui/react'
import '@blocknote/shadcn/style.css'
import type { Page, Task, Workspace } from '../domain/types'
import { editorSeed, inlineText, needsTemplateRows, pageContentKey, sectionRange, type EditorNode } from '../domain/editor-document'
import { applyCommand } from '../domain/workspace'
import { newOperationId, useWorkspace } from './use-day'
import { debugClient } from '../lib/debug'
import { DateTag } from './date-tag'
import { CheckboxIcon, GripIcon, PlusIcon, RedoIcon, UndoIcon } from './icons'
import { addDays, fromIso, todayIso } from './dates'
import { tagDecorations } from './tag-decorations'

const task = createReactBlockSpec({ type: 'task', propSchema: { taskId: { default: '' }, role: { default: 'reference' }, planDate: { default: '' } }, content: 'inline' }, {
  toExternalHTML: ({ contentRef }) => <p ref={contentRef} />,
  render: ({ block, contentRef }) => <EditorTask taskId={block.props.taskId} role={block.props.role} planDate={block.props.planDate} contentRef={contentRef} />,
})()
const sourceChecklist = createReactBlockSpec({ type: 'sourceChecklist', propSchema: { checked: { default: false } }, content: 'inline' }, {
  render: ({ block, contentRef, editor }) => <div className="editor-source-checklist"><input contentEditable={false} type="checkbox" aria-label="Check imported item" checked={block.props.checked} onChange={() => editor.updateBlock(block, { props: { checked: !block.props.checked } })} /><span ref={contentRef} /></div>,
  toExternalHTML: ({ block, contentRef }) => <p><span>{block.props.checked ? '☑ ' : '☐ '}</span><span ref={contentRef} /></p>,
})()
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, task, sourceChecklist } })
const clipboardType = 'application/x-daythread-blocks'
const cutTokens = new Set<string>()
const deepNodes = (nodes: readonly EditorNode[]): EditorNode[] => nodes.flatMap(n => [n, ...deepNodes(n.children ?? [])])
const checklistIds = (nodes: readonly EditorNode[]): string[] => deepNodes(nodes).filter(n => n.type === 'sourceChecklist' && n.props?.checked !== true).map(n => n.id)
function EditorTask({ taskId, role, planDate, contentRef }: { taskId: string; role: string; planDate: string; contentRef: (node: HTMLElement | null) => void }) {
  const { workspace, run } = useWorkspace()
  const t = workspace?.tasks.find(t => t.id === taskId)
  return <div className="editor-task" data-role={role} data-draft={t ? undefined : true}>
    <input contentEditable={false} type="checkbox" aria-label={t ? `Complete ${t.title}` : taskId.startsWith('editor-task:') ? 'New task' : 'Missing task'} checked={t?.status === 'done'} disabled={!t && !taskId.startsWith('editor-task:')} onChange={() => t && void run({ type: 'task-status', taskId, status: t.status === 'done' ? 'open' : 'done' }, r => ({ text: t.status === 'done' ? 'Task reopened' : 'Task completed', undoOperationId: r.operationId }))} />
    <span ref={contentRef} className={`editor-task-title ${t?.status === 'done' ? 'task-done' : ''}`} data-placeholder="To do" />
    {role === 'reference' && <span contentEditable={false} className="editor-reference-tag">Reference</span>}
    {role === 'reference' && t?.status === 'open' && <button className="editor-plan-action" contentEditable={false} onClick={() => void run({ type: 'plan-task', taskId, date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) }, r => ({ text: 'Planned for today', undoOperationId: r.operationId }))}>Plan for today</button>}
    {t && t.status === 'open' && hasDateFacts(t) && <span contentEditable={false} className="editor-date-tag"><DateTag task={t} today={todayIso()} pageDate={planDate || todayIso()} /></span>}
  </div>
}

// Inside a document only real dates earn a chip; "Unscheduled" is list-screen vocabulary and would be noise here.
function hasDateFacts(task: Task): boolean {
  return Boolean(task.deadlineOn || task.attentionOn)
}

const touchHandleSize = 44
// Viewport y of the middle of a block's first line of text. Works for empty blocks and wrapped text alike,
// since it reads the line box of the inline content rather than the rendered glyphs.
function firstLineCenter(block: HTMLElement): number {
  const inline = block.querySelector<HTMLElement>('.bn-inline-content') ?? block
  const style = getComputedStyle(inline)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2
  return inline.getBoundingClientRect().top + lineHeight / 2
}

export function PageEditor({ page, workspace }: { page: Page; workspace: Workspace }) {
  const { run, refresh } = useWorkspace()
  const key = `daythread:editor:${page.id}`
  const initial = useRef<{ nodes: EditorNode[]; base: string; recovered: boolean } | null>(null)
  if (!initial.current) {
    const base = pageContentKey(page)
    let nodes = editorSeed(page, workspace, { templateRows: needsTemplateRows(page, todayIso()) }), recovered = false, savedBase = base
    try { const stored = JSON.parse(localStorage.getItem(key) ?? 'null'); if (stored?.document) { nodes = JSON.parse(stored.document); savedBase = stored.base; recovered = true } } catch { /* fresh document */ }
    initial.current = { nodes, base: savedBase, recovered }
  }
  const [pastedChecklistIds, setPastedChecklistIds] = useState<string[]>(() => checklistIds(initial.current!.nodes))
  // The blocks the handle press picked; the drop handler moves exactly these.
  const pickedIds = useRef<string[]>([])
  const extendedIds = useRef<string[]>([])
  const latestPage = useRef(page); latestPage.current = page
  // Event and link rows keep their own kind on the page; the tag index reads only paragraph and task text.
  const tagCounts = useCallback((id: string) => { const kind = latestPage.current.sections.flatMap(s => s.blocks).find(b => b.id === id)?.kind; return !kind || kind === 'paragraph' || kind === 'task' }, [])
  const editor = useCreateBlockNote({ schema, extensions: [tagDecorations(tagCounts)], dropCursor: { color: 'var(--bn-brand)', width: 3 }, placeholders: { default: 'Write…', emptyDocument: 'Write…', bulletListItem: '' }, pasteHandler: ({ event, editor, defaultPasteHandler }) => {
    const data = event.clipboardData
    if (!data) return defaultPasteHandler()
    const insert = (blocks: EditorNode[]) => {
      // ProseMirror fits a block slice at the actual selection, preserving both sides of a split paragraph.
      // Building the nodes directly also keeps each new Task's block ID and derived Task ID together.
      const view = editor.prosemirrorView
      const content = Fragment.fromArray(blocks.map(block => blockToNode(block as never, view.state.schema)))
      view.dispatch(closeHistory(view.state.tr).replaceSelection(new Slice(content, 0, 0)).scrollIntoView())
    }
    const internal = data.getData(clipboardType)
    if (internal) {
      try {
        const payload = JSON.parse(internal)
        if (!Array.isArray(payload.blocks)) return defaultPasteHandler()
        const moving = payload.cut && (cutTokens.has(payload.token) || localStorage.getItem(`daythread:cut:${payload.token}`) === JSON.stringify(payload.blocks))
        const fresh = (node: EditorNode): EditorNode => {
          const id = crypto.randomUUID()
          return { ...node, id, ...(node.type === 'task' ? { props: moving && latestWorkspace.current.tasks.some(t => t.id === node.props?.taskId) ? node.props : { taskId: `editor-task:${id}`, role: 'reference', planDate: '' } } : {}), ...(node.children ? { children: node.children.map(fresh) } : {}) }
        }
        insert(payload.blocks.map(fresh))
        if (payload.cut) { cutTokens.delete(payload.token); localStorage.removeItem(`daythread:cut:${payload.token}`) }
        return true
      } catch { setStatus('Could not paste these blocks · clipboard kept'); return true }
    }
    const html = data.getData('text/html')
    const text = data.getData('text/markdown') || data.getData('text/plain')
    // Parse external checklists before the normal typed-[] conversion can create Tasks.
    if (html || /^\s*(?:[-*+]\s+)?\[[ xX]\]/m.test(text)) {
      const blocks = (html ? editor.tryParseHTMLToBlocks(html) : editor.tryParseMarkdownToBlocks(text.replace(/^(\s*)(\[[ xX]\])/gm, '$1- $2'))) as unknown as EditorNode[]
      const ids: string[] = []
      let hasChecklist = false
      const protect = (node: EditorNode): EditorNode => {
        const id = crypto.randomUUID()
        if (node.type === 'checkListItem') { hasChecklist = true; if (!node.props?.checked) ids.push(id); return { ...node, id, type: 'sourceChecklist', props: { checked: Boolean(node.props?.checked) }, children: node.children?.map(protect) } }
        if (node.type === 'task') return { id, type: 'paragraph', content: node.content, children: node.children?.map(protect) }
        return { ...node, id, children: node.children?.map(protect) }
      }
      const safe = blocks.map(protect)
      if (hasChecklist) {
        insert(safe)
        setPastedChecklistIds(ids)
        return true
      }
    }
    return defaultPasteHandler()
  }, initialContent: (initial.current.nodes.length ? initial.current.nodes : [{ type: 'paragraph' }]) as never })
  const base = useRef(initial.current.base)
  const latestWorkspace = useRef(workspace); latestWorkspace.current = workspace
  const dirty = useRef(initial.current.recovered)
  const sending = useRef(false)
  const historyPending = useRef(false)
  const historyGuardBypass = useRef(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const lastSent = useRef('')
  const knownSemantic = useRef(new Set<string>())
  const expectedTaskVersions = useRef(new Map(workspace.tasks.map(t => [t.id, t.version])))
  const invalidHistoryTasks = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppress = useRef(false)
  const semanticDeletes = useRef(new Set<string>())
  const composing = useRef(false)
  const selected = useRef<string[]>([])
  const dragging = useRef<EditorNode[]>([])
  const [status, setStatus] = useState(initial.current.recovered ? 'Recovered unsaved draft' : '')
  const [failed, setFailed] = useState(initial.current.recovered)
  const [drop, setDrop] = useState<{ id: string; end: boolean; top: number } | null>(null)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 899px)').matches)
  useEffect(() => { const media = window.matchMedia('(max-width: 899px)'); const update = () => setCompact(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  const [touchHandle, setTouchHandle] = useState<{ id: string; top: number } | null>(null)
  const [touchDragging, setTouchDragging] = useState(false)
  const dropRef = useRef<typeof drop>(null)
  // Edit notices ("Deleted 'Notes' · Undo") are HeroUI toasts. Undo only applies while the document is still the
  // one the notice describes; any later edit retires the notice.
  const notice = useRef<{ key: string; fingerprint: string } | null>(null)
  const closeNotice = () => { if (notice.current) toast.close(notice.current.key); notice.current = null }
  const setNotice = ({ text, fingerprint }: { text: string; fingerprint: string }) => {
    closeNotice()
    const key = toast(text, {
      timeout: 8000,
      actionProps: { children: 'Undo', onPress: () => { if (notice.current?.key === key && fingerprint === JSON.stringify(editor.document)) void performHistory('undo'); closeNotice() } },
      onClose: () => { if (notice.current?.key === key) notice.current = null },
    })
    notice.current = { key, fingerprint }
  }
  const [selectionLabel, setSelectionLabel] = useState('')
  const selectionFocus = useRef<HTMLDivElement>(null)
  // Browser selection can survive React node-view replacement while ProseMirror's selection moves elsewhere.
  // Keep stable block IDs and inline offsets instead of positions tied to the replaced document.
  function browserSelection() {
    const dom = window.getSelection(), view = editor.prosemirrorView
    if (!dom) return null
    const point = (node: Node | null, offset: number) => {
      if (!node || !view.dom.contains(node)) return null
      const el = node instanceof Element ? node : node.parentElement
      const inline = el?.closest('.bn-inline-content, .editor-task-title')
      const id = el?.closest('[data-node-type="blockContainer"]')?.getAttribute('data-id')
      if (!inline || !id || el?.closest('[contenteditable="false"]')) return null
      const range = document.createRange(); range.selectNodeContents(inline); range.setEnd(node, offset)
      return { id, offset: range.toString().length }
    }
    const anchor = point(dom.anchorNode, dom.anchorOffset), head = point(dom.focusNode, dom.focusOffset)
    return anchor && head ? { anchor, head } : null
  }
  function restoreBrowserSelection(saved: ReturnType<typeof browserSelection>) {
    if (!saved) return
    const view = editor.prosemirrorView
    const position = (point: { id: string; offset: number }) => {
      let result: number | null = null
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'blockContainer' && node.attrs.id === point.id && node.firstChild?.inlineContent) result = pos + 2 + Math.min(point.offset, node.firstChild.content.size)
      })
      return result
    }
    const anchor = position(saved.anchor), head = position(saved.head)
    if (anchor === null || head === null || view.state.selection.anchor === anchor && view.state.selection.head === head) return
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
  }
  const nodes = () => editor.document as unknown as EditorNode[]
  const insertionRole = (blockId: string) => {
    const preceding = nodes().slice(0, nodes().findIndex(n => n.id === blockId) + 1).reverse().find(n => n.type === 'heading')
    const section = latestPage.current.sections.find(s => s.id === preceding?.id)
    return latestPage.current.date && (section?.kind === 'top3' || section?.kind === 'other') ? 'plan' : 'reference'
  }
  const stash = () => { try { localStorage.setItem(key, JSON.stringify({ base: base.current, document: JSON.stringify(nodes()) })) } catch { setStatus('Draft stays in this tab; browser recovery storage unavailable') } }
  const flushRef = useRef<() => Promise<void>>(async () => {})
  const pendingSave = useRef<{ fingerprint: string; operationId: string } | null>(null)
  const flush = useCallback(async () => {
    if (!dirty.current || sending.current) return
    sending.current = true
    const document = JSON.stringify(editor.document)
    const deletions = [...semanticDeletes.current]
    lastSent.current = document
    setStatus('Saving…')
    const action = { type: 'save-editor' as const, pageId: page.id, expectedContent: base.current, document, singleDeleteIds: deletions, today: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) }
    const fingerprint=JSON.stringify(action)
    if (pendingSave.current?.fingerprint !== fingerprint) pendingSave.current={fingerprint,operationId:newOperationId()}
    const operationId=pendingSave.current!.operationId
    debugClient('editor.save.start',{operationId,pageId:page.id,beforeRevision:latestWorkspace.current.revision})
    const source = latestWorkspace.current
    let preview: Workspace
    try { preview = applyCommand(source, { operationId, expectedRevision: source.revision, action }).workspace }
    catch (error) { debugClient('editor.save.rejected',{operationId,pageId:page.id,result:'conflict',error:error instanceof Error?error.name:'UnknownError'}); sending.current = false; setFailed(true); setStatus(error instanceof Error ? error.message : 'Cannot save; draft kept'); return }
    const result = await run(action,undefined,operationId)
    sending.current = false
    if (!result) { debugClient('editor.save.finish',{operationId,pageId:page.id,result:'error'}); setFailed(true); setStatus('Not saved · your draft is kept on this device'); return }
    pendingSave.current=null
    debugClient('editor.save.finish',{operationId,pageId:page.id,afterRevision:preview.revision,result:'saved'})
    for (const t of source.tasks) if (expectedTaskVersions.current.get(t.id) !== t.version) invalidHistoryTasks.current.add(t.id)
    for (const t of preview.tasks) if (source.tasks.find(old => old.id === t.id)?.version !== t.version) expectedTaskVersions.current.set(t.id, t.version)
    const savedPage = preview.pages.find(p => p.id === page.id)!
    base.current = pageContentKey(savedPage)
    deletions.forEach(id => { semanticDeletes.current.delete(id); knownSemantic.current.add(id) })
    dirty.current = JSON.stringify(editor.document) !== document
    setFailed(false); setStatus(dirty.current ? 'Saving…' : 'Saved')
    if (dirty.current) { stash(); timer.current = setTimeout(() => void flushRef.current(), 300) }
    else localStorage.removeItem(key)
  }, [editor, key, page.id, run])
  flushRef.current = flush
  useEffect(() => editor.onBeforeChange(({ getChanges, tr }) => {
    if (historyGuardBypass.current || !isHistoryTransaction(tr)) return
    const changes = getChanges()
    if (!changes.some(c => c.source.type === 'undo' || c.source.type === 'redo')) return
    for (const c of changes) {
      if (c.block.type !== 'task') continue
      const taskId = String(c.block.props.taskId)
      const target = latestWorkspace.current.tasks.find(t => t.id === taskId)
      if (target && (invalidHistoryTasks.current.has(taskId) || expectedTaskVersions.current.get(taskId) !== target.version)) {
        debugClient('editor.undo.rejected',{operationId:newOperationId(),pageId:page.id,taskId,result:'version-conflict'}); setStatus(`Can't undo: '${target.title}' changed since`); return false
      }
    }
    for (const [blockId, effect] of Object.entries(latestPage.current.editorDeletions ?? {})) {
      if (!changes.some(c => c.type === 'insert' && c.block.id === blockId)) continue
      const target = latestWorkspace.current.tasks.find(t => t.id === effect.task.id)
      if (!target || target.version !== effect.afterVersion) { debugClient('editor.undo.rejected',{operationId:newOperationId(),pageId:page.id,taskId:effect.task.id,result:'version-conflict'}); setStatus(`Can't undo: '${target?.title ?? effect.task.title}' changed since`); return false }
    }
    if (changes.some(c => c.source.type === 'redo')) {
      for (const c of changes) if (c.type === 'delete' && knownSemantic.current.has(c.block.id)) semanticDeletes.current.add(c.block.id)
    }
  }), [editor])
  useEffect(() => editor.onChange(() => {
    if (suppress.current) return
    if (notice.current && notice.current.fingerprint !== JSON.stringify(editor.document)) closeNotice()
    setPastedChecklistIds(checklistIds(nodes()))
    const checklist = editor.document.find(b => b.type === 'checkListItem')
    if (checklist && !composing.current) editor.transact(tr => {
      editor.updateBlock(checklist.id, { type: 'task', props: { taskId: `editor-task:${checklist.id}`, role: insertionRole(checklist.id), planDate: insertionRole(checklist.id) === 'plan' ? page.date ?? '' : '' }, content: checklist.content } as never)
      tr.setMeta('addToHistory', false)
    })
    dirty.current = true; setFailed(false); setStatus('Unsaved changes')
    stash(); clearTimeout(timer.current)
    if (!composing.current) timer.current = setTimeout(() => void flushRef.current(), 450)
  }), [editor])
  useEffect(() => {
    if (historyPending.current) return
    const next = pageContentKey(page)
    if (next === base.current) return
    // Our own save echoes back with the same document and sections projected from it. Anything else (Put back,
    // Keep from the morning hand-off, another tab) rewrote the page under us and the open editor must follow.
    if (page.editorJSON === lastSent.current && page.editorSections === JSON.stringify(page.sections)) return
    if (dirty.current) { debugClient('editor.external-refresh',{operationId:newOperationId(),triggerOperationId:pendingSave.current?.operationId,pageId:page.id,result:'conflict'}); setFailed(true); setStatus('Page changed elsewhere · draft kept; copy it before reloading'); return }
    // Deferred: replacing blocks synchronously inside React's commit triggers a flushSync warning from BlockNote's views.
    queueMicrotask(() => {
      if (dirty.current || base.current === next) return
      debugClient('editor.external-refresh',{operationId:newOperationId(),pageId:page.id,afterRevision:workspace.revision,result:'applied'})
      const selection = browserSelection()
      suppress.current = true
      editor.replaceBlocks(editor.document, editorSeed(page, workspace, { templateRows: needsTemplateRows(page, todayIso()) }) as never)
      restoreBrowserSelection(selection)
      suppress.current = false
      base.current = next
    })
  }, [page, editor, workspace])
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirty.current) { stash(); e.preventDefault() } }
    window.addEventListener('beforeunload', before)
    return () => { clearTimeout(timer.current); if (dirty.current) stash(); window.removeEventListener('beforeunload', before) }
  }, [])

  async function performHistory(direction: 'undo' | 'redo') {
    if (historyPending.current) return
    const historyOperationId=newOperationId()
    debugClient('editor.history.start',{operationId:historyOperationId,pageId:page.id,command:direction})
    let candidate: Transaction | null = null
    const command = direction === 'undo' ? historyUndo : historyRedo
    command(editor.prosemirrorState, tr => { candidate = tr })
    if (!candidate) { debugClient('editor.history.rejected',{operationId:historyOperationId,pageId:page.id,result:'unavailable'}); return }
    const transaction = candidate as Transaction
    const affected = new Set<string>()
    const collect = (doc: Transaction['doc'], from: number, to: number) => {
      doc.nodesBetween(Math.max(0, Math.min(from, doc.content.size)), Math.max(0, Math.min(to, doc.content.size)), node => {
        if (node.type.name === 'task' && node.attrs.taskId) affected.add(String(node.attrs.taskId))
      })
    }
    for (const step of transaction.steps) step.getMap().forEach((from, to, nextFrom, nextTo) => { collect(transaction.before, from, to); collect(transaction.doc, nextFrom, nextTo) })
    const nextDocument = docToBlocks(transaction.doc) as unknown as EditorNode[]
    const oldNodes = deepNodes(nodes()), nextNodes = deepNodes(nextDocument)
    const oldById = new Map(oldNodes.map(n => [n.id, n])), nextById = new Map(nextNodes.map(n => [n.id, n]))
    const semantic = [...affected].some(taskId => {
      const old = oldNodes.find(n => n.type === 'task' && n.props?.taskId === taskId)
      const next = nextNodes.find(n => n.type === 'task' && n.props?.taskId === taskId)
      return !latestWorkspace.current.tasks.some(t => t.id === taskId) && [old, next].some(n => n?.props?.taskId === `editor-task:${n?.id}`)
        || old && next && inlineText(old.content) !== inlineText(next.content)
        || Object.entries(latestPage.current.editorDeletions ?? {}).some(([id, effect]) => effect.task.id === taskId && nextById.has(id) && !oldById.has(id))
        || direction === 'redo' && [...knownSemantic.current].some(id => oldById.get(id)?.props?.taskId === taskId && !nextById.has(id))
        || Object.entries(latestPage.current.editorCreations ?? {}).some(([id, createdTask]) => createdTask === taskId && (oldById.get(id)?.type === 'task') !== (nextById.get(id)?.type === 'task'))
    })
    if (!semantic) { historyGuardBypass.current = true; editor.prosemirrorView.dispatch(transaction); historyGuardBypass.current = false; debugClient('editor.history.finish',{operationId:historyOperationId,pageId:page.id,result:'local'}); return }
    historyPending.current = true; setHistoryBusy(true); editor.isEditable = false
    clearTimeout(timer.current)
    try {
      if (sending.current) {
        for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
        if (sending.current) throw new Error('Still saving · try Undo again shortly')
      }
      if (dirty.current) await flushRef.current()
      if (dirty.current) throw new Error('Reconnect and save before undoing a task change · text kept')
      const current = await refresh(historyOperationId)
      latestWorkspace.current = current
      const p = current.pages.find(p => p.id === page.id)!
      latestPage.current = p
      const document = JSON.stringify(docToBlocks(transaction.doc))
      const candidateNodes = JSON.parse(document) as EditorNode[]
      const remaining = new Set(deepNodes(candidateNodes).map(n => n.id))
      const deleted = direction === 'redo' ? deepNodes(nodes()).filter(n => knownSemantic.current.has(n.id) && !remaining.has(n.id)).map(n => n.id) : []
      const historyTaskVersions = Object.fromEntries([...affected].map(id => [id, current.tasks.some(t => t.id === id) ? expectedTaskVersions.current.get(id) ?? -1 : 0]))
      const action = { type: 'save-editor' as const, pageId: page.id, expectedContent: base.current, document, singleDeleteIds: deleted, historyTaskVersions, history: true, today: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) }
      const preview = applyCommand(current, { operationId: historyOperationId, expectedRevision: current.revision, action }).workspace
      const receipt = await run(action,undefined,historyOperationId)
      if (!receipt) throw new Error("Can't undo: the page or task changed since · nothing restored")
      const saved = preview.pages.find(p => p.id === page.id)!
      latestPage.current = saved; latestWorkspace.current = preview; base.current = pageContentKey(saved)
      for (const task of preview.tasks) if (current.tasks.find(t => t.id === task.id)?.version !== task.version) expectedTaskVersions.current.set(task.id, task.version)
      lastSent.current = document
      suppress.current = true; historyGuardBypass.current = true
      editor.prosemirrorView.dispatch(transaction)
      setPastedChecklistIds(checklistIds(nextDocument))
      historyGuardBypass.current = false; suppress.current = false
      dirty.current = false; localStorage.removeItem(key); setFailed(false); setStatus('Saved')
      debugClient('editor.history.finish',{operationId:historyOperationId,pageId:page.id,afterRevision:preview.revision,result:'saved'})
    } catch (error) {
      debugClient('editor.history.rejected',{operationId:historyOperationId,pageId:page.id,result:'error',error:error instanceof Error?error.name:'UnknownError'})
      setStatus(error instanceof Error ? error.message : 'Cannot verify task history · nothing restored')
    } finally {
      historyPending.current = false; setHistoryBusy(false); editor.isEditable = true; editor.focus()
    }
  }
  function select(id: string, ids?: readonly string[]) {
    const range = ids?.length ? nodes().filter(n => ids.includes(n.id)) : sectionRange(nodes(), id)
    selected.current = range.map(n => n.id)
    setSelectionLabel(range[0]?.type === 'heading' ? `'${inlineText(range[0].content)}' section selected` : range.length > 1 ? `${range.length} blocks selected` : 'Block selected')
    if (range.length > 1) editor.setSelection(range[0]!.id, range.at(-1)!.id)
    else if (range[0]) {
      let pos = -1
      editor.prosemirrorState.doc.descendants((node, position) => { if (node.type.name === 'blockContainer' && node.attrs.id === range[0]!.id) pos = position })
      if (pos >= 0) editor.prosemirrorView.dispatch(editor.prosemirrorState.tr.setSelection(NodeSelection.create(editor.prosemirrorState.doc, pos)))
    }
    // Keyboard focus waits outside the editable text, and the browser's text selection is cleared (the editor keeps
    // its own), so neither typing nor an input method has anywhere to replace the selected blocks.
    selectionFocus.current?.focus()
    window.getSelection()?.removeAllRanges()
  }
  function deleteSelected() {
    const before = nodes()
    const ids = selected.current; selected.current = []
    const first = before.find(n => n.id === ids[0])
    const above = before[before.findIndex(n => n.id === ids[0]) - 1]
    const plannedCount = before.filter(n => ids.includes(n.id) && n.type === 'task' && n.props?.role === 'plan').length
    if (ids.length === 1 && nodes().find(n => n.id === ids[0])?.type === 'task') semanticDeletes.current.add(ids[0]!)
    editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorState.tr))
    editor.removeBlocks(ids)
    if (above && editor.getBlock(above.id)) editor.setTextCursorPosition(above.id, 'end')
    else if (editor.document[0]) editor.setTextCursorPosition(editor.document[0].id, 'start')
    editor.focus()
    setSelectionLabel(''); setStatus('Content removed')
    setNotice({ text: first?.type === 'heading' ? `Deleted '${inlineText(first.content)}'${plannedCount ? ` · ${plannedCount === 1 ? '1 planned task stays' : `${plannedCount} planned tasks stay`} planned` : ''}` : ids.length === 1 && first?.type === 'task' && first.props?.role === 'plan' ? 'Not today · deadline kept' : 'Content removed · tasks unchanged', fingerprint: JSON.stringify(editor.document) })
  }
  // BlockNote places its 30px side menu at the top of the block; our headings and task rows are taller than its
  // defaults (up to 6.5px off when measured). Keep its positioning, nudged level with the hovered block's first line.
  const sideMenuPosition = useMemo(() => ({
    useFloatingOptions: {
      middleware: [offset(({ elements }) => {
        const blockId = editor.getExtension(SideMenuExtension)?.store.state?.block?.id
        const block = blockId ? editor.domElement?.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(blockId)}"]`) : null
        return block ? { mainAxis: 4, crossAxis: firstLineCenter(block) - elements.reference.getBoundingClientRect().top - elements.floating.offsetHeight / 2 } : 4
      })],
    },
  }), [editor])
  // Press-tint cleanup lives here, not in the side menu: BlockNote unmounts the side menu while a drag is in flight.
  useEffect(() => {
    const clear = () => document.querySelectorAll('.is-picked').forEach(el => el.classList.remove('is-picked'))
    // ProseMirror doesn't redraw the browser selection while the editor is unfocused after a drop, so collapse both.
    // The picked ids survive the drop event itself: the editor's drop handler below reads them after this capture.
    const settle = () => { clear(); requestAnimationFrame(() => { const { state } = editor.prosemirrorView; if (!state.selection.empty) editor.prosemirrorView.dispatch(state.tr.setSelection(TextSelection.near(state.selection.$to, -1))); const dom = window.getSelection(); if (dom && !dom.isCollapsed && editor.prosemirrorView.dom.contains(dom.focusNode)) dom.collapseToEnd() }) }
    // A press without a drag (a click) ends with pointerup; a drag ends with dragend. Either way the pick is spent.
    const release = () => { clear(); pickedIds.current = [] }
    // BlockNote clears its drop line on dragend at the editor, but the handle that started the drag lives outside
    // it, so a cancelled drag (Escape, which the page never sees as a keydown) would leave the line. Clear it on any
    // dragend, and on the first pointer move after a drag in case the handle was unmounted and dragend never came.
    const dropLineGone = () => { if (document.querySelector('.prosemirror-dropcursor-block')) editor.prosemirrorView.dom.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null })) }
    // Delayed so a drop can first show the line where the blocks landed.
    const ended = () => { settle(); setTimeout(dropLineGone, 300); pickedIds.current = [] }
    document.addEventListener('pointerup', release)
    document.addEventListener('pointermove', dropLineGone)
    document.addEventListener('dragend', ended, true)
    document.addEventListener('drop', settle, true)
    return () => { document.removeEventListener('pointermove', dropLineGone); document.removeEventListener('pointerup', release); document.removeEventListener('dragend', ended, true); document.removeEventListener('drop', settle, true) }
  }, [editor])
  const handleActions = useRef({ select, selected: () => selected.current }); handleActions.current = { select, selected: () => selected.current }
  const Handle = useMemo(() => function StableHandle() { return <SectionSideMenu select={(id, ids) => handleActions.current.select(id, ids)} picked={pickedIds} extended={extendedIds} selectedIds={() => handleActions.current.selected()} /> }, [])
  function updateDrop(x: number, y: number) {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.bn-block[data-id]')
    const id = el?.dataset.id
    const doc = nodes(), target = doc.find(n => n.id === id), first = dragging.current[0]
    if (!first) return
    const lastElement = document.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(doc.at(-1)?.id ?? '')}"]`)
    const atEnd = !el && !!lastElement && y >= lastElement.getBoundingClientRect().bottom || !!el && y > el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 && target?.id === doc.at(-1)?.id
    const valid = !dragging.current.some(n => n.id === id)
    const next = valid ? { id: id ?? '', end: atEnd, top: el ? (atEnd ? el.getBoundingClientRect().bottom : el.getBoundingClientRect().top) : y } : null
    dropRef.current = next; setDrop(next)
    if (y < 85) window.scrollBy(0, -20)
    else if (y > window.innerHeight - 120) window.scrollBy(0, 20)
    return valid
  }
  function commitDrag() {
    const target = dropRef.current
    if (target) {
      const moving = dragging.current, ids = new Set(moving.map(n => n.id))
      const rest = nodes().filter(n => !ids.has(n.id))
      const index = target.end ? rest.length : rest.findIndex(n => n.id === target.id)
      if (index >= 0) {
        editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorState.tr))
        editor.replaceBlocks(editor.document, [...rest.slice(0, index), ...moving, ...rest.slice(index)] as never)
        editor.setTextCursorPosition(moving[0]!.id, 'end'); editor.focus()
        setNotice({ text: `Moved '${inlineText(moving[0]!.content) || 'block'}'`, fingerprint: JSON.stringify(editor.document) })
      }
    }
    dragging.current = []; dropRef.current = null; setDrop(null); setTouchDragging(false)
  }
  const [dock, setDock] = useState<HTMLElement | null>(null)
  useEffect(() => setDock(document.getElementById('editor-dock')), [])
  useEffect(() => {
    const blocks = editor.document
    const firstHeading = blocks.findIndex(b => b.type === 'heading')
    const nextHeading = blocks.findIndex((b, i) => i > firstHeading && b.type === 'heading')
    const firstSection = blocks.slice(firstHeading + 1, nextHeading < 0 ? blocks.length : nextHeading)
    const target = firstSection.find(b => !inlineText(b.content)) ?? blocks[(nextHeading < 0 ? blocks.length : nextHeading) - 1] ?? blocks[0]
    // Desktop opens ready to type; on touch screens focusing would raise the keyboard over a page that is read as often as written.
    if (target && window.matchMedia('(pointer: fine)').matches) { editor.setTextCursorPosition(target.id, 'end'); editor.focus() }
  }, [editor])
  useEffect(() => {
    const update = () => {
      const block = editor.getTextCursorPosition().block
      const el = document.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(block.id)}"]`)
      if (el) { const top = firstLineCenter(el) - touchHandleSize / 2; setTouchHandle(previous => previous?.id === block.id && Math.abs(previous.top - top) < 0.5 ? previous : { id: block.id, top }) }
    }
    const off = editor.onSelectionChange(() => requestAnimationFrame(update))
    window.addEventListener('scroll', update, true)
    return () => { off(); window.removeEventListener('scroll', update, true) }
  }, [editor])
  function copyBlocks(e: React.ClipboardEvent, cut: boolean) {
    const selection = editor.prosemirrorState.selection
    if (!selected.current.length && (selection.empty || selection instanceof TextSelection && selection.$from.sameParent(selection.$to))) return
    const chosen = selected.current.length ? nodes().filter(n => selected.current.includes(n.id)) : null
    const snapshot = chosen ? null : editor.getSelectionCutBlocks()
    const blocks = chosen ?? snapshot!.blocks.map(block => {
      // Copying just part of a Task title copies text, not the identity or the rest of its title.
      return block.type === 'task' && (snapshot!.blockCutAtStart === block.id || snapshot!.blockCutAtEnd === block.id) ? { ...block, type: 'paragraph', props: {} } : block
    }) as unknown as EditorNode[]
    const token = crypto.randomUUID()
    e.clipboardData.setData(clipboardType, JSON.stringify({ blocks, cut, token }))
    e.clipboardData.setData('text/html', editor.blocksToHTMLLossy(blocks as never))
    e.clipboardData.setData('text/plain', blocks.map(n => inlineText(n.content)).join('\n'))
    e.preventDefault(); e.stopPropagation()
    if (cut) {
      cutTokens.add(token)
      try { localStorage.setItem(`daythread:cut:${token}`, JSON.stringify(blocks)) } catch { /* same-tab move remains available */ }
      editor.transact(tr => { closeHistory(tr); if (chosen) editor.removeBlocks(chosen.map(n => n.id)); else tr.deleteSelection() })
      selected.current = []; setSelectionLabel('')
    }
  }
  return <div className={`continuous-editor ${touchDragging ? 'is-touch-drag' : ''} ${selectionLabel ? 'has-selection' : ''}`} aria-label="Page editor" aria-busy={historyBusy}
    onCopyCapture={e => copyBlocks(e, false)} onCutCapture={e => copyBlocks(e, true)}
    onMouseDownCapture={e => { const target = e.target as Element; if (target.closest('.bn-editor') && !target.closest('.bn-side-menu')) { selected.current = []; extendedIds.current = []; setSelectionLabel('') } }}
    onMouseUpCapture={e => {
      const target = e.target instanceof Element ? e.target : null
      const view = editor.prosemirrorView
      // Only repair a plain click in editable text. Buttons, selection gestures, native drag and IME own their selections.
      if (e.button !== 0 || e.detail !== 1 || !target || !view.dom.contains(target) || target.closest('[contenteditable="false"]') || composing.current || view.composing || dragging.current.length || historyPending.current) return
      // Repair now: an immediate Enter can arrive before requestAnimationFrame.
      if (window.getSelection()?.isCollapsed) restoreBrowserSelection(browserSelection())
      const doc = view.state.doc
      requestAnimationFrame(() => {
        if (view.isDestroyed || view.state.doc !== doc || composing.current || view.composing || dragging.current.length || historyPending.current) return
        const dom = window.getSelection()
        if (!dom?.isCollapsed || !dom.anchorNode || !view.dom.contains(dom.anchorNode)) return
        const pos = view.posAtDOM(dom.anchorNode, dom.anchorOffset)
        // A DOM caret on a non-text boundary must not turn a block selection into an invalid text selection.
        if (!view.state.doc.resolve(pos).parent.inlineContent) return
        if (view.state.selection.empty && view.state.selection.from === pos) return
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
      })
    }}
    onCompositionStartCapture={() => { composing.current = true; clearTimeout(timer.current) }}
    onCompositionEndCapture={() => { composing.current = false; requestAnimationFrame(() => { stash(); clearTimeout(timer.current); timer.current = setTimeout(() => void flushRef.current(), 450) }) }}
    onDropCapture={e => {
      // Drops go to the row boundary under the pointer at release. BlockNote's line can lag the pointer when
      // dragover events stop arriving (Ratchet task #49: a long drag stayed put, the line stuck near the start),
      // and ProseMirror's own drop can land a block away from the line; the pointer is what Brian aims with, and
      // a line that has caught up shows the same boundary.
      const ids = pickedIds.current
      if (!ids.length || !editor.prosemirrorView.dragging) return
      e.preventDefault(); e.stopPropagation()
      pickedIds.current = []
      const y = e.clientY
      const rows = [...editor.prosemirrorView.dom.querySelectorAll<HTMLElement>(':scope > .bn-block-group > .bn-block-outer')]
      const next = rows.find(row => { const r = row.getBoundingClientRect(); return y < r.top + r.height / 2 })
      const after = next?.querySelector('[data-node-type="blockContainer"]')?.getAttribute('data-id') ?? null
      const last = rows.at(-1)?.querySelector('[data-node-type="blockContainer"]')?.getAttribute('data-id') ?? null
      const ref = after ? (ids.includes(after) ? null : { id: after, placement: 'before' as const }) : last && !ids.includes(last) ? { id: last, placement: 'after' as const } : null
      editor.prosemirrorView.dragging = null
      // Stopping the drop also stops BlockNote's own cleanup of the line; a dragleave out of the editor removes it.
      setTimeout(() => editor.prosemirrorView.dom.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null })), 300)
      if (!ref) return
      const blocks = ids.map(id => editor.getBlock(id)).filter(b => b !== undefined)
      editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorState.tr))
      editor.transact(() => { editor.removeBlocks(ids); editor.insertBlocks(blocks as never, ref.id, ref.placement) })
      // Show the line at the top of the moved blocks before it goes (Lead: the line is where it lands; a jump is fine).
      // Measured a frame later, once the moved blocks have been laid out.
      requestAnimationFrame(() => {
        const line = document.querySelector<HTMLElement>('.prosemirror-dropcursor-block-horizontal')
        const landed = editor.domElement?.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(ids[0]!)}"]`)
        if (!line || !landed) return
        const parent = (line.offsetParent ?? document.body) as HTMLElement
        line.style.top = `${landed.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop - line.offsetHeight / 2}px`
      })
      // Editor spec: after a drop, a plain cursor at the end of the moved block's first line (a section's heading),
      // with focus back in the editor so ⌘Z undoes the move straight away.
      // The browser settles focus after the drop event, so place the caret once the drag has fully ended.
      setTimeout(() => { if (editor.getBlock(ids[0]!)) { editor.setTextCursorPosition(ids[0]!, 'end'); editor.focus() } }, 0)
    }}
    onKeyDownCapture={e => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      if (historyPending.current) { e.preventDefault(); e.stopPropagation(); return }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); void performHistory(e.shiftKey ? 'redo' : 'undo'); return }
      if (e.key === ' ' && !e.nativeEvent.isComposing && editor.getTextCursorPosition().block.type === 'task' && /^(?:#{1,3}|[-*>]|1\.|\[\])$/.test(editor.prosemirrorState.selection.$from.parent.textBetween(0, editor.prosemirrorState.selection.$from.parentOffset))) { e.preventDefault(); editor.insertInlineContent(' '); return }

      if (e.key === 'Enter' && !e.nativeEvent.isComposing && editor.getTextCursorPosition().block.type === 'task' && editor.prosemirrorState.selection.empty) {
        e.preventDefault(); e.stopPropagation()
        const block = editor.getTextCursorPosition().block
        const parent = editor.prosemirrorState.selection.$from.parent
        const offset = editor.prosemirrorState.selection.$from.parentOffset
        const left = parent.textBetween(0, offset), right = parent.textBetween(offset, parent.content.size)
        if (!parent.textContent) { editor.updateBlock(block.id, { type: 'paragraph', content: '' }); return }
        const id = crypto.randomUUID()
        editor.transact(() => {
          editor.updateBlock(block.id, { content: left } as never)
          editor.insertBlocks([{ id, type: 'task', props: { ...block.props, taskId: `editor-task:${id}` }, content: right } as never], block.id, 'after')
          editor.setTextCursorPosition(id, 'start')
        })
        return
      }
      // A handle selection is for moving and deleting, not typing (editor spec §1, design 4a45305): printable keys
      // do nothing, Enter goes into the heading's text, Escape lets go. Arrows, copy, cut and undo work as before.
      if (selected.current.length && !e.metaKey && !e.ctrlKey) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation()
          const first = selected.current[0]!
          selected.current = []; extendedIds.current = []; setSelectionLabel('')
          document.querySelectorAll('.is-picked').forEach(el => el.classList.remove('is-picked'))
          if (editor.getBlock(first)) editor.setTextCursorPosition(first, 'end')
          editor.focus()
          return
        }
        if (e.key.length === 1) { e.preventDefault(); e.stopPropagation(); return }
        if (e.key.startsWith('Arrow')) editor.focus()
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.current.length) {
        e.preventDefault(); e.stopPropagation()
        deleteSelected()
      } else if (e.key === 'Backspace' && !e.nativeEvent.isComposing && editor.prosemirrorState.selection.empty && editor.getTextCursorPosition().block.type === 'task' && !inlineText(editor.getTextCursorPosition().block.content)) {
        e.preventDefault(); e.stopPropagation(); const id = editor.getTextCursorPosition().block.id; semanticDeletes.current.add(id); editor.removeBlocks([id])
      } else if (!['Shift', 'Control', 'Meta', 'Alt'].includes(e.key) && !((e.metaKey || e.ctrlKey) && ['c', 'x'].includes(e.key.toLowerCase()))) { selected.current = []; setSelectionLabel('') }
    }}
    >
    <div ref={selectionFocus} tabIndex={-1} className="sr-only" aria-label={selectionLabel || undefined} />
    <div className="editor-save-line" role="status">{status}{failed && <><button onClick={() => void flush()}>Retry saving</button><button onClick={async () => { await navigator.clipboard.writeText(await editor.blocksToMarkdownLossy()); setStatus('Draft copied · original kept here') }}>Copy draft</button></>}{selectionLabel && <span className="sr-only">{selectionLabel}</span>}</div>
    <BlockNoteView editor={editor} theme="light" formattingToolbar={false} sideMenu={false} slashMenu={false}>
      {/* Trimmed to what a day note uses (Jazz, #6): no alignment, indent or colour buttons. */}
      {!compact && !selectionLabel && <FormattingToolbarController formattingToolbar={() => <FormattingToolbar>
        <BlockTypeSelect key="blockTypeSelect" />
        <BasicTextStyleButton key="bold" basicTextStyle="bold" />
        <BasicTextStyleButton key="italic" basicTextStyle="italic" />
        <BasicTextStyleButton key="underline" basicTextStyle="underline" />
        <BasicTextStyleButton key="strike" basicTextStyle="strike" />
        <CreateLinkButton key="createLink" />
      </FormattingToolbar>} />}
      <SuggestionMenuController triggerCharacter="/" shouldOpen={() => !composing.current && editor.getTextCursorPosition().block.type !== 'task'} getItems={async query => {
        // Editor spec F13: heading hints in day-page terms; the items Brian uses most come first.
        const headingHints: Record<string, string> = { 'Heading 1': 'Larger than day sections', 'Heading 2': 'Section', 'Heading 3': 'Inside a section' }
        const suggested = ['Bullet List', 'Heading 2']
        const library = getDefaultReactSlashMenuItems(editor).filter(item => ['Heading 1', 'Heading 2', 'Heading 3', 'Paragraph', 'Bullet List', 'Numbered List', 'Quote'].includes(item.title)).map(item => headingHints[item.title] ? { ...item, subtext: headingHints[item.title] } : item)
        const first = suggested.map(title => library.find(item => item.title === title)!).map(item => ({ ...item, group: 'Suggested' }))
        const rest = library.filter(item => !suggested.includes(item.title))
        const taskItem = { title: 'Task', subtext: 'Checkbox that becomes a task', icon: <CheckboxIcon />, aliases: ['todo', 'task', '任务'], group: 'Suggested', onItemClick: () => {
          const currentBlock = editor.getTextCursorPosition().block
          const currentId = currentBlock.id
          const replaceCurrent = !inlineText(currentBlock.content) || inlineText(currentBlock.content) === '/'
          const id = replaceCurrent ? currentId : crypto.randomUUID()
          const role = insertionRole(currentId)
          insertOrUpdateBlockForSlashMenu(editor, { ...(replaceCurrent ? {} : { id }), type: 'task', props: { taskId: `editor-task:${id}`, role, planDate: role === 'plan' ? page.date ?? '' : '' }, content: '' })
        } }
        return filterSuggestionItems([taskItem, ...first, ...rest], query).slice(0, 8)
      }} />
      <SideMenuController sideMenu={Handle} floatingUIOptions={sideMenuPosition} />
    </BlockNoteView>
    {touchHandle && <button className="editor-touch-handle" aria-label="Drag current section or block" style={{ top: touchHandle.top }}
      onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = sectionRange(nodes(), touchHandle.id); setTouchDragging(true) }}
      onPointerMove={e => { if (dragging.current.length && e.buttons) updateDrop(e.clientX - 35, e.clientY) }}
      onPointerUp={e => { e.preventDefault(); if (!dropRef.current) { dragging.current = []; setTouchDragging(false); select(touchHandle.id) } else commitDrag() }}
      onPointerCancel={() => { dragging.current = []; setTouchDragging(false); setDrop(null) }}><GripIcon /></button>}
    <div className="editor-phone-toolbar" aria-label="Editor tools"><button onPointerDown={e => e.preventDefault()} onClick={() => void performHistory('undo')} aria-label="Undo"><UndoIcon /></button><button onPointerDown={e => e.preventDefault()} onClick={() => void performHistory('redo')} aria-label="Redo"><RedoIcon /></button><button onPointerDown={e => e.preventDefault()} onClick={() => { editor.focus(); editor.getExtension(SuggestionMenu)?.openSuggestionMenu('/') }} aria-label="Insert block"><PlusIcon /></button></div>
    {dock && createPortal(<>
      {selectionLabel && <div className="editor-selection-bar"><span>{selectionLabel}</span><button onPointerDown={e => e.preventDefault()} onClick={deleteSelected}>Delete</button></div>}
    {pastedChecklistIds.length > 0 && <div className="editor-paste-notice" role="status">{pastedChecklistIds.length} checklist {pastedChecklistIds.length === 1 ? 'line' : 'lines'} · <button onClick={() => {
      let count = 0, planned = 0
      editor.transact(tr => {
        closeHistory(tr)
        for (const id of pastedChecklistIds) {
          const node = editor.getBlock(id)
          if (node?.type !== 'sourceChecklist' || node.props.checked) continue
          const role = insertionRole(id)
          editor.updateBlock(id, { type: 'task', props: { taskId: `editor-task:${id}`, role, planDate: role === 'plan' ? page.date ?? '' : '' }, content: node.content } as never)
          count++; if (role === 'plan') planned++
        }
      })
      const day = page.date === todayIso() ? 'today' : page.date === addDays(todayIso(), 1) ? 'tomorrow' : page.date ? fromIso(page.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
      if (count) setNotice({ text: `Made ${count} ${count === 1 ? 'task' : 'tasks'}${planned ? ` · ${planned < count ? `${planned} ` : ''}planned for ${day}` : ''}`, fingerprint: JSON.stringify(editor.document) })
      setPastedChecklistIds([]); editor.focus()
    }}>Turn into tasks</button></div>}
    </>, dock)}
    {drop && <div className="editor-drop-line" style={{ top: drop.top }} />}
  </div>
}
/**
 * BlockNote's side menu and native block drag, plus the one piece BlockNote lacks: pressing the handle selects the
 * whole flat section (heading up to the next heading of the same or higher level) and tints it, so the native drag
 * that follows moves and previews exactly what was tinted. A plain click selects the section for Delete instead of
 * opening BlockNote's block menu, whose Delete would bypass our planned-task rules.
 */
function SectionSideMenu({ select, picked, extended, selectedIds }: { select(id: string, ids?: readonly string[]): void; picked: { current: string[] }; extended: { current: string[] }; selectedIds(): string[] }) {
  const editor = useBlockNoteEditor()
  const Components = useComponentsContext()!
  const sideMenu = editor.getExtension(SideMenuExtension)!
  const block = useExtensionState(SideMenuExtension, { editor, selector: state => state?.block })
  const lastRange = useRef<string[]>([])
  if (!block) return null
  // Press: only set the editor selection the native drag reads, and tint it. React state changes here would
  // re-render the editor mid-gesture and cancel the drag, so the section label waits for the click.
  // Every press replaces the picked range with this block or section; Shift extends the previous one (Jazz).
  const pick = (e: React.PointerEvent) => {
    sideMenu.freezeMenu()
    const doc = editor.document as unknown as EditorNode[]
    let range = sectionRange(doc, block.id)
    // Shift-press extends what a click already selected. Browsers don't start a drag on a Shift-press, so the
    // extended range is kept: the next plain press inside it drags the whole range; a press outside starts over.
    const prior = picked.current.length ? picked.current : selectedIds()
    if (e.shiftKey && prior.length) {
      const indexes = [...prior, ...range.map(n => n.id)].map(id => doc.findIndex(n => n.id === id)).filter(i => i >= 0)
      range = doc.slice(Math.min(...indexes), Math.max(...indexes) + 1)
      extended.current = range.map(n => n.id)
    } else if (extended.current.includes(block.id)) range = doc.filter(n => extended.current.includes(n.id))
    else extended.current = []
    lastRange.current = range.map(n => n.id)
    picked.current = range.map(n => n.id)
    if (range.length > 1) editor.setSelection(range[0]!.id, range.at(-1)!.id)
    else {
      // A single block still needs its own selection, or the native drag carries the previous multi-block one.
      let pos = -1
      editor.prosemirrorState.doc.descendants((node, position) => { if (node.type.name === 'blockContainer' && node.attrs.id === block.id) pos = position })
      if (pos >= 0) editor.prosemirrorView.dispatch(editor.prosemirrorState.tr.setSelection(NodeSelection.create(editor.prosemirrorState.doc, pos)))
    }
    document.querySelectorAll('.is-picked').forEach(el => el.classList.remove('is-picked'))
    for (const node of range)
      editor.domElement?.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(node.id)}"]`)?.classList.add('is-picked')
  }
  return <SideMenu>
    <span className="editor-handle" onPointerDownCapture={pick}>
      <Components.SideMenu.Button
        label={block.type === 'heading' ? 'Select or drag section' : 'Select or drag block'}
        className="bn-button"
        draggable
        icon={<GripIcon />}
        onClick={() => { select(block.id, lastRange.current); sideMenu.unfreezeMenu() }}
        onDragStart={e => sideMenu.blockDragStart(e, block)}
        onDragEnd={() => { sideMenu.blockDragEnd(); sideMenu.unfreezeMenu() }}
      />
    </span>
  </SideMenu>
}
