import type { LocalDate, Page, Task, Workspace } from './types.ts'
import { mentionText, readMention } from './date-chip.ts'

export interface EditorNode {
  id: string
  type: string
  props?: Record<string, string | number | boolean>
  content?: unknown
  children?: EditorNode[]
}

/** The built-in day template (fixed for now, flexible later): plain headings, one empty row each, nothing stored about them. */
export const dayTemplate: readonly { title: string; row: 'task' | 'bullet' }[] = [
  { title: 'TODO', row: 'task' },
  { title: 'Events', row: 'bullet' },
  { title: 'Good Stuffs', row: 'bullet' },
  { title: 'Notes', row: 'bullet' },
]

const newId = (): string => crypto.randomUUID()
export const textRun = (text: string) => ({ type: 'text', text, styles: {} })

/** A to-do row as the editor makes it: a fresh identity until the save creates the task. */
export function emptyTaskRow(date: LocalDate | null, id = newId()): EditorNode {
  return { id, type: 'task', props: { taskId: `editor-task:${id}`, role: date ? 'plan' : 'reference', planDate: date ?? '' }, content: [], children: [] }
}
export function emptyLine(type: 'paragraph' | 'bulletListItem' = 'paragraph', id = newId()): EditorNode {
  return { id, type, props: {}, content: [], children: [] }
}
export function headingNode(title: string, id = newId()): EditorNode {
  return { id, type: 'heading', props: { level: 2 }, content: [textRun(title)], children: [] }
}
/** A new day page's document: each template heading with its one empty row. */
export function templateDocument(pageId: string, date: LocalDate): EditorNode[] {
  return dayTemplate.flatMap((t, i) => [headingNode(t.title, `${pageId}:h${i}`), t.row === 'task' ? emptyTaskRow(date, `${pageId}:r${i}`) : emptyLine('bulletListItem', `${pageId}:r${i}`)])
}

/**
 * A line's words. A `@date` chip reads as its stored text form, with the year left out when it's `pageDate`'s year;
 * with no `pageDate` (a document page, or a reader with no page at hand) the year is always there. A `[[` link reads
 * as nothing: its title is live, never part of the line's words.
 */
export function inlineText(content: unknown, pageDate?: string | null): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(c => {
    if (typeof c !== 'object' || c === null) return ''
    const mention = readMention(c)
    if (mention) return mentionText(mention, pageDate)
    return 'text' in c ? String(c.text) : 'content' in c ? inlineText(c.content, pageDate) : ''
  }).join('')
}
/** The date a day page's chips are read against for their stored text: its own date; none for a document page. */
export const textDate = (page: Pick<Page, 'type' | 'date'>): string | null => page.type === 'daily' ? page.date ?? null : null

export const flatNodes = (list: readonly EditorNode[]): EditorNode[] => list.flatMap(n => [n, ...flatNodes(n.children ?? [])])
export const isTaskRow = (n: EditorNode): boolean => n.type === 'task' && typeof n.props?.taskId === 'string'
export const rowTaskId = (n: EditorNode): string | null => (isTaskRow(n) ? String(n.props!.taskId) : null)
export const rowRole = (n: EditorNode): 'plan' | 'reference' => (n.props?.role === 'plan' ? 'plan' : 'reference')
/** No words and nothing else inline (a chip, a link): the empty rows a template or a trailing line leaves. */
export const isEmptyLine = (n: EditorNode): boolean => n.type !== 'pageLink' && n.type !== 'heading' && !inlineText(n.content).trim() && !(Array.isArray(n.content) && n.content.some(c => c && typeof c === 'object' && (c as { type?: string }).type !== 'text')) && !(n.children?.length)

// The parsed document of a page, kept per document string: readers parse each page once per save.
const parsed = new Map<string, EditorNode[]>()
const parsedLimit = 2000
/** The page's document as nodes. A page that fails to parse reads as empty, never as an error, so one bad page can't hide the rest. */
export function pageNodes(page: Pick<Page, 'document'>): EditorNode[] {
  const cached = parsed.get(page.document)
  if (cached) return cached
  let nodes: EditorNode[]
  try { const value = JSON.parse(page.document); nodes = Array.isArray(value) ? value : [] } catch { nodes = [] }
  if (parsed.size >= parsedLimit) parsed.delete(parsed.keys().next().value!)
  parsed.set(page.document, nodes)
  return nodes
}

/** A stale-save check: the saved document's fingerprint, short enough to travel with every save. */
export function pageContentKey(page: Pick<Page, 'document'>): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  const s = page.document
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233); h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233); h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1
  return `d:${s.length}:${[h1, h2, h3, h4].map(h => (h >>> 0).toString(16).padStart(8, '0')).join('')}`
}

/**
 * What the editor opens: the stored document, with each task row's words read from its task (a title edited on
 * another page shows here) and each card untouched (its title is read live by the card itself).
 */
export function editorSeed(page: Page, workspace: Workspace): EditorNode[] {
  const tasks = new Map(workspace.tasks.map(t => [t.id, t]))
  const visit = (n: EditorNode): EditorNode => {
    const children = n.children?.map(visit)
    const id = rowTaskId(n)
    const task = id ? tasks.get(id) : undefined
    const node = task && inlineText(n.content, textDate(page)) !== task.title ? { ...n, content: [textRun(task.title)] } : n
    return children ? { ...node, children } : node
  }
  return pageNodes(page).map(visit)
}

/** The nodes of a heading's section: the heading and everything below it up to the next heading of its level or higher. */
export function sectionRange(nodes: readonly EditorNode[], id: string): EditorNode[] {
  const start = nodes.findIndex(n => n.id === id)
  if (start < 0) return []
  const first = nodes[start]!
  if (first.type !== 'heading') return [first]
  let end = start + 1
  while (end < nodes.length && !(nodes[end]!.type === 'heading' && Number(nodes[end]!.props?.level ?? 1) <= Number(first.props?.level ?? 1))) end++
  return nodes.slice(start, end)
}

/**
 * Where a new row goes on a page: after the last top-level to-do row that holds a task, else at the end of the first
 * section with a to-do row in it (B70: his template may not start with its to-dos), else of the first heading's section,
 * else at the end of the page; in each case above the trailing empty lines, so the empty row ready
 * for typing stays last.
 */
export function rowInsertIndex(doc: readonly EditorNode[], tasks: ReadonlySet<string>): number {
  const lastTask = doc.map((n, i) => (isTaskRow(n) && tasks.has(String(n.props!.taskId)) ? i : -1)).filter(i => i >= 0).at(-1)
  if (lastTask !== undefined) return lastTask + 1
  const headings = doc.flatMap((n, i) => (n.type === 'heading' ? [i] : []))
  const heading = headings.find(i => flatNodes(sectionRange(doc, doc[i]!.id).slice(1)).some(n => n.type === 'task')) ?? headings[0] ?? -1
  let end: number
  if (heading >= 0) { const range = sectionRange(doc, doc[heading]!.id); end = heading + range.length } else end = doc.length
  const floor = heading >= 0 ? heading + 1 : 0
  while (end > floor && isEmptyLine(doc[end - 1]!)) end--
  return end
}
/**
 * Where a new plan row goes on a DAY page (carried, planned or added). B74 (Bumblebee 8bb0f23d, Lead 3d87f348): as
 * their own group right under the heading above the page's first to-do row (with no to-do row, the first heading),
 * above that section's first line, after the rows already in the group; with no such heading, at the top of the page.
 * The rule never reads his words, so a label he wrote ("Intentional Drop") never gives a carried to-do a meaning, and
 * his empty to-dos stay empty. On the built-in day that is under TODO, above its empty row, as before. Other pages keep
 * `rowInsertIndex`: on a link page that is below the quote.
 */
export function dayRowInsertIndex(doc: readonly EditorNode[], tasks: ReadonlySet<string>): number {
  const firstRow = doc.findIndex(n => flatNodes([n]).some(isTaskRow))
  let heading = firstRow
  if (firstRow < 0) heading = doc.findIndex(n => n.type === 'heading')
  else while (heading >= 0 && doc[heading]!.type !== 'heading') heading--
  let end = heading + 1
  while (end < doc.length && isTaskRow(doc[end]!) && tasks.has(String(doc[end]!.props!.taskId))) end++
  return end
}
/** Brought lines' block ids start with this, so their group can be found without reading words. */
export const broughtPrefix = 'brought:'
/** Where a brought line goes on a day page with no matching heading: after the carried to-dos and earlier brought lines. */
export function broughtInsertIndex(doc: readonly EditorNode[], tasks: ReadonlySet<string>): number {
  let at = dayRowInsertIndex(doc, tasks)
  while (at < doc.length && doc[at]!.id.startsWith(broughtPrefix)) at++
  return at
}
/** The same for a line brought under a heading: before that section's trailing empty lines. */
export function sectionInsertIndex(doc: readonly EditorNode[], headingId: string): number {
  const heading = doc.findIndex(n => n.id === headingId)
  if (heading < 0) return doc.length
  let end = heading + sectionRange(doc, headingId).length
  while (end > heading + 1 && isEmptyLine(doc[end - 1]!)) end--
  return end
}

/** The task of a row, by id, when it exists. */
export const taskOfRow = (workspace: Workspace, n: EditorNode): Task | undefined => { const id = rowTaskId(n); return id ? workspace.tasks.find(t => t.id === id) : undefined }
