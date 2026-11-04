// Moving a row to another database (docs/design/move-row.md). Not `move-page`: a row's values are keyed by its database's property ids,
// so they have to be read across, by name and type. The page keeps its id, so links, line links and its body need nothing.
import { changeDatabase, isReadOnly, rowNumberKey, syncMirror, type Database, type Json, type Option, type Property } from './database.ts'
import { descendantsOf, parentIdOf } from './sub-items.ts'
import type { Page, Workspace } from './types.ts'

type DatabasePage = Page & { database: Database }
const fold = (s: string) => s.trim().toLocaleLowerCase()
const optionLimit = 200
const hasOptions = (p: Property) => p.type === 'select' || p.type === 'multiSelect' || p.type === 'status'
const linksOf = (row: Page, p: Property): string[] => { const raw = row.values?.[p.id]; return Array.isArray(raw) ? (raw as string[]) : [] }

export interface RowMove {
  /** What isn't coming, by name: nothing with its name and type there. */
  leftBehind: string[]
  /** Rows elsewhere that lose their link to it, by database. */
  linksLost: Array<{ database: string; rows: number }>
  /** Options the target gains so that nothing's lost for want of a word. */
  optionsAdded: Array<{ property: string; name: string }>
  /** Sub-items going with it, out of Trash or not counted. */
  subItems: number
}
/** Options a tree's earlier rows are already adding: the rows ask for room together, though they're worked out one at a time. */
type Adding = Map<string, Set<string>>
interface Worked extends Omit<RowMove, 'subItems'> {
  carried: Array<{ from: Property; to: Property; add?: Array<{ name: string; group?: Option['group'] }> }>
  relations: Property[]
  incoming: Array<{ page: Page; property: Property }>
}

/** The row and everything under it, in Trash too: one restored later comes back under its parent, in the same database. */
export function rowMoveTree(ws: Workspace, row: Page, from: DatabasePage): Page[] {
  const links = from.database.subItems
  return links ? [row, ...descendantsOf(ws.pages.filter(p => p.parentId === from.id), links, row.id)] : [row]
}
/** Whether the target sits inside something that's moving: a database in a row's own body would end up inside itself (Ratchet 9bdee5a4). */
export function movesIntoItself(ws: Workspace, row: Page, from: DatabasePage, to: Page): boolean {
  const moving = new Set(rowMoveTree(ws, row, from).map(r => r.id)), byId = new Map(ws.pages.map(p => [p.id, p])), seen = new Set<string>()
  for (let at: Page | undefined = to; at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
    if (moving.has(at.id)) return true
    seen.add(at.id)
  }
  return false
}
function work(ws: Workspace, row: Page, from: DatabasePage, to: DatabasePage, tree: ReadonlySet<string>, top: boolean, adding: Adding): Worked {
  const out: Worked = { leftBehind: [], linksLost: [], optionsAdded: [], carried: [], relations: [], incoming: [] }
  const links = from.database.subItems
  for (const p of from.database.properties) {
    if (p.type === 'relation') out.relations.push(p)
    const raw = row.values?.[p.id]
    if (raw === undefined || isReadOnly(p) || p.type === 'rollup' || p.type === 'formula') continue
    // The tree's own links are made again in the target. Only the top row's parent stays behind, and that one's named.
    if (links && (p.id === links.sub || (p.id === links.parent && !top))) continue
    const match = to.database.properties.find(x => fold(x.name) === fold(p.name) && x.type === p.type && !isReadOnly(x))
    if (!match || (p.type === 'relation' && match.target !== p.target)) { out.leftBehind.push(p.name); continue }
    if (!hasOptions(p)) { out.carried.push({ from: p, to: match }); continue }
    const names = (Array.isArray(raw) ? raw as string[] : [raw as string]).flatMap(id => p.options?.find(o => o.id === id) ?? [])
    const added = adding.get(match.id) ?? new Set<string>()
    const add = names.filter(o => !match.options?.some(x => fold(x.name) === fold(o.name)) && !added.has(fold(o.name)))
    if (add.length > optionLimit - (match.options?.length ?? 0) - added.size) { out.leftBehind.push(p.name); continue }
    adding.set(match.id, new Set([...added, ...add.map(o => fold(o.name))]))
    out.carried.push({ from: p, to: match, add: add.map(o => ({ name: o.name, ...(o.group ? { group: o.group } : {}) })) })
    out.optionsAdded.push(...add.map(o => ({ property: match.name, name: o.name })))
  }
  // Anything pointing at it through a relation into the old database: a relation's target is fixed, so it can't hold a row of the new one.
  const carriedMirrors = new Set(out.carried.flatMap(c => (c.from.type === 'relation' && c.from.mirror ? [c.from.mirror] : [])))
  for (const db of ws.pages) {
    if (!db.database || db.trashedAt) continue
    for (const p of db.database.properties) {
      if (p.type !== 'relation' || p.target !== from.id) continue
      const holding = ws.pages.filter(r => r.parentId === db.id && r.id !== row.id && linksOf(r, p).includes(row.id))
      if (!holding.length) continue
      out.incoming.push(...holding.map(page => ({ page, property: p })))
      const losing = holding.filter(r => !tree.has(r.id)).length
      if (carriedMirrors.has(p.id) || !losing) continue
      const known = out.linksLost.find(l => l.database === (db.title || 'Untitled'))
      if (known) known.rows += losing; else out.linksLost.push({ database: db.title || 'Untitled', rows: losing })
    }
  }
  return out
}

/** What a move would do, for the question before it. */
export function planRowMove(ws: Workspace, row: Page, from: DatabasePage, to: DatabasePage): RowMove {
  const tree = rowMoveTree(ws, row, from), ids = new Set(tree.map(r => r.id)), adding: Adding = new Map()
  const plan: RowMove = { leftBehind: [], linksLost: [], optionsAdded: [], subItems: tree.filter(r => r !== row && !r.trashedAt).length }
  for (const r of tree) {
    const { leftBehind, linksLost, optionsAdded } = work(ws, r, from, to, ids, r === row, adding)
    plan.leftBehind.push(...leftBehind.filter(name => !plan.leftBehind.includes(name)))
    plan.optionsAdded.push(...optionsAdded)
    for (const lost of linksLost) {
      const known = plan.linksLost.find(l => l.database === lost.database)
      if (known) known.rows += lost.rows; else plan.linksLost.push(lost)
    }
  }
  return plan
}

/** The move itself, on the working copy of one operation. */
export function applyRowMove(ws: Workspace, row: Page, from: DatabasePage, to: DatabasePage, at: string, newId: () => string): void {
  const tree = rowMoveTree(ws, row, from), ids = new Set(tree.map(r => r.id)), links = from.database.subItems
  const parents = links ? tree.slice(1).map(r => ({ child: r, parent: parentIdOf(r, links)! })) : []
  for (const r of tree) moveOne(ws, r, from, to, at, newId, ids, r === row)
  if (!parents.length) return
  if (!to.database.subItems) changeDatabase(ws, to, { kind: 'setSubItems', on: { parent: newId(), sub: newId() } })
  const there = to.database.subItems!, relation = to.database.properties.find(p => p.id === there.parent)!
  for (const { child, parent } of parents) {
    child.values = { ...child.values, [there.parent]: [parent] }
    syncMirror(ws, relation, child.id, [], [parent], at)
  }
}
function moveOne(ws: Workspace, row: Page, from: DatabasePage, to: DatabasePage, at: string, newId: () => string, tree: ReadonlySet<string>, top: boolean): void {
  const { carried, relations, incoming } = work(ws, row, from, to, tree, top, new Map())
  // Its links as they stand, before anything's let go.
  const links = new Map(relations.map(p => [p.id, linksOf(row, p)]))
  for (const p of relations) syncMirror(ws, p, row.id, links.get(p.id)!, [], at)
  for (const { page, property } of incoming) {
    const left = linksOf(page, property).filter(id => id !== row.id)
    const values = { ...page.values }
    if (left.length) values[property.id] = left; else delete values[property.id]
    if (Object.keys(values).length) page.values = values; else delete page.values
  }
  const values: Record<string, Json> = {}
  for (const { from: p, to: q, add } of carried) {
    const raw = row.values![p.id]!
    if (!hasOptions(p)) { values[q.id] = raw; continue }
    for (const option of add ?? []) {
      const groups = new Set(q.options?.map(o => o.group))
      q.options = [...(q.options ?? []), { id: newId(), name: option.name, ...(q.type === 'status' ? { group: option.group && groups.has(option.group) ? option.group : 'todo' as const } : {}) }]
    }
    const across = (id: string) => { const name = p.options?.find(o => o.id === id)?.name; return name === undefined ? null : q.options?.find(o => fold(o.name) === fold(name))?.id ?? null }
    if (Array.isArray(raw)) values[q.id] = (raw as string[]).map(across).filter((id): id is string => id !== null)
    else { const id = across(raw as string); if (id) values[q.id] = id }
  }
  // It takes the target's next number, and its old one isn't reused.
  if (to.database.nextRowNumber !== undefined) values[rowNumberKey] = to.database.nextRowNumber++
  if (Object.keys(values).length) row.values = values; else delete row.values
  row.parentId = to.id
  row.editedAt = at
  ws.pages.splice(ws.pages.indexOf(row), 1)
  ws.pages.push(row)
  for (const { to: q } of carried) if (q.type === 'relation') syncMirror(ws, q, row.id, [], linksOf(row, q), at)
}
