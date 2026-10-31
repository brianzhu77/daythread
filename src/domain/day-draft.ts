// B77 (Brian 361325a5, Lead 5a15305c, Jazz 259d2c55, Ratchet 971bbb1): a new day page can carry a draft: suggestions
// the model (or the app's fallback) made for it, shown as bands on the page and applied one by one or all at once.
// The draft is a hidden page of its own (`type: "draft"`, parent = the day page), so it is stored, synced and undone
// like everything else, with no new column. Suggestions anchor to the day page's own block ids. A carried to-do is
// only ever a task id: applying it plans that task, under its current title, never a copy of its words.
import type { LocalDate, Page, Task, Workspace } from './types.ts'
import { flatNodes, inlineText, isEmptyLine, isTaskRow, pageNodes, type EditorNode } from './editor-document.ts'

export const isDraft = (p: Pick<Page, 'type'>): boolean => p.type === 'draft'
export const draftPageId = (dayPageId: string): string => `draft:${dayPageId}`

export type DraftStatus = 'preparing' | 'ready' | 'failed'
/** One suggestion. `block` is what a line or a new to-do inserts; a carried to-do has `taskId` and no words. */
export interface DraftItem {
  id: string
  anchor: string
  place: 'fill' | 'after'
  taskId?: string
  block?: EditorNode
  source: 'model' | 'fallback'
  state: 'open' | 'applied' | 'skipped'
}
export interface DayDraft { status: DraftStatus; items: DraftItem[]; moreOpen: string[] }

/** The day's draft for good: a ready one, or a failed one he already applied or skipped something from. */
export const draftSettled = (d: DayDraft): boolean => d.status === 'ready' || d.items.some(i => i.state !== 'open')

export function draftOf(ws: Workspace, dayPageId: string): DayDraft | null {
  const p = ws.pages.find(x => x.id === draftPageId(dayPageId) && isDraft(x) && !x.trashedAt)
  if (!p) return null
  try { return JSON.parse(p.document) as DayDraft } catch { return null }
}

/** A carried to-do can still be applied: it exists, is open and wasn't set aside. A rename doesn't matter. */
export const eligibleTask = (t: Task | undefined): t is Task => Boolean(t && t.status === 'open' && !t.paused)

const level = (n: EditorNode) => Number(n.props?.level ?? 1)
/**
 * The planning part of a day page, by structure only (it never reads his words): the outermost section that holds
 * the page's first to-do row; with no to-do row, the first top-level section; with no heading, the whole page.
 * Suggestions only ever land inside it, so nothing reaches his reflection or notes sections.
 */
export function planningRange(doc: readonly EditorNode[]): { start: number; end: number } {
  const headings = doc.flatMap((n, i) => (n.type === 'heading' ? [i] : []))
  if (!headings.length) return { start: 0, end: doc.length }
  const firstRow = doc.findIndex(n => flatNodes([n]).some(isTaskRow))
  let start = -1
  if (firstRow < 0) start = headings[0]!
  else {
    // Climb from the row to the outermost heading whose section holds it.
    let lowest = Infinity
    for (let i = firstRow; i >= 0; i--) if (doc[i]!.type === 'heading' && level(doc[i]!) < lowest) { lowest = level(doc[i]!); start = i }
  }
  if (start < 0) {
    const end = headings[0]!
    return { start: 0, end }
  }
  let end = start + 1
  while (end < doc.length && !(doc[end]!.type === 'heading' && level(doc[end]!) <= level(doc[start]!))) end++
  return { start, end }
}

/** Where the fallback and anything without a usable anchor go: right after the planning heading's own group. */
export function planningEndIndex(doc: readonly EditorNode[], tasks: ReadonlySet<string>): number {
  const { start, end } = planningRange(doc)
  let at = start >= 0 && doc[start]?.type === 'heading' ? start + 1 : start
  while (at < end && isTaskRow(doc[at]!) && tasks.has(String(doc[at]!.props!.taskId))) at++
  return at
}

const compatible = (anchor: EditorNode, item: Pick<DraftItem, 'taskId' | 'block'>): boolean => {
  const wantsTask = Boolean(item.taskId) || item.block?.type === 'task'
  return wantsTask ? anchor.type === 'task' : anchor.type === 'paragraph' || anchor.type === 'bulletListItem' || anchor.type === 'numberedListItem'
}

export interface Placement { kind: 'fill' | 'after'; index: number; anchorId: string | null }
/**
 * Where an item goes on the page as it is now: a fill only into a still-empty block of the right kind, else after
 * it; an anchor that is gone or outside the planning part goes to the planning end. `index` is the anchor's index
 * (fill) or the insertion index (after). `null` = nothing safe; the item stays unapplied.
 */
export function placeItem(doc: readonly EditorNode[], item: DraftItem, tasks: ReadonlySet<string>): Placement | null {
  const range = planningRange(doc)
  const at = doc.findIndex(n => n.id === item.anchor)
  const inside = at >= range.start && at < range.end
  if (at >= 0 && inside) {
    const anchor = doc[at]!
    if (item.place === 'fill' && isEmptyLine(anchor) && compatible(anchor, item)) return { kind: 'fill', index: at, anchorId: anchor.id }
    return { kind: 'after', index: at + 1, anchorId: anchor.id }
  }
  const end = planningEndIndex(doc, tasks)
  if (end < range.start || end > range.end) return null
  return { kind: 'after', index: end, anchorId: end > 0 ? doc[end - 1]!.id : null }
}

/** The bands a page shows (Jazz's hook): open items still eligible, placed against the page as it is. */
export interface DraftItemView { id: string; kind: 'fill' | 'after'; anchorId: string | null; block: EditorNode; taskId?: string; since?: LocalDate }
export interface DraftView {
  status: DraftStatus
  items: DraftItemView[]
  moreOpen: { taskId: string; title: string; since: LocalDate }[]
  planningEndId: string | null
}

export function draftView(ws: Workspace, page: Page): DraftView | null {
  const draft = draftOf(ws, page.id)
  if (!draft) return null
  const doc = pageNodes(page), ids = new Set(ws.tasks.map(t => t.id))
  const onPage = new Set(flatNodes(doc).filter(isTaskRow).map(n => String(n.props!.taskId)))
  const task = (id: string | undefined) => ws.tasks.find(t => t.id === id)
  const items: DraftItemView[] = []
  for (const item of draft.items) {
    if (item.state !== 'open') continue
    const t = task(item.taskId)
    if (item.taskId && (!eligibleTask(t) || onPage.has(t.id))) continue
    const at = placeItem(doc, item, ids)
    if (!at) continue
    const block = t ? { id: `draft-row:${item.id}`, type: 'task', props: { taskId: t.id, role: 'plan', planDate: page.date ?? '' }, content: [{ type: 'text', text: t.title, styles: {} }], children: [] } : item.block!
    items.push({ id: item.id, kind: at.kind, anchorId: at.anchorId, block, ...(t ? { taskId: t.id, since: t.createdOn } : {}) })
  }
  const end = planningEndIndex(doc, ids)
  const moreOpen = draft.moreOpen.map(task).filter(eligibleTask).filter(t => !onPage.has(t.id)).map(t => ({ taskId: t.id, title: t.title, since: t.createdOn }))
  return { status: draftSettled(draft) ? 'ready' : draft.status, items, moreOpen, planningEndId: end > 0 ? doc[end - 1]!.id : null }
}

/** A draft as the server built it, checked before it is stored: ids it may use, kinds, lengths, no duplicates. */
export function normalizeDraftItems(ws: Workspace, page: Page, items: readonly DraftItem[], allowedTasks: ReadonlySet<string>): DraftItem[] {
  const doc = pageNodes(page), range = planningRange(doc), seenTasks = new Set<string>(), seenIds = new Set<string>(), out: DraftItem[] = []
  for (const item of items) {
    if (seenIds.has(item.id) || !item.id || item.id.length > 100) continue
    seenIds.add(item.id)
    const at = doc.findIndex(n => n.id === item.anchor)
    const outside = at >= 0 && (at < range.start || at >= range.end)
    if (item.taskId) {
      if (!allowedTasks.has(item.taskId) || seenTasks.has(item.taskId) || !eligibleTask(ws.tasks.find(t => t.id === item.taskId))) continue
      seenTasks.add(item.taskId)
      // An anchor that is outside the planning part now (he moved it while the draft was made) never drops the to-do:
      // it goes to the planning end instead (Ratchet c1de8d2f).
      out.push({ id: item.id, anchor: outside ? '' : item.anchor, place: outside ? 'after' : item.place, taskId: item.taskId, source: item.source, state: 'open' })
    } else if (outside) {
      continue
    } else if (item.block && ['paragraph', 'bulletListItem', 'task'].includes(item.block.type) && inlineText(item.block.content).trim() && inlineText(item.block.content).length <= 500) {
      const words = inlineText(item.block.content).trim()
      const block: EditorNode = { id: item.block.id, type: item.block.type, props: item.block.type === 'task' ? { taskId: '', role: 'plan', planDate: page.date ?? '' } : {}, content: [{ type: 'text', text: words, styles: {} }], children: [] }
      out.push({ id: item.id, anchor: item.anchor, place: item.place, block, source: item.source, state: 'open' })
    }
  }
  return out
}
