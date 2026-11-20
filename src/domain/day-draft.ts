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
  /** On a skipped to-do: the later day he moved it to from the draft (`snooze-draft`, Brian 17e7b7f2). */
  until?: LocalDate
  /** The operation that last skipped, moved or applied it: `reopen-draft` reopens only what that skip left (Ratchet f38d66a1). */
  by?: string
  /** A carried line: the block it was carried from, so another day's draft holding it too doesn't offer it twice (B101). */
  from?: string
  /** A plan written for a day he didn't use (B101): the day he wrote it, shown as its age, as a carried to-do shows its own. */
  since?: LocalDate
  /** The recipe that made it, on an item a remake kept from an older draft (absent: its draft's own). */
  recipe?: number
  /** Applied: the block it became on the page, so the next one applied at its spot lands in the offered order (B102). */
  row?: string
}
/** `recipe`: how the server made it (`DRAFT_RECIPE`); absent on a draft from before it was kept. */
export interface DayDraft { status: DraftStatus; items: DraftItem[]; moreOpen: string[]; recipe?: number }

/**
 * How day drafts are made now: 2 reads every page edited in the last 7 days and puts what he wrote for the day first
 * (Brian 3d7aca46); 3 reads a plan written for a day he didn't use as written for the day he opens, and keeps where each
 * carried line came from (B101); 4 carries the open to-do lines of a skipped day's draft itself, whatever the model
 * answers (Lead bf60ec67). Raising it makes today's draft once more, where today's page is opened; past days keep theirs.
 */
export const DRAFT_RECIPE = 4
/** The first recipe that carries a skipped day's open to-do lines itself (`withSkippedPlan`). */
const CARRY_RECIPE = 4
/** The first recipe whose carried lines say where they came from (`from`); an older draft's lines are known by their words. */
const FROM_RECIPE = 3
const recipeOf = (d: DayDraft): number => d.recipe ?? 1

/** The day's draft for good: a ready one, or a failed one he already applied or skipped something from. */
export const draftSettled = (d: DayDraft): boolean => d.status === 'ready' || d.items.some(i => i.state !== 'open')
/** A settled draft an older recipe made: today's is made again once, keeping what he applied or skipped from it. */
export const draftStale = (d: DayDraft): boolean => draftSettled(d) && recipeOf(d) < DRAFT_RECIPE
/** Whether a new draft by `recipe` may take the place of `old`: one not settled yet, or one settled by an older recipe. */
export const draftReplaceable = (old: DayDraft, recipe: number): boolean => !draftSettled(old) || recipeOf(old) < recipe

export function draftOf(ws: Workspace, dayPageId: string): DayDraft | null {
  const p = ws.pages.find(x => x.id === draftPageId(dayPageId) && isDraft(x) && !x.trashedAt)
  if (!p) return null
  try { return JSON.parse(p.document) as DayDraft } catch { return null }
}

/** Words compared for "the same line": case, spacing and a trailing stop don't count. */
export const sameWords = (s: string): string => s.toLocaleLowerCase().replace(/\s+/g, ' ').replace(/[\s.。!！]+$/u, '').trim()

/**
 * Whether he acted on a day page (B101): he edited it, or applied or skipped something from its draft. A page a tab
 * only opened, made from his template, isn't one, nor is a to-do planned onto it from another day.
 */
export const actedOn = (ws: Workspace, p: Page): boolean => Boolean(p.editedAt) || Boolean(draftOf(ws, p.id)?.items.some(i => i.state !== 'open'))

/**
 * Lead 312046f4 (option 2): a day he never acted on hands its to-do lines on to the next draft that carried them, and
 * then stops offering them, so one line is never offered in two drafts and nothing has to match it. That draft is a
 * stored one (ready, or failed with what the app carried) made by a recipe that carries, for a later day, with no day
 * he acted on in between (Ratchet f03b7b89: not a page alone, nor a draft still preparing). Its plain lines stay.
 */
export function linesCarriedOn(ws: Workspace, dayPage: Page): boolean {
  if (dayPage.type !== 'daily' || !dayPage.date || actedOn(ws, dayPage)) return false
  const later = ws.pages.filter(p => p.type === 'daily' && p.date !== null && p.date > dayPage.date! && !p.trashedAt).sort((a, b) => (a.date! < b.date! ? -1 : 1))
  for (const p of later) {
    const d = draftOf(ws, p.id)
    if (d && (d.status === 'ready' || d.status === 'failed') && recipeOf(d) >= CARRY_RECIPE) return true
    if (actedOn(ws, p)) return false
  }
  return false
}
/** A to-do line (not a carried to-do, nor a plain line). */
export const isTodoLine = (i: DraftItem): boolean => !i.taskId && i.block?.type === 'task'

/** The recipe that made an item: one a remake kept from an older draft says so itself (Ratchet 5dd205a3). */
const itemRecipe = (i: DraftItem, d: DayDraft): number => i.recipe ?? recipeOf(d)

/**
 * B101: a plan line can sit in two days' drafts: the day it was written for and, when he didn't use that day, the next
 * day he opens. Once he applied or skipped it in one, no other offers it. A line is known by the block it was carried
 * from. An item an older recipe made has no such block and is known by its words, but only against a line that could
 * have been in its draft: one from a page dated before that draft's day (Ratchet 5dd205a3), so the same words written
 * again on a later page aren't taken for it. A to-do carried by its id needs none of this: it's planned.
 */
export function decidedElsewhere(ws: Workspace, dayPage: Page): (item: DraftItem) => boolean {
  const own = draftOf(ws, dayPage.id)
  type Decided = { from?: string; words: string; old: boolean; day: LocalDate | null }
  const decided: Decided[] = []
  for (const p of ws.pages) {
    if (!isDraft(p) || p.trashedAt || p.id === draftPageId(dayPage.id)) continue
    let d: DayDraft
    try { d = JSON.parse(p.document) as DayDraft } catch { continue }
    const day = ws.pages.find(x => x.id === p.parentId)?.date ?? null
    for (const i of d.items) {
      if (i.state === 'open' || !i.block) continue
      decided.push({ ...(i.from ? { from: i.from } : {}), words: sameWords(inlineText(i.block.content)), old: itemRecipe(i, d) < FROM_RECIPE, day })
    }
  }
  // The day of the page a line was carried from: a day page's date, another page's creation day; null when unknown.
  const days = new Map<string, LocalDate | null>()
  const sourceDay = (id: string): LocalDate | null => {
    if (!days.has(id)) {
      const p = ws.pages.find(x => !isDraft(x) && flatNodes(pageNodes(x)).some(n => n.id === id))
      days.set(id, p ? (p.type === 'daily' ? p.date : p.createdAt?.slice(0, 10) ?? null) : null)
    }
    return days.get(id)!
  }
  // Could the line carried from `id` have been in a draft for `day`? Unknown counts as yes: a second copy is the worse mistake.
  const readable = (id: string, day: LocalDate | null): boolean => { const s = sourceDay(id); return s === null || day === null || s < day }
  return item => {
    if (!item.block) return false
    const words = sameWords(inlineText(item.block.content)), old = own ? itemRecipe(item, own) < FROM_RECIPE : true
    return decided.some(x => {
      if (item.from && x.from) return item.from === x.from
      if (!words || words !== x.words) return false
      if (old && x.old) return true
      if (old && x.from) return readable(x.from, dayPage.date)
      if (x.old && item.from) return readable(item.from, x.day)
      return false
    })
  }
}

/**
 * The items of a draft made again over `old` (Brian 3d7aca46): what he applied or skipped stays as he left it, and the
 * new suggestions follow, without a to-do or words he has already decided on.
 */
export function remadeItems(old: DayDraft | null, items: readonly DraftItem[]): DraftItem[] {
  // Each kept item says which recipe made it, so a later check knows it has no `from` (Ratchet 5dd205a3).
  const decided = old?.items.filter(i => i.state !== 'open').map(i => (i.recipe ? i : { ...i, recipe: recipeOf(old) })) ?? []
  if (!decided.length) return [...items]
  const ids = new Set(decided.map(i => i.id)), tasks = new Set(decided.flatMap(i => (i.taskId ? [i.taskId] : [])))
  const words = new Set(decided.flatMap(i => (i.block ? [sameWords(inlineText(i.block.content))] : [])))
  return [...decided, ...items.filter(i => !ids.has(i.id) && !(i.taskId && tasks.has(i.taskId)) && !(i.block && words.has(sameWords(inlineText(i.block.content)))))]
}

/** A carried to-do can still be applied: it exists, is open and wasn't set aside. A rename doesn't matter. */
export const eligibleTask = (t: Task | undefined): t is Task => Boolean(t && t.status === 'open' && !t.paused)

/**
 * The to-dos planned for a day after `day`: a plan row on a later day page. A draft for `day` never offers one, so a
 * to-do moved to Monday (Another day, or Move to from the draft) doesn't come back before then (Brian 17e7b7f2).
 */
export function plannedAfter(ws: Workspace, day: LocalDate): Set<string> {
  const out = new Set<string>()
  for (const p of ws.pages) {
    if (p.type !== 'daily' || !p.date || p.date <= day || p.trashedAt) continue
    for (const n of flatNodes(pageNodes(p))) if (isTaskRow(n) && n.props?.role === 'plan') out.add(String(n.props.taskId))
  }
  return out
}
/**
 * Whether a draft for a day may offer this to-do: it can be applied and isn't planned for a later day. One check for
 * what the model is shown, what its answer may keep, what a draft shows, what Apply plans and "more open" (Lead 12f0a394).
 */
export const offeredOn = (t: Task | undefined, later: ReadonlySet<string>): t is Task => eligibleTask(t) && !later.has(t.id)

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

/**
 * Where "N more open ▸" goes (Jazz states §1, Bumblebee 3b778b83): the end of the planning part, after his own rows and
 * before a divider closing it, never between the heading and its rows. With no headings the whole page is the planning
 * part, so it goes after the last to-do row instead of below his notes, or with the fallback bands if there are none.
 */
export function moreOpenAfterIndex(doc: readonly EditorNode[], planningEnd: number): number {
  const { start, end } = planningRange(doc)
  if (!doc.some(n => n.type === 'heading')) {
    for (let i = doc.length - 1; i >= 0; i--) if (flatNodes([doc[i]!]).some(isTaskRow)) return i
    return planningEnd - 1
  }
  let last = end - 1
  while (last > start && doc[last]!.type === 'divider') last--
  return last
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

/**
 * B102 (Jazz 6d7d064e, Lead ee097068): where an item applied on its own goes among the rows already applied from the
 * same draft at its spot, so applying one at a time ends in the order offered, as Apply all does. Those rows are the
 * ones sitting together right where it would go: it goes after the ones offered before it and before the ones offered
 * after it. A row he deleted, moved away or typed something before is no longer one of them, so the next row lands after
 * the nearest earlier one still there, or at the spot itself when none is. The bands still waiting are shown the same way.
 */
export function amongApplied(doc: readonly EditorNode[], draft: DayDraft, item: DraftItem, at: Placement): Placement {
  const order = draft.items.findIndex(i => i.id === item.id)
  const byRow = new Map<string, number>(), byTask = new Map<string, number>(), byWords = new Map<string, number>()
  draft.items.forEach((i, n) => {
    if (i.state !== 'applied' || i.anchor !== item.anchor || i.id === item.id) return
    // Applied before rows were kept: a to-do by its row, a line by its words.
    if (i.row) byRow.set(i.row, n)
    else if (i.taskId) byTask.set(i.taskId, n)
    else if (i.block) byWords.set(sameWords(inlineText(i.block.content)), n)
  })
  const orderOf = (n: EditorNode): number | undefined =>
    byRow.get(n.id) ?? (isTaskRow(n) ? byTask.get(String(n.props!.taskId)) : undefined) ?? byWords.get(sameWords(inlineText(n.content)))
  // The group around where it would go, looking back too: a slot an earlier tap filled is that row itself, and a
  // missing anchor's fallback already sits past the rows applied there (Ratchet 006442d8).
  const groupStart = (from: number) => { let i = from; while (i > 0 && orderOf(doc[i - 1]!) !== undefined) i--; return i }
  const earlierIn = (from: number) => { for (let i = groupStart(from); i < doc.length; i++) { const o = orderOf(doc[i]!); if (o === undefined) return false; if (o < order) return true } return false }
  // An empty slot is filled only by the first of the group: with one offered before it already applied there (a line
  // that couldn't fill it went after it), this one goes after that, as Apply all does (Ratchet 0297bd0e).
  if (at.kind === 'fill') {
    if (!earlierIn(at.index + 1)) return at
    at = { kind: 'after', index: at.index + 1, anchorId: doc[at.index]!.id }
  }
  const start = groupStart(at.index)
  let index = start
  for (let i = start; i < doc.length; i++) {
    const o = orderOf(doc[i]!)
    if (o === undefined || o > order) break
    index = i + 1
  }
  return { kind: 'after', index, anchorId: index > 0 ? doc[index - 1]!.id : null }
}

/** The bands a page shows (Jazz's hook): open items still eligible, placed against the page as it is. */
export interface DraftItemView { id: string; kind: 'fill' | 'after'; anchorId: string | null; block: EditorNode; taskId?: string; since?: LocalDate }
export interface DraftView {
  status: DraftStatus
  items: DraftItemView[]
  moreOpen: { taskId: string; title: string; since: LocalDate }[]
  planningEndId: string | null
  /** The last block of the planning part: "N more open ▸" goes after his own rows, not between the heading and them. */
  moreOpenAfterId: string | null
}

export function draftView(ws: Workspace, page: Page): DraftView | null {
  const draft = draftOf(ws, page.id)
  if (!draft) return null
  const doc = pageNodes(page), ids = new Set(ws.tasks.map(t => t.id))
  const onPage = new Set(flatNodes(doc).filter(isTaskRow).map(n => String(n.props!.taskId)))
  const later = page.date ? plannedAfter(ws, page.date) : new Set<string>()
  const task = (id: string | undefined) => ws.tasks.find(t => t.id === id)
  const elsewhere = draft.items.some(i => i.state === 'open' && i.block) ? decidedElsewhere(ws, page) : () => false
  const handedOn = draft.items.some(i => i.state === 'open' && isTodoLine(i)) && linesCarriedOn(ws, page)
  const items: DraftItemView[] = []
  for (const item of draft.items) {
    if (item.state !== 'open') continue
    const t = task(item.taskId)
    if (item.taskId && (!offeredOn(t, later) || onPage.has(t.id))) continue
    if (!item.taskId && elsewhere(item)) continue
    if (handedOn && isTodoLine(item)) continue
    const placed = placeItem(doc, item, ids)
    if (!placed) continue
    const at = amongApplied(doc, draft, item, placed)
    const block = t ? { id: `draft-row:${item.id}`, type: 'task', props: { taskId: t.id, role: 'plan', planDate: page.date ?? '' }, content: [{ type: 'text', text: t.title, styles: {} }], children: [] } : item.block!
    items.push({ id: item.id, kind: at.kind, anchorId: at.anchorId, block, ...(t ? { taskId: t.id, since: t.createdOn } : item.since ? { since: item.since } : {}) })
  }
  const end = planningEndIndex(doc, ids)
  const moreOpen = draft.moreOpen.map(task).filter(t => offeredOn(t, later)).filter(t => !onPage.has(t.id)).map(t => ({ taskId: t.id, title: t.title, since: t.createdOn }))
  const last = moreOpenAfterIndex(doc, end)
  return { status: draftSettled(draft) ? 'ready' : draft.status, items, moreOpen, planningEndId: end > 0 ? doc[end - 1]!.id : null, moreOpenAfterId: last >= 0 ? doc[last]!.id : null }
}

/** A draft as the server built it, checked before it is stored: ids it may use, kinds, lengths, no duplicates. */
export function normalizeDraftItems(ws: Workspace, page: Page, items: readonly DraftItem[], allowedTasks: ReadonlySet<string>): DraftItem[] {
  const doc = pageNodes(page), range = planningRange(doc), seenTasks = new Set<string>(), seenIds = new Set<string>(), out: DraftItem[] = []
  // Checked against the workspace as it is when the draft is stored: an answer to an older ask can't bring back a
  // to-do moved to a later day meanwhile.
  const later = page.date ? plannedAfter(ws, page.date) : new Set<string>()
  for (const item of items) {
    if (seenIds.has(item.id) || !item.id || item.id.length > 100) continue
    seenIds.add(item.id)
    const at = doc.findIndex(n => n.id === item.anchor)
    const outside = at >= 0 && (at < range.start || at >= range.end)
    if (item.taskId) {
      if (!allowedTasks.has(item.taskId) || seenTasks.has(item.taskId) || !offeredOn(ws.tasks.find(t => t.id === item.taskId), later)) continue
      seenTasks.add(item.taskId)
      // An anchor that is outside the planning part now (he moved it while the draft was made) never drops the to-do:
      // it goes to the planning end instead (Ratchet c1de8d2f).
      out.push({ id: item.id, anchor: outside ? '' : item.anchor, place: outside ? 'after' : item.place, taskId: item.taskId, source: item.source, state: 'open' })
    } else if (outside) {
      continue
    } else if (item.block && ['paragraph', 'bulletListItem', 'task'].includes(item.block.type) && inlineText(item.block.content).trim() && inlineText(item.block.content).length <= 500) {
      const words = inlineText(item.block.content).trim()
      const block: EditorNode = { id: item.block.id, type: item.block.type, props: item.block.type === 'task' ? { taskId: '', role: 'plan', planDate: page.date ?? '' } : {}, content: [{ type: 'text', text: words, styles: {} }], children: [] }
      const from = typeof item.from === 'string' && item.from && item.from.length <= 200 ? { from: item.from } : {}
      const since = typeof item.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.since) && page.date && item.since < page.date ? { since: item.since } : {}
      out.push({ id: item.id, anchor: item.anchor, place: item.place, block, source: item.source, state: 'open', ...from, ...since })
    }
  }
  return out
}
