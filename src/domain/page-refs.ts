// `[[` links and line links, read from the documents: identity (refId), target, time (`at`), and where a link to one
// line goes now.
import { flatNodes, inlineText, pageNodes, rowTaskId, textDate, type EditorNode } from './editor-document.ts'
import { mentionText, readMention } from './date-chip.ts'
import type { Page, Task, Workspace } from './types.ts'
import { plannedOn } from './workspace.ts'

export interface InlineRef { refId: string; pageId: string; at?: number; newTitle?: string; lineId?: string; taskId?: string }
type Inline = { type?: string; text?: string; content?: unknown; props?: Record<string, unknown> }

/** The `pageRef` nodes of one line's inline content, in order. */
export function inlineRefs(content: unknown): InlineRef[] {
  if (!Array.isArray(content)) return []
  return (content as Inline[]).flatMap((c) => {
    if (c?.type === 'pageRef') {
      const p = c.props ?? {}
      return [{ refId: String(p.refId ?? ''), pageId: String(p.pageId ?? ''), ...(typeof p.at === 'number' ? { at: p.at } : {}), ...(p.newTitle ? { newTitle: String(p.newTitle) } : {}),
        ...(p.lineId ? { lineId: String(p.lineId) } : {}), ...(p.taskId ? { taskId: String(p.taskId) } : {}) }]
    }
    return c && typeof c === 'object' && 'content' in c ? inlineRefs(c.content) : []
  })
}

/** A line's words with each link read as a title (`titleOf(ref)`). */
export function lineText(content: unknown, titleOf: (ref: InlineRef) => string, pageDate?: string | null): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Inline[]).map((c) => {
    if (!c || typeof c !== 'object') return ''
    if (c.type === 'pageRef') return titleOf({ refId: String(c.props?.refId ?? ''), pageId: String(c.props?.pageId ?? '') })
    const mention = readMention(c)
    if (mention) return mentionText(mention, pageDate)
    return 'text' in c ? String(c.text) : 'content' in c ? lineText(c.content, titleOf, pageDate) : ''
  }).join('')
}

/** Every line of a page holding `[[` links (headings included), with its links. */
export function refHolders(page: Page): { id: string; refs: InlineRef[] }[] {
  return flatNodes(pageNodes(page)).flatMap((n) => { const refs = inlineRefs(n.content); return refs.length ? [{ id: n.id, refs }] : [] })
}

/** The title a link shows now: the target's, or the title it was made with while the page is still being created. */
export function liveTitle(ws: Workspace, ref: InlineRef): string {
  return ws.pages.find((p) => p.id === ref.pageId)?.title ?? ref.newTitle ?? ''
}

export type LineState = 'live' | 'moved' | 'trashed' | 'line-not-found' | 'page-not-found'
export interface LineTarget { pageId: string; lineId: string; taskId?: string }
export interface ResolvedLine { state: LineState; pageId: string; blockId?: string; words: string; taskId?: string }

interface Row { page: Page; node: EditorNode; order: number }
function rowsOf(ws: Workspace, taskId: string): Row[] {
  const rows: Row[] = []
  for (const page of ws.pages) flatNodes(pageNodes(page)).forEach((node, order) => { if (rowTaskId(node) === taskId) rows.push({ page, node, order }) })
  // Day pages newest first, then document pages in stored order; on one page, document order.
  const daily = (r: Row) => (r.page.type === 'daily' && r.page.date ? 0 : 1)
  return rows.sort((a, b) => daily(a) - daily(b) || (daily(a) === 0 && a.page.date !== b.page.date ? (a.page.date! < b.page.date! ? 1 : -1) : 0) || (a.page.id === b.page.id ? a.order - b.order : 0))
}
/** The day a done task counts as finished: `doneOn`, else its planned day. */
export function finishedOn(ws: Workspace, task: Task): string | null {
  return (task.status === 'done' && task.doneOn) || plannedOn(ws, task.id)
}
function taskOf(ws: Workspace, target: LineTarget): string | undefined {
  if (target.taskId) return target.taskId
  const page = ws.pages.find((p) => p.id === target.pageId)
  const node = page && flatNodes(pageNodes(page)).find((n) => n.id === target.lineId)
  return node ? rowTaskId(node) ?? undefined : undefined
}
/** Where a link to one line goes now: a task line follows its task (its planned day first); any other line lives on its page. */
export function resolveLine(ws: Workspace, target: LineTarget): ResolvedLine {
  const taskId = taskOf(ws, target), task = taskId ? ws.tasks.find((t) => t.id === taskId) : undefined
  if (task) {
    const rows = rowsOf(ws, task.id)
    const onDay = (day: string | null) => (day ? rows.find((r) => r.page.type === 'daily' && r.page.date === day && !r.page.trashedAt) : undefined)
    const chosen = (task.status === 'open' ? onDay(plannedOn(ws, task.id)) : onDay(finishedOn(ws, task))) ?? rows.find((r) => !r.page.trashedAt) ?? rows[0]
    if (chosen) {
      const state: LineState = chosen.page.trashedAt ? 'trashed' : chosen.page.id === target.pageId ? 'live' : 'moved'
      return { state, pageId: chosen.page.id, blockId: chosen.node.id, words: task.title, taskId: task.id }
    }
  }
  const page = ws.pages.find((p) => p.id === target.pageId)
  if (!page) return { state: 'page-not-found', pageId: target.pageId, words: '' }
  const node = flatNodes(pageNodes(page)).find((n) => n.id === target.lineId)
  if (!node) return { state: page.trashedAt ? 'trashed' : 'line-not-found', pageId: page.id, words: '' }
  const words = lineText(node.content, (ref) => liveTitle(ws, ref), textDate(page))
  return { state: page.trashedAt ? 'trashed' : 'live', pageId: page.id, blockId: node.id, words }
}

/** The page a reference counts for (Linked from, the `[[` list): a line link's resolved page, else its page. */
export function refTargetPage(ws: Workspace, ref: Pick<InlineRef, 'pageId' | 'lineId' | 'taskId'>): string {
  return ref.lineId ? resolveLine(ws, { pageId: ref.pageId, lineId: ref.lineId, ...(ref.taskId ? { taskId: ref.taskId } : {}) }).pageId : ref.pageId
}
export { inlineText }
