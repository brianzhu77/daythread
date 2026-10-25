// B27 (docs/plan/b27-at-date-plan.md, revision 2): the events `@date` chips make, read from the documents.
import { editorSeed, type EditorNode } from './editor-document.ts'
import { readMention, type DateMention } from './date-chip.ts'
import { liveTitle, type InlineRef } from './page-refs.ts'
import { isTrashed } from './page-tree.ts'
import type { DayEvent, Event, EventLine, LocalDate, Workspace } from './types.ts'

export type { DayEvent, EventLine }

/** An event's title: the line's words with its chips left out, `[[` links as their titles, spaces collapsed. */
function titleOf(content: unknown, ws: Workspace): string {
  const words = (list: unknown): string => !Array.isArray(list) ? (typeof list === 'string' ? list : '') : list.map((c) => {
    if (!c || typeof c !== 'object') return ''
    const item = c as { type?: string; text?: unknown; content?: unknown; props?: Record<string, unknown> }
    if (item.type === 'dateMention') return ' '
    if (item.type === 'pageRef') return liveTitle(ws, { refId: String(item.props?.refId ?? ''), pageId: String(item.props?.pageId ?? '') } as InlineRef)
    return 'text' in item ? String(item.text) : 'content' in item ? words(item.content) : ''
  }).join('')
  return words(content).replace(/\s+/g, ' ').trim()
}

interface Holder { mention: DateMention; title: string; line: EventLine; pageDate: LocalDate | null; order: number }
/**
 * Every chip event in the workspace, one per `eventId`, from the pages that aren't in the trash. The same id in two
 * lines (Bring keeps the chip; a conflict merge or a restore can repeat a node) is one event, taken whole from one
 * holder: the one on the newest day page, else the first document page in workspace order (the task tree's rule, B28).
 *
 * Memoised per workspace object and revision. Read-side only: a command running mid-way must not call it, since the
 * workspace it's changing still carries the old revision.
 */
export function chipEvents(ws: Workspace): Map<string, DayEvent> {
  const cached = cache.get(ws)
  if (cached && cached.revision === ws.revision) return cached.events
  const best = new Map<string, Holder>()
  let order = 0
  for (const page of ws.pages) {
    if (isTrashed(page)) continue
    let nodes: EditorNode[]
    try { nodes = editorSeed(page, ws) } catch { continue }
    const pageDate = page.type === 'daily' && page.date ? page.date : null
    const walk = (list: EditorNode[]) => list.forEach((n) => {
      if (Array.isArray(n.content)) for (const item of n.content) {
        const mention = readMention(item)
        if (!mention) continue
        const holder = { mention, title: titleOf(n.content, ws), line: { pageId: page.id, lineId: n.id }, pageDate, order: order++ }
        const seen = best.get(mention.eventId)
        if (!seen || newer(holder, seen)) best.set(mention.eventId, holder)
      }
      walk(n.children ?? [])
    })
    walk(nodes)
  }
  const events = new Map([...best].map(([id, h]) => [id, { id, title: h.title, date: h.mention.date, time: h.mention.time, line: h.line }]))
  cache.set(ws, { revision: ws.revision, events })
  return events
}
const newer = (a: Holder, b: Holder) => a.pageDate !== b.pageDate
  ? (a.pageDate ?? '') > (b.pageDate ?? '')
  : a.order < b.order
const cache = new WeakMap<Workspace, { revision: number; events: Map<string, DayEvent> }>()

/**
 * A day's events, for every reader (the day page's Events rows, a future day with no page, the morning draft): the
 * stored ones that aren't cancelled, then the chip events. All-day first, then by time (Jazz §3).
 */
export function dayEvents(ws: Workspace, day: LocalDate): DayEvent[] {
  const stored: DayEvent[] = ws.events.filter((e: Event) => !e.cancelled && e.date === day).map((e) => ({ id: e.id, title: e.title, date: e.date, time: e.time }))
  const chips = [...chipEvents(ws).values()].filter((e) => e.date === day)
  return [...stored, ...chips].map((e, i) => ({ e, i })).sort((a, b) => (a.e.time ?? '') < (b.e.time ?? '') ? -1 : (a.e.time ?? '') > (b.e.time ?? '') ? 1 : a.i - b.i).map(({ e }) => e)
}
