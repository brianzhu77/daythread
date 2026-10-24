import { editorSeed, type EditorNode } from './editor-document.ts'
import type { Page, Workspace } from './types.ts'

/**
 * B28 (Jazz rule 3, cb79b4f0; Lead f3a6f170): where a task sits in the outline, for lists outside the page (Tasks,
 * Review). There's no stored parent; the page documents are the record, as for the morning carry (B34b). A task's
 * parents are the to-do rows above its row, nearest first, read from the page that shows its current plan (its planned
 * day); failing that the newest day page that has it, then a document page.
 */
export interface Ancestry {
  /** The to-dos above the task's row, nearest first. */
  parents: string[]
  /** The date of the day page this was read from ('' for a document page): in a loop, the older page's link drops. */
  from: string
}
export function taskAncestry(ws: Workspace): Map<string, Ancestry> {
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
  const result = new Map<string, Ancestry>()
  for (const task of ws.tasks) {
    const pages = holders.get(task.id)
    if (!pages) continue
    const planned = pages.find(p => p.type === 'daily' && p.date === task.plannedOn)
    const newestDay = pages.filter(p => p.type === 'daily' && p.date).sort((a, b) => (a.date! < b.date! ? 1 : -1))[0]
    const page = planned ?? newestDay ?? pages[0]!
    const ancestors = perPage.get(page.id)!.get(task.id)!
    if (ancestors.length) result.set(task.id, { parents: ancestors, from: page.type === 'daily' && page.date ? page.date : '' })
  }
  cache.set(ws, result)
  return result
}
const cache = new WeakMap<Workspace, Map<string, Ancestry>>()

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
 *
 * Pages can nest two tasks opposite ways (A under B on one day, B under A on another; Ratchet c521a235). In such a
 * loop the link read from the older page is dropped, so the newer page's nesting shows (Lead). Every item appears
 * exactly once whatever the input; anything still unresolved stays top level in its own place.
 */
export function asTaskTree<T>(items: readonly T[], idOf: (item: T) => string, ancestry: ReadonlyMap<string, Ancestry>): TreeRow<T>[] {
  const listed = new Set(items.map(idOf))
  const parentOf = new Map(items.map(item => [idOf(item), (ancestry.get(idOf(item))?.parents ?? []).find(a => listed.has(a)) ?? null]))
  // Break loops: follow each row's parent chain; on coming back to a row already on this chain, drop the link from
  // the oldest page in the loop (ties: the row later in the list), and look again.
  for (let changed = true; changed;) {
    changed = false
    for (const item of items) {
      const chain: string[] = []
      for (let id: string | null = idOf(item); id !== null && !chain.includes(id); id = parentOf.get(id) ?? null) chain.push(id)
      const last = chain.at(-1)!, back = parentOf.get(last) ?? null
      if (back === null || !chain.includes(back)) continue
      const loop = chain.slice(chain.indexOf(back))
      const order = (id: string) => items.findIndex(x => idOf(x) === id)
      const from = (id: string) => ancestry.get(id)?.from ?? ''
      const drop = loop.reduce((a, b) => (from(b) < from(a) || (from(b) === from(a) && order(b) > order(a)) ? b : a))
      parentOf.set(drop, null)
      changed = true
    }
  }
  const rows: TreeRow<T>[] = [], placed = new Set<string>()
  const place = (item: T, depth: number, outsideParent: string | null) => {
    const id = idOf(item)
    if (placed.has(id)) return
    placed.add(id)
    rows.push({ item, depth, outsideParent })
    for (const child of items) if (parentOf.get(idOf(child)) === id) place(child, depth + 1, null)
  }
  for (const item of items) {
    const id = idOf(item)
    if (parentOf.get(id) !== null) continue
    const parents = ancestry.get(id)?.parents ?? []
    // A row whose loop link was dropped has its parent in this list: no "↳", it's a top-level row here.
    place(item, 0, parents.length && !listed.has(parents[0]!) ? parents[0]! : null)
  }
  // Defensive: nothing reaches here once loops are broken, but no input may ever drop a row.
  for (const item of items) place(item, 0, null)
  return rows
}
