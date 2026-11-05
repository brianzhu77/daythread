// Sub-items (docs/design/sub-items.md): two ordinary relations on the database itself, kept in step as any two-way relation is, so rollups,
// formulas, filters and export need nothing. This is the behaviour on top: the tree they make.
import type { Database, SubItems } from './database.ts'
import type { Page } from './types.ts'

export const parentIdOf = (row: Page, links: SubItems): string | null => {
  const raw = row.values?.[links.parent]
  return Array.isArray(raw) ? (raw[0] as string | undefined) ?? null : null
}
/** A row's sub-items, sub-items of those, and so on, in `rows`' order. A loop can't be saved, and a stray one wouldn't hang this. */
export function descendantsOf(rows: readonly Page[], links: SubItems, rowId: string): Page[] {
  const under = new Map<string, Page[]>()
  for (const r of rows) { const parent = parentIdOf(r, links); if (parent) { const list = under.get(parent); if (list) list.push(r); else under.set(parent, [r]) } }
  const out: Page[] = [], seen = new Set([rowId])
  const walk = (id: string) => { for (const child of under.get(id) ?? []) if (!seen.has(child.id)) { seen.add(child.id); out.push(child); walk(child.id) } }
  walk(rowId)
  return out
}
/** Whether going up from this row comes back to it. Whatever closed the loop, it goes through the row that was edited. */
export function hasLoop(rows: readonly Page[], links: SubItems, rowId: string): boolean {
  const byId = new Map(rows.map(r => [r.id, r])), seen = new Set<string>()
  let at = byId.get(rowId)
  while (at) {
    const parent = parentIdOf(at, links)
    if (!parent) return false
    if (parent === rowId || seen.has(parent)) return true
    seen.add(parent)
    at = byId.get(parent)
  }
  return false
}

export interface TreeEntry {
  row: Page
  depth: number
  hasChildren: boolean
  open: boolean
  /** Doesn't match the view, and is only here so its sub-item isn't an orphan: dimmed and not counted (design §2). */
  context: boolean
}
/**
 * The rows as a tree. `shown` is what the view's filter and sort left, in that order, so siblings keep it. `everyChild`: Parents only,
 * where the filter is about the parents and a toggle opens onto all their sub-items.
 */
export function treeEntries(db: Database, shown: readonly Page[], all: readonly Page[], isOpen: (rowId: string, context: boolean) => boolean, everyChild = false): TreeEntry[] {
  const links = db.subItems
  if (!links) return shown.map(row => ({ row, depth: 0, hasChildren: false, open: false, context: false }))
  const matched = new Set(shown.map(r => r.id)), byId = new Map(all.map(r => [r.id, r]))
  // Who's in the tree: Parents only opens onto every sub-item; otherwise what matched, and what's above it, so it has somewhere to sit.
  const inTree = new Set(matched)
  if (everyChild) for (const r of all) inTree.add(r.id)
  else for (const row of shown) {
    const seen = new Set([row.id])
    for (let up = parentIdOf(row, links); up && !seen.has(up) && byId.has(up); up = parentIdOf(byId.get(up)!, links)) { seen.add(up); inTree.add(up) }
  }
  const under = new Map<string, Page[]>()
  // What matched first, in the view's order, so siblings keep it; what's only context after.
  for (const row of [...shown, ...all.filter(r => !matched.has(r.id) && inTree.has(r.id))]) {
    const parent = parentIdOf(row, links)
    if (parent && inTree.has(parent)) { const list = under.get(parent); if (list) list.push(row); else under.set(parent, [row]) }
  }
  const roots = [...shown, ...all.filter(r => !matched.has(r.id) && inTree.has(r.id))].filter(r => { const parent = parentIdOf(r, links); return !parent || !inTree.has(parent) })
  const out: TreeEntry[] = [], seen = new Set<string>()
  const walk = (row: Page, depth: number) => {
    if (seen.has(row.id)) return
    seen.add(row.id)
    const context = !everyChild && !matched.has(row.id), children = under.get(row.id) ?? [], open = children.length > 0 && isOpen(row.id, context)
    out.push({ row, depth, hasChildren: children.length > 0, open, context })
    if (open) for (const child of children) walk(child, depth + 1)
  }
  for (const row of roots) walk(row, 0)
  return out
}
