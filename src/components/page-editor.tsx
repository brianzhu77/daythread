import type { Transaction } from '@tiptap/pm/state'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { closeHistory, isHistoryTransaction, undo as historyUndo, redo as historyRedo } from '@tiptap/pm/history'
import { BlockNoteSchema, defaultBlockSpecs, docToBlocks, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import { createReactBlockSpec, getDefaultReactSlashMenuItems, SuggestionMenuController, SideMenuController, useBlockNoteEditor, useCreateBlockNote, useExtensionState } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/mantine/style.css'
import type { Page, Workspace } from '../domain/types'
import { editorSeed, inlineText, pageContentKey, sectionRange, type EditorNode } from '../domain/editor-document'
import { applyCommand } from '../domain/workspace'
import { useWorkspace } from './use-day'

const task = createReactBlockSpec({ type: 'task', propSchema: { taskId: { default: '' }, role: { default: 'reference' }, planDate: { default: '' } }, content: 'inline' }, {
  render: ({ block, contentRef }) => <EditorTask taskId={block.props.taskId} role={block.props.role} planDate={block.props.planDate} contentRef={contentRef} />,
})()
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, task } })
function EditorTask({ taskId, role, planDate, contentRef }: { taskId: string; role: string; planDate: string; contentRef: (node: HTMLElement | null) => void }) {
  const { workspace, run } = useWorkspace()
  const t = workspace?.tasks.find(t => t.id === taskId)
  return <div className="editor-task" data-role={role}>
    <input contentEditable={false} type="checkbox" aria-label={t ? `Complete ${t.title}` : 'Missing task'} checked={t?.status === 'done'} disabled={!t} onChange={() => t && void run({ type: 'task-status', taskId, status: t.status === 'done' ? 'open' : 'done' }, r => ({ text: t.status === 'done' ? 'Task reopened' : 'Task completed', undoOperationId: r.operationId }))} />
    <span ref={contentRef} className={`editor-task-title ${t?.status === 'done' ? 'task-done' : ''}`} data-placeholder="Untitled task" />
    {role === 'reference' && <span contentEditable={false} className="editor-reference-tag">Reference</span>}
    {role === 'plan' && planDate && <span contentEditable={false} className="editor-plan-tag">{planDate}</span>}
    {role === 'reference' && t?.status === 'open' && <button className="editor-plan-action" contentEditable={false} onClick={() => void run({ type: 'plan-task', taskId, date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) }, r => ({ text: 'Planned for today', undoOperationId: r.operationId }))}>Plan for today</button>}
    {t?.deadlineOn && <small contentEditable={false}>Due {t.deadlineOn}</small>}
  </div>
}

export function PageEditor({ page, workspace }: { page: Page; workspace: Workspace }) {
  const { run, refresh } = useWorkspace()
  const key = `daythread:editor:${page.id}`
  const initial = useRef<{ nodes: EditorNode[]; base: string; recovered: boolean } | null>(null)
  if (!initial.current) {
    const base = pageContentKey(page)
    let nodes = editorSeed(page, workspace), recovered = false, savedBase = base
    try { const stored = JSON.parse(localStorage.getItem(key) ?? 'null'); if (stored?.document) { nodes = JSON.parse(stored.document); savedBase = stored.base; recovered = true } } catch { /* fresh document */ }
    initial.current = { nodes, base: savedBase, recovered }
  }
  const editor = useCreateBlockNote({ schema, pasteHandler: ({ event, editor, defaultPasteHandler }) => {
    const html = event.clipboardData?.getData('blocknote/html')
    if (!html) return defaultPasteHandler()
    const dom = new DOMParser().parseFromString(html, 'text/html')
    const taskNodes = [...dom.querySelectorAll<HTMLElement>('[data-content-type="task"]')]
    if (!taskNodes.length) return defaultPasteHandler()
    for (const node of taskNodes) {
      const id = node.getAttribute('data-task-id')
      if (!latestWorkspace.current.tasks.some(t => t.id === id)) { node.setAttribute('data-content-type', 'paragraph'); node.removeAttribute('data-task-id') }
      else { node.setAttribute('data-role', 'reference'); node.setAttribute('data-plan-date', '') }
    }
    dom.querySelectorAll('[data-id]').forEach(node => node.removeAttribute('data-id'))
    editor.pasteHTML(dom.body.innerHTML, true)
    return true
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
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [touchHandle, setTouchHandle] = useState<{ id: string; top: number } | null>(null)
  const [touchDragging, setTouchDragging] = useState(false)
  const dropRef = useRef<typeof drop>(null)
  const [notice, setNotice] = useState<{ text: string; fingerprint: string } | null>(null)
  const [selectionLabel, setSelectionLabel] = useState('')
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
    if (next === base.current || page.editorJSON === lastSent.current) return
    if (dirty.current) { setFailed(true); setStatus('Page changed elsewhere · draft kept; copy it before reloading'); return }
    suppress.current = true
    editor.replaceBlocks(editor.document, editorSeed(page, workspace) as never)
    suppress.current = false
    base.current = next
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
    const oldNodes = nodes(), nextNodes = docToBlocks(transaction.doc) as unknown as EditorNode[]
    const oldById = new Map(oldNodes.map(n => [n.id, n])), nextById = new Map(nextNodes.map(n => [n.id, n]))
    const semantic = [...affected].some(taskId => {
      const old = oldNodes.find(n => n.type === 'task' && n.props?.taskId === taskId)
      const next = nextNodes.find(n => n.type === 'task' && n.props?.taskId === taskId)
      return old && next && inlineText(old.content) !== inlineText(next.content)
        || Object.entries(latestPage.current.editorDeletions ?? {}).some(([id, effect]) => effect.task.id === taskId && nextById.has(id) && !oldById.has(id))
        || direction === 'redo' && [...knownSemantic.current].some(id => oldById.get(id)?.props?.taskId === taskId && !nextById.has(id))
        || Object.entries(latestPage.current.editorCreations ?? {}).some(([id, createdTask]) => createdTask === taskId && oldById.has(id) !== nextById.has(id))
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
      const remaining = new Set(candidateNodes.map(n => n.id))
      const deleted = direction === 'redo' ? nodes().filter(n => knownSemantic.current.has(n.id) && !remaining.has(n.id)).map(n => n.id) : []
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
    setSelectionLabel(range.length > 1 ? `${inlineText(range[0]?.content)} · ${range.length - 1} blocks selected` : 'Block selected')
    if (range.length > 1) editor.setSelection(range[0]!.id, range.at(-1)!.id)
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
    setNotice({ text: first?.type === 'heading' ? `Deleted '${inlineText(first.content)}' · ${plannedCount} planned tasks stay planned` : ids.length === 1 && first?.type === 'task' && first.props?.role === 'plan' ? 'Not today · deadline kept' : 'Content removed · tasks unchanged', fingerprint: JSON.stringify(editor.document) })
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
    dragging.current = []; dropRef.current = null; setDrop(null); setTouchDragging(false)
  }
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
    const target = blocks[(nextHeading < 0 ? blocks.length : nextHeading) - 1] ?? blocks[0]
    if (target) { editor.setTextCursorPosition(target.id, 'end'); editor.focus() }
  }, [editor])
  useEffect(() => {
    const update = () => {
      const block = editor.getTextCursorPosition().block
      const el = document.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(block.id)}"]`)
      if (el) { const top = el.getBoundingClientRect().top; setTouchHandle(previous => previous?.id === block.id && Math.abs(previous.top - top) < 0.5 ? previous : { id: block.id, top }) }
    }
    const off = editor.onSelectionChange(() => requestAnimationFrame(update))
    window.addEventListener('scroll', update, true)
    return () => { off(); window.removeEventListener('scroll', update, true) }
  }, [editor])
  return <div className={`continuous-editor ${touchDragging ? 'is-touch-drag' : ''}`} aria-label="Page editor" aria-busy={historyBusy}
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
      } else if (!['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) { selected.current = []; setSelectionLabel('') }
    }}
    onDragOverCapture={e => {
      if (!dragging.current.length) return
      e.preventDefault(); e.stopPropagation()
      e.dataTransfer.dropEffect = updateDrop(e.clientX, e.clientY) ? 'move' : 'none'
    }}
    onDropCapture={e => {
      if (!dragging.current.length) return
      e.preventDefault(); e.stopPropagation(); commitDrag()
    }} onDragEnd={() => { dragging.current = []; setDrop(null) }}>
    <div className="editor-save-line" role="status">{status}{failed && <><button onClick={() => void flush()}>Retry saving</button><button onClick={async () => { await navigator.clipboard.writeText(await editor.blocksToMarkdownLossy()); setStatus('Draft copied · original kept here') }}>Copy draft</button></>}{selectionLabel && <span>{selectionLabel}</span>}</div>
    <BlockNoteView editor={editor} theme={dark ? 'dark' : 'light'} sideMenu={false} slashMenu={false}>
      <SuggestionMenuController triggerCharacter="/" shouldOpen={() => !composing.current && editor.getTextCursorPosition().block.type !== 'task'} getItems={async query => {
        const defaults = getDefaultReactSlashMenuItems(editor).filter(item => ['Heading 1', 'Heading 2', 'Heading 3', 'Paragraph', 'Bullet List', 'Numbered List', 'Quote'].includes(item.title))
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
      <SideMenuController sideMenu={Handle} />
    </BlockNoteView>
    {notice && <div className="editor-operation-notice" role="status"><span>{notice.text}</span><button onClick={() => { if (notice.fingerprint === JSON.stringify(editor.document)) void performHistory('undo'); setNotice(null) }}>Undo</button></div>}
    {touchHandle && <button className="editor-touch-handle" aria-label="Drag current section or block" style={{ top: touchHandle.top }}
      onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = sectionRange(nodes(), touchHandle.id); setTouchDragging(true) }}
      onPointerMove={e => { if (dragging.current.length && e.buttons) updateDrop(e.clientX - 35, e.clientY) }}
      onPointerUp={e => { e.preventDefault(); if (!dropRef.current) { dragging.current = []; setTouchDragging(false); select(touchHandle.id) } else commitDrag() }}
      onPointerCancel={() => { dragging.current = []; setTouchDragging(false); setDrop(null) }}>≡</button>}
    <div className="editor-phone-toolbar" aria-label="Editor tools"><button onPointerDown={e => e.preventDefault()} onClick={() => void performHistory('undo')} aria-label="Undo">↶</button><button onPointerDown={e => e.preventDefault()} onClick={() => void performHistory('redo')} aria-label="Redo">↷</button><button onPointerDown={e => e.preventDefault()} onClick={() => { editor.focus(); editor.getExtension(SuggestionMenu)?.openSuggestionMenu('/') }}>＋</button></div>
    {selectionLabel && <div className="editor-selection-bar"><span>{selectionLabel}</span><button onPointerDown={e => e.preventDefault()} onClick={deleteSelected}>Delete</button></div>}
    {drop && <div className="editor-drop-line" style={{ top: drop.top }} />}
  </div>
}
function EditorHandle({ select, dragStart }: { select(id: string): void; dragStart(id: string, e: React.DragEvent): void }) {
  const editor = useBlockNoteEditor()
  const block = useExtensionState(SideMenuExtension, { editor, selector: state => state?.block })
  const pressed = useRef<string | null>(null)
  const nativeDragging = useRef(false)
  if (!block) return null
  return <button className="editor-block-handle" draggable aria-label={block.type === 'heading' ? 'Select or drag section' : 'Select or drag block'} onPointerDown={() => { pressed.current = block.id; nativeDragging.current = false; editor.getExtension(SideMenuExtension)?.freezeMenu() }} onPointerUp={() => { if (!nativeDragging.current) select(pressed.current ?? block.id); setTimeout(() => editor.getExtension(SideMenuExtension)?.unfreezeMenu(), 0) }} onDragStart={e => { nativeDragging.current = true; dragStart(pressed.current ?? block.id, e) }} onDragEnd={() => editor.getExtension(SideMenuExtension)?.unfreezeMenu()}>⠿</button>
}
