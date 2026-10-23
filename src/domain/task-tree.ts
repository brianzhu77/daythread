import { editorSeed, type EditorNode } from './editor-document.ts'
import type { Page, Workspace } from './types.ts'

/**
 * B28 (Jazz rule 3, cb79b4f0; Lead f3a6f170): where a task sits in the outline, for lists outside the page (Tasks,
 * Review). There's no stored parent; the page documents are the record, as for the morning carry (B34b). A task's
 * parents are the to-do rows above its row, nearest first, read from the page that shows its current plan (its planned
 * day); failing that the newest day page that has it, then a document page.
 */
export function taskAncestry(ws: Workspace): Map<string, string[]> {
  const cached = cache.get(ws)
  if (cached) return cached
  const perPage = new Map<string, Map<string, string[]>>()
  const holders = new Map<string, Page[]>()
  for (const page of ws.pages) {
    if (page.trashedAt) continue
    let nodes: EditorNode[]
    try { nodes = editorSeed(page, ws) } catch { continue }
    const found = new Map<string, string[]>()
    const walk = (list: EditorNode[], above: string[]) => list.forEach(n => {
      const own = n.type === 'task' && typeof n.props?.taskId === 'string' ? n.props.taskId : null
      if (own && !found.has(own)) found.set(own, above.filter(a => a !== own))
      walk(n.children ?? [], own ? [own, ...above] : above)
    })
    walk(nodes, [])
    perPage.set(page.id, found)
    for (const id of found.keys()) holders.set(id, [...(holders.get(id) ?? []), page])
  }
  const result = new Map<string, string[]>()
  for (const task of ws.tasks) {
    const pages = holders.get(task.id)
    if (!pages) continue
    const planned = pages.find(p => p.type === 'daily' && p.date === task.plannedOn)
    const newestDay = pages.filter(p => p.type === 'daily' && p.date).sort((a, b) => (a.date! < b.date! ? 1 : -1))[0]
    const page = planned ?? newestDay ?? pages[0]!
    const ancestors = perPage.get(page.id)!.get(task.id)!
    if (ancestors.length) result.set(task.id, ancestors)
  }
  cache.set(ws, result)
  return result
}
const cache = new WeakMap<Workspace, Map<string, string[]>>()

export interface TreeRow<T> {
  item: T
  /** Levels under a parent that is in the same list (0 for a top-level row). */
  depth: number
  /** The nearest parent's id when that parent isn't in this list: shown as "↳ parent" above the title. */
  outsideParent: string | null
}

/**
 * A list in outline order: a row whose parent (nearest listed ancestor) is in the list comes right after it, indented;
 * every other row keeps its place. A row whose parents are all elsewhere names its nearest one.
 */
export function asTaskTree<T>(items: readonly T[], idOf: (item: T) => string, ancestry: ReadonlyMap<string, string[]>): TreeRow<T>[] {
  const listed = new Set(items.map(idOf))
  const parentOf = new Map(items.map(item => [idOf(item), (ancestry.get(idOf(item)) ?? []).find(a => listed.has(a)) ?? null]))
  const rows: TreeRow<T>[] = []
  const emit = (parent: string | null, depth: number) => {
    for (const item of items) {
      const id = idOf(item)
      if (parentOf.get(id) !== parent) continue
      const ancestors = ancestry.get(id) ?? []
      rows.push({ item, depth, outsideParent: parent === null && ancestors.length ? ancestors[0]! : null })
      emit(id, depth + 1)
    }
  }
  emit(null, 0)
  return rows
}
