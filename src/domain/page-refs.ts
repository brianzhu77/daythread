// A9a (docs/plan/a9-page-links.md §1–§2): inline `[[` links in editor content, and the identity and time of every
// reference (cards and links), so Linked from (B15), A2's Undo check and Trash all read the same thing.
import type { NoteBlock, Page, PageRefEntry, Section, Workspace } from './types.ts'

export interface InlineRef { refId: string; pageId: string; newTitle?: string; lineId?: string; taskId?: string }
type Inline = { type?: string; text?: string; content?: unknown; props?: Record<string, unknown> }

/** The `pageRef` nodes of one line's inline content, in order. */
export function inlineRefs(content: unknown): InlineRef[] {
  if (!Array.isArray(content)) return []
  return (content as Inline[]).flatMap((c) => {
    if (c?.type === 'pageRef') {
      const p = c.props ?? {}
      return [{ refId: String(p.refId ?? ''), pageId: String(p.pageId ?? ''), ...(p.newTitle ? { newTitle: String(p.newTitle) } : {}),
        ...(p.lineId ? { lineId: String(p.lineId) } : {}), ...(p.taskId ? { taskId: String(p.taskId) } : {}) }]
    }
    return c && typeof c === 'object' && 'content' in c ? inlineRefs(c.content) : []
  })
}

/** A line's words with each link read as a title (`titleOf(refId)`), for the stored `NoteBlock.text`. */
export function lineText(content: unknown, titleOf: (ref: InlineRef) => string): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Inline[]).map((c) => {
    if (!c || typeof c !== 'object') return ''
    if (c.type === 'pageRef') return titleOf({ refId: String(c.props?.refId ?? ''), pageId: String(c.props?.pageId ?? '') })
    return 'text' in c ? String(c.text) : 'content' in c ? lineText(c.content, titleOf) : ''
  }).join('')
}

/** The title a stored line used for each of its links (what `NoteBlock.text` was built from). */
export const savedTitle = (b: Pick<NoteBlock, 'refs'> | Pick<Section, 'refs'> | undefined) => (ref: InlineRef) => b?.refs?.find((r) => r.refId === ref.refId)?.title ?? ''

/** A page's title for a link, read live. */
export function liveTitle(ws: Workspace, ref: InlineRef): string {
  return ws.pages.find((p) => p.id === ref.pageId)?.title ?? ref.newTitle ?? ''
}

/**
 * Every line of a page that can hold `[[` links: headings (sections) and blocks, each with its id. Every reader of
 * references goes through this, so a link in a heading counts exactly like one in a line (Ratchet #84).
 */
export function refHolders(page: Page): { id: string; refs: PageRefEntry[] }[] {
  return page.sections.flatMap((s) => [...(s.refs?.length ? [{ id: s.id, refs: s.refs }] : []), ...s.blocks.filter((b) => b.refs?.length).map((b) => ({ id: b.id, refs: b.refs! }))])
}
/**
 * Every reference the workspace already knows, by identity (plan §2): links by `refId` + target, cards by block id +
 * target, from every page's current blocks and from the metadata that keeps deleted ones. A cut-and-paste move to
 * another line or page finds its time here, whichever page saves first.
 */
export function referenceIndex(ws: Workspace): { links: Map<string, PageRefEntry>; cards: Map<string, number> } {
  const links = new Map<string, PageRefEntry>(), cards = new Map<string, number>()
  for (const p of ws.pages) {
    for (const s of p.sections) for (const r of s.refs ?? []) links.set(`${r.refId}|${r.pageId}`, r)
    for (const b of [...Object.values(p.editorBlockMetadata ?? {}), ...p.sections.flatMap((s) => s.blocks)]) {
      for (const r of b.refs ?? []) links.set(`${r.refId}|${r.pageId}`, r)
      if (b.kind === 'reference' && b.targetPageId && b.at !== undefined) cards.set(`${b.id}|${b.targetPageId}`, b.at)
    }
  }
  return { links, cards }
}

/**
 * A11 (docs/plan/a11-line-links.md §2): where a link to one line goes now. One function for the chip, the jump, the
 * plain URL (server side) and Linked from, so they can't disagree. In v1 a line's id only lives on the page it was
 * made on; a task line follows its task.
 */
export type LineState = 'live' | 'moved' | 'trashed' | 'line-not-found' | 'page-not-found'
export interface LineTarget { pageId: string; lineId: string; taskId?: string }
export interface ResolvedLine { state: LineState; pageId: string; blockId?: string; words: string; taskId?: string }

interface Row { page: Page; blockId: string; text: string; order: number }
const allBlocks = (page: Page) => page.sections.flatMap((s) => s.blocks)

/** Every row of a task on every page, with its position in its page (document order). */
function taskRows(ws: Workspace, taskId: string): Row[] {
  return ws.pages.flatMap((page) => allBlocks(page).flatMap((b, order) => b.kind === 'task' && b.taskId === taskId ? [{ page, blockId: b.id, text: b.text, order }] : []))
}
/**
 * Most recent first (plan §2 rule 2.3): daily pages by date, then document pages by their newest `seen` among this
 * task's rows, then page id; on one page, document order (rule 2.4). One recency key per page keeps the order total,
 * so it never depends on the pages' array order (Ratchet #143).
 */
function byRecency(rows: Row[]): Row[] {
  const seen = new Map<string, number>()
  for (const r of rows) seen.set(r.page.id, Math.max(seen.get(r.page.id) ?? -1, r.page.editorBlockMetadata?.[r.blockId]?.seen ?? -1))
  const daily = (r: Row) => r.page.type === 'daily' && r.page.date ? 0 : 1
  return [...rows].sort((a, b) => {
    if (daily(a) !== daily(b)) return daily(a) - daily(b)
    if (daily(a) === 0 && a.page.date !== b.page.date) return a.page.date! < b.page.date! ? 1 : -1
    if (a.page.id === b.page.id) return a.order - b.order
    if (seen.get(a.page.id) !== seen.get(b.page.id)) return seen.get(b.page.id)! - seen.get(a.page.id)!
    return a.page.id < b.page.id ? -1 : 1
  })
}
/** The day a done or cancelled task counts as finished: `doneOn`, else its latest included day, plan day, last plan day. */
export function finishedOn(ws: Workspace, task: Workspace['tasks'][number]): string | null {
  if (task.status === 'done' && task.doneOn) return task.doneOn
  const included = ws.placements.filter((x) => x.taskId === task.id && x.state === 'included').map((x) => x.date).sort().at(-1)
  return included ?? task.plannedOn ?? task.lastPlannedOn ?? null
}

/** Which task a link means: its own `taskId`, else the line's task on its page, else that page's kept copy of the line. */
function taskOf(ws: Workspace, target: LineTarget): string | undefined {
  if (target.taskId) return target.taskId
  const page = ws.pages.find((p) => p.id === target.pageId)
  const live = page && allBlocks(page).find((b) => b.id === target.lineId)
  return live?.taskId ?? page?.editorBlockMetadata?.[target.lineId]?.taskId
}

export function resolveLine(ws: Workspace, target: LineTarget): ResolvedLine {
  const taskId = taskOf(ws, target), task = taskId ? ws.tasks.find((t) => t.id === taskId) : undefined
  if (task) {
    const rows = byRecency(taskRows(ws, task.id))
    const onDay = (day: string | null) => day ? rows.find((r) => r.page.type === 'daily' && r.page.date === day) : undefined
    // The target first (plan day, then the day it was finished), trash after (Ratchet #141, Bumblebee f9abca12).
    const chosen = (task.status === 'open' && task.plannedOn ? onDay(task.plannedOn) : undefined)
      ?? (task.status !== 'open' ? onDay(finishedOn(ws, task)) : undefined)
      ?? rows.find((r) => !r.page.trashedAt)
      ?? rows[0]
    if (chosen) {
      const state: LineState = chosen.page.trashedAt ? 'trashed' : chosen.page.id === target.pageId ? 'live' : 'moved'
      return { state, pageId: chosen.page.id, blockId: chosen.blockId, words: chosen.text, taskId: task.id }
    }
  }
  const page = ws.pages.find((p) => p.id === target.pageId)
  if (!page) return { state: 'page-not-found', pageId: target.pageId, words: '' }
  const block = allBlocks(page).find((b) => b.id === target.lineId)
  // A custom heading is a line too; the template's role headings are never targets (Ratchet 5).
  const heading = page.sections.find((s) => s.id === target.lineId && s.kind === 'custom')
  const words = block?.text ?? heading?.title
  if (words === undefined) return { state: page.trashedAt ? 'trashed' : 'line-not-found', pageId: page.id, words: '' }
  return { state: page.trashedAt ? 'trashed' : 'live', pageId: page.id, blockId: target.lineId, words }
}

/** The page a reference counts for (Linked from, the `[[` list): a line link's resolved page, else its page (A11 §5). */
export function refTargetPage(ws: Workspace, ref: Pick<PageRefEntry, 'pageId' | 'lineId' | 'taskId'>): string {
  return ref.lineId ? resolveLine(ws, { pageId: ref.pageId, lineId: ref.lineId, ...(ref.taskId ? { taskId: ref.taskId } : {}) }).pageId : ref.pageId
}
