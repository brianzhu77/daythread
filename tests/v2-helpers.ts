// Shared helpers for the shot-1 (v2 model) tests. The model: Page (with its editor document) and Task are stored;
// planned-on, order, carry-over, events, tags and links are read from the documents.
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, inlineText, pageContentKey, pageNodes, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Page, Workspace } from '../src/domain/types.ts'

export const today = '2026-10-22', yesterday = '2026-10-21', tomorrow = '2026-10-23', twoDaysAgo = '2026-10-20'
export const dayId = (date: string) => `day:${date}`

export function harness(start: Workspace = createEmptyWorkspace()) {
  let ws = start, n = 0
  const run = (action: Action, operationId = `op-${++n}`) => {
    const result = applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
    ws = result.workspace
    return result
  }
  const page = (id: string): Page => { const p = ws.pages.find(x => x.id === id); if (!p) throw new Error(`no page ${id}`); return p }
  const day = (date: string): Page => { run({ type: 'ensure-day', date }); return page(dayId(date)) }
  /** Saves `edit(doc)` as the page's document, the way the editor does: from the seeded document, with the content key. */
  const save = (pageId: string, edit: (doc: EditorNode[]) => EditorNode[], extra: Partial<Extract<Action, { type: 'save-editor' }>> = {}) => {
    const p = page(pageId)
    const doc = edit(structuredClone(editorSeed(p, ws)))
    return run({ type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(doc), today, ...extra })
  }
  const task = (title: string) => { const t = ws.tasks.find(x => x.title === title); if (!t) throw new Error(`no task ${title}`); return t }
  return { run, page, day, save, task, get ws() { return ws }, set ws(next: Workspace) { ws = next } }
}

export const text = (t: string) => ({ type: 'text', text: t, styles: {} })
/** A to-do row as the editor makes it: a fresh identity until the save creates the task. */
export const todo = (id: string, title: string, role: 'plan' | 'reference' = 'plan', planDate = today, children: EditorNode[] = []): EditorNode =>
  ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role, planDate }, content: [text(title)], children })
export const bullet = (id: string, ...content: unknown[]): EditorNode => ({ id, type: 'bulletListItem', props: {}, content, children: [] })
export const para = (id: string, ...content: unknown[]): EditorNode => ({ id, type: 'paragraph', props: {}, content, children: [] })
export const heading = (id: string, title: string): EditorNode => ({ id, type: 'heading', props: { level: 2 }, content: [text(title)], children: [] })
export const chip = (eventId: string, date: string, time: string | null = null) => ({ type: 'dateMention', props: { eventId, date, time: time ?? '' } })
export const pageRef = (pageId: string, refId: string, extra: Record<string, string> = {}) => ({ type: 'pageRef', props: { pageId, refId, ...extra } })
export const card = (id: string, pageId: string): EditorNode => ({ id, type: 'pageLink', props: { pageId }, content: undefined, children: [] })

export const flat = (nodes: readonly EditorNode[]): EditorNode[] => nodes.flatMap(n => [n, ...flat(n.children ?? [])])
export const nodesOf = (p: Page) => pageNodes(p)
export const headingIndex = (doc: EditorNode[], title: string) => doc.findIndex(n => n.type === 'heading' && inlineText(n.content).trim() === title)
/** Inserts `rows` right after the heading `title` (the first line of its section). */
export const under = (doc: EditorNode[], title: string, ...rows: EditorNode[]): EditorNode[] => {
  const at = headingIndex(doc, title)
  if (at < 0) throw new Error(`no heading ${title}`)
  const out = [...doc]; out.splice(at + 1, 0, ...rows); return out
}
export const taskRowsOn = (p: Page) => flat(nodesOf(p)).filter(n => n.type === 'task').map(n => ({ id: n.id, taskId: String(n.props?.taskId), role: String(n.props?.role), text: inlineText(n.content) }))
