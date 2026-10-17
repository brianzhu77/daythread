import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { closeHistory, isHistoryTransaction, undo as historyUndo, redo as historyRedo } from '@tiptap/pm/history'
import { BlockNoteSchema, blockToNode, defaultBlockSpecs, docToBlocks, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import { createReactBlockSpec, getDefaultReactSlashMenuItems, type SideMenuProps, SuggestionMenuController, SideMenuController, useBlockNoteEditor, useCreateBlockNote, useExtensionState } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { offset } from '@floating-ui/react'
import '@blocknote/mantine/style.css'
import type { Page, Task, Workspace } from '../domain/types'
import { editorSeed, inlineText, needsTemplateRows, pageContentKey, sectionRange, type EditorNode } from '../domain/editor-document'
import { applyCommand } from '../domain/workspace'
import { useWorkspace } from './use-day'
import { DateTag } from './date-tag'
import { GripIcon, PlusIcon, RedoIcon, UndoIcon } from './icons'
import { addDays, fromIso, todayIso } from './dates'

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
  const editor = useCreateBlockNote({ schema, placeholders: { default: 'Write…', emptyDocument: 'Write…', bulletListItem: '' }, pasteHandler: ({ event, editor, defaultPasteHandler }) => {
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
  const latestPage = useRef(page); latestPage.current = page
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
  const [dropHint, setDropHint] = useState<{ x: number; y: number; text: string } | null>(null)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 899px)').matches)
  useEffect(() => { const media = window.matchMedia('(max-width: 899px)'); const update = () => setCompact(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [touchHandle, setTouchHandle] = useState<{ id: string; top: number } | null>(null)
  const [touchDragging, setTouchDragging] = useState(false)
  const dropRef = useRef<typeof drop>(null)
  const [notice, setNotice] = useState<{ text: string; fingerprint: string } | null>(null)
  const [selectionLabel, setSelectionLabel] = useState('')
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
  const flush = useCallback(async () => {
    if (!dirty.current || sending.current) return
    sending.current = true
    const document = JSON.stringify(editor.document)
    const deletions = [...semanticDeletes.current]
    lastSent.current = document
    setStatus('Saving…')
    const action = { type: 'save-editor' as const, pageId: page.id, expectedContent: base.current, document, singleDeleteIds: deletions, today: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) }
    const source = latestWorkspace.current
    let preview: Workspace
    try { preview = applyCommand(source, { operationId: crypto.randomUUID(), expectedRevision: source.revision, action }).workspace }
    catch (error) { sending.current = false; setFailed(true); setStatus(error instanceof Error ? error.message : 'Cannot save; draft kept'); return }
    const result = await run(action)
    sending.current = false
    if (!result) { setFailed(true); setStatus('Not saved · your draft is kept on this device'); return }
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
        setStatus(`Can't undo: '${target.title}' changed since`); return false
      }
    }
    for (const [blockId, effect] of Object.entries(latestPage.current.editorDeletions ?? {})) {
      if (!changes.some(c => c.type === 'insert' && c.block.id === blockId)) continue
      const target = latestWorkspace.current.tasks.find(t => t.id === effect.task.id)
      if (!target || target.version !== effect.afterVersion) { setStatus(`Can't undo: '${target?.title ?? effect.task.title}' changed since`); return false }
    }
    if (changes.some(c => c.source.type === 'redo')) {
      for (const c of changes) if (c.type === 'delete' && knownSemantic.current.has(c.block.id)) semanticDeletes.current.add(c.block.id)
    }
  }), [editor])
  useEffect(() => editor.onChange(() => {
    if (suppress.current) return
    setNotice(null)
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
    if (dirty.current) { setFailed(true); setStatus('Page changed elsewhere · draft kept; copy it before reloading'); return }
    // Deferred: replacing blocks synchronously inside React's commit triggers a flushSync warning from BlockNote's views.
    queueMicrotask(() => {
      if (dirty.current || base.current === next) return
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
    let candidate: Transaction | null = null
    const command = direction === 'undo' ? historyUndo : historyRedo
    command(editor.prosemirrorState, tr => { candidate = tr })
    if (!candidate) return
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
    if (!semantic) { historyGuardBypass.current = true; editor.prosemirrorView.dispatch(transaction); historyGuardBypass.current = false; return }

    historyPending.current = true; setHistoryBusy(true); editor.isEditable = false
    clearTimeout(timer.current)
    try {
      if (sending.current) {
        for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
        if (sending.current) throw new Error('Still saving · try Undo again shortly')
      }
      if (dirty.current) await flushRef.current()
      if (dirty.current) throw new Error('Reconnect and save before undoing a task change · text kept')
      const current = await refresh()
      latestWorkspace.current = current
      const p = current.pages.find(p => p.id === page.id)!
      latestPage.current = p
      const document = JSON.stringify(docToBlocks(transaction.doc))
      const candidateNodes = JSON.parse(document) as EditorNode[]
      const remaining = new Set(deepNodes(candidateNodes).map(n => n.id))
      const deleted = direction === 'redo' ? deepNodes(nodes()).filter(n => knownSemantic.current.has(n.id) && !remaining.has(n.id)).map(n => n.id) : []
      const historyTaskVersions = Object.fromEntries([...affected].map(id => [id, current.tasks.some(t => t.id === id) ? expectedTaskVersions.current.get(id) ?? -1 : 0]))
      const action = { type: 'save-editor' as const, pageId: page.id, expectedContent: base.current, document, singleDeleteIds: deleted, historyTaskVersions, history: true, today: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) }
      const preview = applyCommand(current, { operationId: crypto.randomUUID(), expectedRevision: current.revision, action }).workspace
      const receipt = await run(action)
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Cannot verify task history · nothing restored')
    } finally {
      historyPending.current = false; setHistoryBusy(false); editor.isEditable = true; editor.focus()
    }
  }
  function select(id: string) {
    const range = sectionRange(nodes(), id)
    selected.current = range.map(n => n.id)
    setSelectionLabel(range[0]?.type === 'heading' ? `'${inlineText(range[0].content)}' section selected` : range.length > 1 ? `${range.length} blocks selected` : 'Block selected')
    if (range.length > 1) editor.setSelection(range[0]!.id, range.at(-1)!.id)
    else if (range[0]) {
      let pos = -1
      editor.prosemirrorState.doc.descendants((node, position) => { if (node.type.name === 'blockContainer' && node.attrs.id === range[0]!.id) pos = position })
      if (pos >= 0) editor.prosemirrorView.dispatch(editor.prosemirrorState.tr.setSelection(NodeSelection.create(editor.prosemirrorState.doc, pos)))
    }
    editor.focus()
  }
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(timer) }, [notice])
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
  function dragStart(id: string, e: React.DragEvent) {
    dragging.current = sectionRange(nodes(), id)
    selected.current = []
    e.dataTransfer.setData('application/x-daythread-blocks', id)
    e.dataTransfer.effectAllowed = 'move'
    const preview = document.createElement('div')
    preview.className = 'section-drag-preview'
    preview.textContent = `${inlineText(dragging.current[0]?.content) || 'Block'} · ${dragging.current.length - 1} lines`
    document.body.append(preview); e.dataTransfer.setDragImage(preview, 12, 12)
    setTimeout(() => preview.remove(), 0)
  }
  const handleActions = useRef({ select, dragStart }); handleActions.current = { select, dragStart }
  const Handle = useMemo(() => function StableHandle() { return <EditorHandle select={id => handleActions.current.select(id)} dragStart={(id, e) => handleActions.current.dragStart(id, e)} /> }, [])
  function updateDrop(x: number, y: number) {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.bn-block[data-id]')
    const id = el?.dataset.id
    const doc = nodes(), target = doc.find(n => n.id === id), first = dragging.current[0]
    if (!first) return
    const lastElement = document.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(doc.at(-1)?.id ?? '')}"]`)
    const atEnd = !el && !!lastElement && y >= lastElement.getBoundingClientRect().bottom || !!el && y > el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 && target?.id === doc.at(-1)?.id
    const valid = !dragging.current.some(n => n.id === id) && (first.type !== 'heading' || atEnd || target?.type === 'heading' && Number(target.props?.level) <= Number(first.props?.level))
    const next = valid ? { id: id ?? '', end: atEnd, top: el ? (atEnd ? el.getBoundingClientRect().bottom : el.getBoundingClientRect().top) : y } : null
    dropRef.current = next; setDrop(next)
    // Spec F5a: a heading that can't land among lower-level sections says why instead of failing silently.
    const level = Number(first.props?.level ?? 1)
    const blockedByLevel = !valid && first.type === 'heading' && target?.type === 'heading' && Number(target.props?.level ?? 1) > level
    setDropHint(blockedByLevel ? { x, y, text: `Heading ${level} holds the sections after it · Turn into Heading ${Number(target!.props?.level ?? 2)}` } : null)
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
        const el = document.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(moving[0]!.id)}"]`)
        el?.classList.add('just-moved'); setTimeout(() => el?.classList.remove('just-moved'), 600)
      }
    }
    dragging.current = []; dropRef.current = null; setDrop(null); setDropHint(null); setTouchDragging(false)
  }
  const [dock, setDock] = useState<HTMLElement | null>(null)
  useEffect(() => setDock(document.getElementById('editor-dock')), [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
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
    onMouseDownCapture={e => { if ((e.target as Element).closest('.bn-editor')) { selected.current = []; setSelectionLabel('') } }}
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.current.length) {
        e.preventDefault(); e.stopPropagation()
        deleteSelected()
      } else if (e.key === 'Backspace' && !e.nativeEvent.isComposing && editor.prosemirrorState.selection.empty && editor.getTextCursorPosition().block.type === 'task' && !inlineText(editor.getTextCursorPosition().block.content)) {
        e.preventDefault(); e.stopPropagation(); const id = editor.getTextCursorPosition().block.id; semanticDeletes.current.add(id); editor.removeBlocks([id])
      } else if (!['Shift', 'Control', 'Meta', 'Alt'].includes(e.key) && !((e.metaKey || e.ctrlKey) && ['c', 'x'].includes(e.key.toLowerCase()))) { selected.current = []; setSelectionLabel('') }
    }}
    onDragOverCapture={e => {
      if (!dragging.current.length) return
      e.preventDefault(); e.stopPropagation()
      e.dataTransfer.dropEffect = updateDrop(e.clientX, e.clientY) ? 'move' : 'none'
    }}
    onDropCapture={e => {
      if (!dragging.current.length) return
      e.preventDefault(); e.stopPropagation(); commitDrag()
    }} onDragEnd={() => { dragging.current = []; setDrop(null); setDropHint(null) }}>
    <div className="editor-save-line" role="status">{status}{failed && <><button onClick={() => void flush()}>Retry saving</button><button onClick={async () => { await navigator.clipboard.writeText(await editor.blocksToMarkdownLossy()); setStatus('Draft copied · original kept here') }}>Copy draft</button></>}{selectionLabel && <span className="sr-only">{selectionLabel}</span>}</div>
    <BlockNoteView editor={editor} theme={dark ? 'dark' : 'light'} formattingToolbar={!compact && !selectionLabel} sideMenu={false} slashMenu={false}>
      <SuggestionMenuController triggerCharacter="/" shouldOpen={() => !composing.current && editor.getTextCursorPosition().block.type !== 'task'} getItems={async query => {
        const headingHints: Record<string, string> = { 'Heading 1': 'Larger than the day sections', 'Heading 2': 'A section, like TODO - Top 3', 'Heading 3': 'Inside a section' }
        const defaults = getDefaultReactSlashMenuItems(editor).filter(item => ['Heading 1', 'Heading 2', 'Heading 3', 'Paragraph', 'Bullet List', 'Numbered List', 'Quote'].includes(item.title)).map(item => headingHints[item.title] ? { ...item, subtext: headingHints[item.title] } : item)
        const taskItem = { title: 'Task', subtext: 'Create a task, keeping its identity wherever it moves', aliases: ['todo', 'task', '任务'], group: 'Basic', onItemClick: () => {
          const currentBlock = editor.getTextCursorPosition().block
          const currentId = currentBlock.id
          const replaceCurrent = !inlineText(currentBlock.content) || inlineText(currentBlock.content) === '/'
          const id = replaceCurrent ? currentId : crypto.randomUUID()
          const role = insertionRole(currentId)
          insertOrUpdateBlockForSlashMenu(editor, { ...(replaceCurrent ? {} : { id }), type: 'task', props: { taskId: `editor-task:${id}`, role, planDate: role === 'plan' ? page.date ?? '' : '' }, content: '' })
        } }
        return filterSuggestionItems([taskItem, ...defaults], query).slice(0, 8)
      }} />
      <AlignedSideMenu handle={Handle} />
    </BlockNoteView>
    {touchHandle && <button className="editor-touch-handle" aria-label="Drag current section or block" style={{ top: touchHandle.top }}
      onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = sectionRange(nodes(), touchHandle.id); setTouchDragging(true) }}
      onPointerMove={e => { if (dragging.current.length && e.buttons) updateDrop(e.clientX - 35, e.clientY) }}
      onPointerUp={e => { e.preventDefault(); if (!dropRef.current) { dragging.current = []; setTouchDragging(false); setDropHint(null); select(touchHandle.id) } else commitDrag() }}
      onPointerCancel={() => { dragging.current = []; setTouchDragging(false); setDrop(null); setDropHint(null) }}><GripIcon /></button>}
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
      {notice && <div className="editor-operation-notice" role="status"><span>{notice.text}</span><button onClick={() => { if (notice.fingerprint === JSON.stringify(editor.document)) void performHistory('undo'); setNotice(null) }}>Undo</button></div>}
    </>, dock)}
    {drop && <div className="editor-drop-line" style={{ top: drop.top }} />}
    {dropHint && <div className="editor-drop-hint" role="status" style={{ left: dropHint.x + 16, top: dropHint.y + 14 }}>{dropHint.text}</div>}
  </div>
}
// BlockNote shifts its side menu by offsets tuned to its own heading sizes, which our headings don't use.
// Measure the hovered block instead so the handle sits level with its first line for every block type.
function AlignedSideMenu({ handle }: { handle: FC<SideMenuProps> }) {
  const editor = useBlockNoteEditor()
  const options = useMemo(() => ({
    useFloatingOptions: {
      middleware: [offset(({ elements }) => {
        // Read the hovered block at compute time; positioning runs before React re-renders with new state.
        const blockId = editor.getExtension(SideMenuExtension)?.store.state?.block?.id
        const block = blockId ? editor.domElement?.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(blockId)}"]`) : null
        if (!block) return 0
        return { crossAxis: firstLineCenter(block) - elements.reference.getBoundingClientRect().top - elements.floating.offsetHeight / 2 }
      })],
    },
  }), [editor])
  return <SideMenuController sideMenu={handle} floatingUIOptions={options} />
}
function HandleIcon() {
  return <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" fill="currentColor">{[2, 8, 14].flatMap(y => [<circle key={`l${y}`} cx="2" cy={y} r="1.5" />, <circle key={`r${y}`} cx="8" cy={y} r="1.5" />])}</svg>
}
function EditorHandle({ select, dragStart }: { select(id: string): void; dragStart(id: string, e: React.DragEvent): void }) {
  const editor = useBlockNoteEditor()
  const block = useExtensionState(SideMenuExtension, { editor, selector: state => state?.block })
  const pressed = useRef<string | null>(null)
  const nativeDragging = useRef(false)
  if (!block) return null
  return <button className="editor-block-handle" draggable aria-label={block.type === 'heading' ? 'Select or drag section' : 'Select or drag block'} onPointerDown={() => { pressed.current = block.id; nativeDragging.current = false; editor.getExtension(SideMenuExtension)?.freezeMenu() }} onPointerUp={() => { if (!nativeDragging.current) select(pressed.current ?? block.id); setTimeout(() => editor.getExtension(SideMenuExtension)?.unfreezeMenu(), 0) }} onDragStart={e => { nativeDragging.current = true; dragStart(pressed.current ?? block.id, e) }} onDragEnd={() => editor.getExtension(SideMenuExtension)?.unfreezeMenu()}><HandleIcon /></button>
}
