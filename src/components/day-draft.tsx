// B76 (Jazz docs/design/day-draft-states.md, Lead 5a15305c): a new day's draft shown on the page itself. Each suggestion
// is a band after its anchor block, drawn by a ProseMirror widget like the Events rows, so it is never part of the
// document until he applies it. The data side (the hidden draft page, draftView, apply-draft / skip-draft) is
// Roadbuster's; `useDayDraft` is the seam between the two.
import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { type Node as PMNode } from '@tiptap/pm/model'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { inlineText, type EditorNode } from '../domain/editor-document'
import type { LocalDate, Page, Workspace } from '../domain/types'
import { shortLabel } from './dates'
import { useDayDraft as useRealDayDraft } from './use-day-draft'

export type DraftState = 'none' | 'preparing' | 'ready' | 'failed' | 'offline'
export type DraftItem = {
  id: string
  /** Already resolved by the data side: a fill whose anchor has text arrives as 'after'. */
  kind: 'fill' | 'after'
  /** A block of the day page; a gone anchor arrives already moved to the end of the planning part. */
  anchorId: string
  /** What applying inserts. A carried to-do carries `props.taskId`; its title is read live from the task. */
  block: EditorNode
  /** Carried to-dos only: the day it was first planned, shown as its age. */
  since?: LocalDate
}
export type OpenTask = { taskId: string; title: string; since: LocalDate }
export interface DayDraft {
  state: DraftState
  /** Pending and still eligible, in page order. */
  items: DraftItem[]
  moreOpen: OpenTask[]
  /** "N more open" sits after this block: the end of the planning part. */
  planningEndId: string | null
  apply(itemIds: string[], edits?: Record<string, string>): Promise<{ applied: string[]; dropped: string[] }>
  skip(itemIds: string[]): Promise<boolean>
  addOpen(taskId: string): Promise<boolean>
  retry(): void
}

// ---------- The seam: Roadbuster's hook (use-day-draft.ts); a check script's store (`window.__daythreadDraft`) overrides it. ----------

type MockDraft = Pick<DayDraft, 'state' | 'items' | 'moreOpen' | 'planningEndId'>
type MockWindow = Window & { __daythreadDraft?: Record<string, MockDraft>; __daythreadDraftLog?: unknown[] }
const listeners = new Set<() => void>()
let version = 0
const bump = () => { version++; listeners.forEach(l => l()) }
if (typeof window !== 'undefined') (window as MockWindow & { __daythreadDraftBump?: () => void }).__daythreadDraftBump = bump
const mockOf = (pageId: string): MockDraft | undefined => typeof window === 'undefined' ? undefined : ((window as MockWindow).__daythreadDraft?.[pageId] ?? (window as MockWindow).__daythreadDraft?.['*'])
const log = (entry: unknown) => { const w = window as MockWindow; (w.__daythreadDraftLog ??= []).push(entry) }

export function useDayDraft(page: Page): DayDraft {
  useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => version, () => 0)
  const real = useRealDayDraft(page)
  const mock = mockOf(page.id)
  // The real draft (use-day-draft.ts) unless a check script set a stand-in for this page.
  if (!mock) return { ...real, items: real.items.map(i => ({ id: i.id, kind: i.kind, anchorId: i.anchorId ?? real.planningEndId ?? '', block: i.block, ...(i.since ? { since: i.since } : {}) })) }
  const edit = (ids: string[]) => { if (mock) { mock.items = mock.items.filter(i => !ids.includes(i.id)); bump() } }
  return {
    state: mock?.state ?? 'none',
    items: mock?.items ?? [],
    moreOpen: mock?.moreOpen ?? [],
    planningEndId: mock?.planningEndId ?? null,
    apply: async (ids, edits) => { log({ apply: ids, edits }); edit(ids); return { applied: ids, dropped: [] } },
    skip: async ids => { log({ skip: ids }); edit(ids); return true },
    addOpen: async taskId => { log({ addOpen: taskId }); if (mock) { mock.moreOpen = mock.moreOpen.filter(t => t.taskId !== taskId); bump() } return true },
    retry: () => { log({ retry: true }); if (mock) { mock.state = 'preparing'; bump() } },
  }
}

// ---------- Held while he types (states §2 "Arrived while he's typing") ----------

/** The last keystroke in a page editor; suggestions that arrive within 3 s of one wait for Show or a 3 s pause. */
let lastKey = 0
const HOLD_MS = 3000
if (typeof document !== 'undefined') document.addEventListener('keydown', e => { if ((e.target as HTMLElement | null)?.closest?.('.continuous-editor')) lastKey = Date.now() }, true)
const revealed = new Map<string, boolean>()

/**
 * Whether the bands for this page show. They're held when they arrive while he is typing, and released by Show or a
 * 3 s pause; the release keeps the line he is looking at where it is.
 */
export function useDraftReveal(pageId: string, ready: boolean): { shown: boolean; show: () => void } {
  const [, force] = useState(0)
  const was = useRef(ready)
  if (!ready) revealed.delete(pageId)
  if (ready && !was.current && !revealed.has(pageId)) revealed.set(pageId, Date.now() - lastKey >= HOLD_MS)
  if (ready && !revealed.has(pageId)) revealed.set(pageId, true)
  was.current = ready
  const shown = !ready || revealed.get(pageId) === true
  const show = () => { keepView(() => { revealed.set(pageId, true); bump(); force(n => n + 1) }) }
  useEffect(() => {
    if (shown) return
    const timer = setInterval(() => { if (Date.now() - lastKey >= HOLD_MS) show() }, 500)
    return () => clearInterval(timer)
  })
  return { shown, show }
}

/** Runs `change` and scrolls so the line he's on (the caret's, else the first in view) stays at the same height. */
function keepView(change: () => void) {
  const blocks = [...document.querySelectorAll<HTMLElement>('.continuous-editor .bn-block-outer')]
  const node = window.getSelection()?.anchorNode
  const caret = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('.continuous-editor .bn-block-outer')
  const inView = (b: HTMLElement) => { const r = b.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight }
  const anchor = caret && inView(caret) ? caret : blocks.find(b => b.getBoundingClientRect().bottom > 0)
  const before = anchor?.getBoundingClientRect().top
  change()
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (anchor && before !== undefined && anchor.isConnected) window.scrollBy(0, anchor.getBoundingClientRect().top - before)
  }))
}

// ---------- The bands: one widget per anchor, React rendered into it through a portal ----------

/**
 * Typed edits per item (item ids are unique), shared by a band's own Apply and the line's Apply all, so his words
 * are what gets applied either way (Ratchet 425687c4). Kept outside React so a re-render doesn't lose them.
 */
const bandEdits = new Map<string, string>()
const editsFor = (ids: string[]) => Object.fromEntries(ids.filter(id => bandEdits.has(id)).map(id => [id, bandEdits.get(id)!]))

const key = new PluginKey<DecorationSet>('daythread-draft-bands')
/** `afterId`: the block the group follows; '' = the top of the page (Ratchet 11e83453). */
export type BandGroup = { afterId: string; host: HTMLElement }

function place(doc: PMNode, groups: BandGroup[]): DecorationSet {
  if (!groups.length) return DecorationSet.empty
  // '' = the top of the page (no heading above the planning part), inside its block group, as the Events rows do.
  const at = new Map<string, number>([['', 1]])
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockContainer' && node.attrs.id) at.set(String(node.attrs.id), pos + node.nodeSize)
    return true
  })
  const decos = groups.filter(g => at.has(g.afterId)).map(g => Decoration.widget(at.get(g.afterId)!, g.host, { key: `draft-${g.afterId}`, side: -1, ignoreSelection: true, stopEvent: () => true }))
  return DecorationSet.create(doc, decos)
}

/** `groups()` is read on every document change and when `refreshDraftBands` asks (the draft changed). */
export const draftBands = (groups: () => BandGroup[]) => createExtension({
  key: 'daythreadDraftBands',
  prosemirrorPlugins: [new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => place(state.doc, groups()),
      apply: (tr, old) => tr.docChanged || tr.getMeta(key) ? place(tr.doc, groups()) : old,
    },
    props: { decorations: state => key.getState(state) },
  })],
})
export const refreshDraftBands = (view: EditorView) => view.dispatch(view.state.tr.setMeta(key, true))

/** Hosts for the bands and the "more open" row, by anchor block id, kept across renders so the widgets stay put. */
export function useBandHosts() {
  const hosts = useRef(new Map<string, HTMLElement>())
  return useMemo(() => (id: string) => {
    let h = hosts.current.get(id)
    if (!h) { h = Object.assign(document.createElement('div'), { className: 'draft-host', contentEditable: 'false' }); hosts.current.set(id, h) }
    return h
  }, [])
}

/** Groups items by anchor, in order, and adds the "more open" row's anchor. */
export function bandGroups(draft: DayDraft, shown: boolean, host: (id: string) => HTMLElement): (BandGroup & { items: DraftItem[]; more: boolean })[] {
  if (!shown || (draft.state !== 'ready' && draft.state !== 'failed' && draft.state !== 'offline')) return []
  const groups = new Map<string, DraftItem[]>()
  for (const item of draft.items) groups.set(item.anchorId, [...(groups.get(item.anchorId) ?? []), item])
  const out = [...groups].map(([afterId, items]) => ({ afterId, host: host(afterId), items, more: false }))
  const end = draft.planningEndId ?? ''
  if (draft.moreOpen.length) {
    const g = out.find(o => o.afterId === end)
    if (g) g.more = true
    else out.push({ afterId: end, host: host(end), items: [], more: true })
  }
  return out
}

/** Fill anchors: the empty template rows a band takes the place of, hidden while it shows. */
export const fillAnchors = (draft: DayDraft, shown: boolean) => shown ? draft.items.filter(i => i.kind === 'fill').map(i => i.anchorId) : []

const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
const CrossIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
const PlusIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>

/** The text a band shows: a carried to-do's current title (Bumblebee 21e0ae02), else the block's own text. */
function bandText(item: DraftItem, workspace: Workspace): string {
  const taskId = item.block.props?.taskId
  const task = typeof taskId === 'string' ? workspace.tasks.find(t => t.id === taskId) : undefined
  return task ? task.title : inlineText(item.block.content)
}

function Band({ item, workspace, edits, onApply, onSkip }: { item: DraftItem; workspace: Workspace; edits: Map<string, string>; onApply: () => void; onSkip: () => void }) {
  const text = bandText(item, workspace)
  const kind = item.block.type === 'task' ? 'task' : item.block.type === 'bulletListItem' ? 'bullet' : 'line'
  return (
    <div className={`draft-band is-${kind}`} data-draft-item={item.id}>
      {kind === 'task' && <span className="draft-box" aria-hidden="true" />}
      <span className="draft-text" contentEditable suppressContentEditableWarning spellCheck={false}
        onInput={e => edits.set(item.id, (e.currentTarget.textContent ?? '').trim())}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); onApply() } }}>{text}</span>
      {item.since && <span className="draft-since">{shortLabel(item.since)}</span>}
      <span className="draft-acts">
        <button type="button" aria-label={`Apply ${text}`} title="Apply" onClick={onApply}><CheckIcon /></button>
        <button type="button" aria-label={`Skip ${text}`} title="Skip" onClick={onSkip}><CrossIcon /></button>
      </span>
    </div>
  )
}

function MoreOpen({ tasks, onAdd }: { tasks: OpenTask[]; onAdd: (taskId: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="draft-more">
      <button type="button" className="draft-more-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>{tasks.length} more open <span className="draft-chev" aria-hidden="true">▸</span></button>
      {open && tasks.map(t => (
        <div key={t.taskId} className="draft-band is-task is-open-row">
          <span className="draft-box" aria-hidden="true" />
          <span className="draft-text">{t.title}</span>
          <span className="draft-since">{shortLabel(t.since)}</span>
          <span className="draft-acts"><button type="button" aria-label={`Add ${t.title} to today`} title="Add to today" onClick={() => onAdd(t.taskId)}><PlusIcon /></button></span>
        </div>
      ))}
    </div>
  )
}

/** Everything the page editor renders for the draft: the bands in their hosts, and the style hiding filled anchors. */
export function DraftBands({ draft, workspace, groups, fills }: { draft: DayDraft; workspace: Workspace; groups: ReturnType<typeof bandGroups>; fills: string[] }): ReactNode {
  const edits = bandEdits
  return <>
    {fills.length > 0 && <style>{fills.map(id => `.continuous-editor .bn-block-outer[data-id="${CSS.escape(id)}"]`).join(',')}{'{display:none}'}</style>}
    {groups.map(g => createPortal(<>
      {g.items.map(item => <Band key={item.id} item={item} workspace={workspace} edits={edits}
        onApply={() => void draft.apply([item.id], editsFor([item.id]))} onSkip={() => void draft.skip([item.id])} />)}
      {g.more && <MoreOpen tasks={draft.moreOpen} onAdd={id => void draft.addOpen(id)} />}
    </>, g.host, g.afterId))}
  </>
}

/** The one line under the title (states §1, §2). Nothing explains anything (Brian 1ac6784b). */
export function DraftLine({ page }: { page: Page }) {
  const draft = useDayDraft(page)
  const ready = draft.state === 'ready' || draft.state === 'failed' || draft.state === 'offline'
  const { shown, show } = useDraftReveal(page.id, ready && draft.items.length > 0)
  const n = draft.items.length
  const ids = draft.items.map(i => i.id)
  const all = (fn: 'apply' | 'skip') => keepView(() => void (fn === 'apply' ? draft.apply(ids, editsFor(ids)) : draft.skip(ids)))
  if (draft.state === 'none') return null
  if (draft.state === 'preparing') return <p className="draft-line" role="status"><span className="draft-spin" aria-hidden="true" />Preparing…</p>
  if (n > 0 && !shown) return <p className="draft-line" role="status">Suggestions ready<span className="sep"> · </span><button type="button" className="draft-primary" onClick={show}>Show</button></p>
  const counts = n > 0 && <>{n} suggestion{n === 1 ? '' : 's'}<span className="sep"> · </span><button type="button" className="draft-primary" onClick={() => all('apply')}>Apply all</button><span className="sep"> · </span><button type="button" onClick={() => all('skip')}>Dismiss</button></>
  const tail = draft.state === 'failed' ? <><span className="draft-warn">Couldn’t draft</span><span className="sep"> · </span><button type="button" onClick={() => draft.retry()}>Retry</button></>
    : draft.state === 'offline' ? <>Offline</> : null
  if (!counts && !tail) return null
  return <p className="draft-line" role="status">{counts}{counts && tail && <span className="sep"> · </span>}{tail}</p>
}
