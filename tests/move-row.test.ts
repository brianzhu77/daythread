// Moving a row to another database (docs/design/move-row.md, R4-10): one operation, one Undo, the page id kept.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, rowNumberKey, type Database, type DatabaseChange } from '../src/domain/database.ts'
import { planRowMove } from '../src/domain/move-row.ts'
import { withLinks } from '../src/domain/relations.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
function shelves() {
  const h = harness()
  const make = (pageId: string, title: string) => h.run({ type: 'create-database', pageId, homeBlockId: null, title })
  const add = (pageId: string, property: object) => h.run({ type: 'change-database', pageId, change: { kind: 'addProperty', property } as DatabaseChange })
  make('from', 'From'); make('to', 'To'); make('people', 'People')
  add('from', { id: 'pages', name: 'Pages', type: 'number' })
  add('from', { id: 'rate', name: 'Rating', type: 'number' })
  add('from', { id: 'genre', name: 'Genre', type: 'select', options: [{ id: 'sf', name: 'SF' }, { id: 'hist', name: 'History' }] })
  add('from', { id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] })
  add('from', { id: 'state', name: 'State', type: 'status', options: [{ id: 'o', name: 'Open', group: 'todo' }, { id: 'w', name: 'Waiting', group: 'active' }] })
  add('from', { id: 'by', name: 'By', type: 'relation', target: 'people' })
  h.run({ type: 'change-database', pageId: 'from', change: { kind: 'setMirror', propertyId: 'by', mirror: { id: 'wrote', name: 'Wrote' } } })
  add('from', { id: 'num', name: 'No', type: 'id' })
  add('to', { id: 'pagesTo', name: ' pages ', type: 'number' })
  add('to', { id: 'genreTo', name: 'Genre', type: 'select', options: [{ id: 'novel', name: 'Novel' }, { id: 'sf2', name: 'sf' }] })
  add('to', { id: 'tagsTo', name: 'Tags', type: 'multiSelect' })
  add('to', { id: 'stateTo', name: 'State', type: 'status', options: [{ id: 'n', name: 'New', group: 'todo' }] })
  add('to', { id: 'byTo', name: 'By', type: 'relation', target: 'people' })
  h.run({ type: 'change-database', pageId: 'to', change: { kind: 'setMirror', propertyId: 'byTo', mirror: { id: 'wroteTo', name: 'Wrote there' } } })
  add('to', { id: 'numTo', name: 'No', type: 'id' })
  h.run({ type: 'add-row', databaseId: 'people', pageId: 'ann', title: 'Ann', at })
  h.run({ type: 'add-row', databaseId: 'to', pageId: 'first', title: 'First', at })
  h.run({ type: 'add-row', databaseId: 'from', pageId: 'dune', title: 'Dune', values: { pages: 412, rate: 5, genre: 'sf', tags: ['a', 'b'], state: 'w', by: ['ann'] }, at })
  return h
}
const dbOf = (h: ReturnType<typeof harness>, id: string) => h.ws.pages.find(p => p.id === id) as ReturnType<typeof harness>['ws']['pages'][number] & { database: Database }
const row = (h: ReturnType<typeof harness>) => h.ws.pages.find(p => p.id === 'dune')!
const links = (h: ReturnType<typeof harness>, rowId: string, id: string) => h.ws.pages.find(p => p.id === rowId)!.values?.[id]

test('values with the same name and type come across, options are added, what has no match stays behind, and it says so first', () => {
  const h = shelves()
  const plan = planRowMove(h.ws, row(h), dbOf(h, 'from'), dbOf(h, 'to'))
  assert.deepEqual(plan.leftBehind, ['Rating'])
  assert.deepEqual(plan.linksLost, [])
  assert.deepEqual(plan.optionsAdded.map(o => o.name), ['A', 'B', 'Waiting'])
  const r = h.run({ type: 'move-row', pageId: 'dune', databaseId: 'to', at })
  assert.equal(r.receipt.message, 'Moved to To')
  const moved = row(h), to = dbOf(h, 'to').database
  assert.equal(moved.parentId, 'to')
  assert.equal(moved.id, 'dune')
  assert.equal(h.ws.pages.at(-1)!.id, 'dune')
  const read = (id: string) => cellValue(to, moved, id)
  assert.equal(read('pagesTo'), 412)
  assert.equal(read('genreTo'), 'sf2')
  const name = (propertyId: string, id: unknown) => to.properties.find(p => p.id === propertyId)!.options!.find(o => o.id === id)?.name
  assert.deepEqual((read('tagsTo') as string[]).map(x => name('tagsTo', x)), ['A', 'B'])
  assert.equal(name('stateTo', read('stateTo')), 'Waiting')
  // No "In progress" group there: a status joins To-do.
  assert.equal(to.properties.find(p => p.id === 'stateTo')!.options!.find(o => o.name === 'Waiting')!.group, 'todo')
  assert.equal(moved.values!.rate, undefined)
  assert.equal(moved.values![rowNumberKey], to.nextRowNumber! - 1)
})

test('a relation to the same database comes along and its two-way partner updates; one Undo brings all of it back', () => {
  const h = shelves()
  const before = structuredClone({ dune: row(h).values, ann: h.ws.pages.find(p => p.id === 'ann')!.values, options: dbOf(h, 'to').database.properties.find(p => p.id === 'tagsTo')!.options })
  assert.deepEqual(links(h, 'ann', 'wrote'), ['dune'])
  const r = h.run({ type: 'move-row', pageId: 'dune', databaseId: 'to', at })
  assert.deepEqual(row(h).values!.byTo, ['ann'])
  assert.equal(links(h, 'ann', 'wrote'), undefined)
  assert.deepEqual(links(h, 'ann', 'wroteTo'), ['dune'])
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(row(h).parentId, 'from')
  assert.deepEqual(row(h).values, before.dune)
  assert.deepEqual(h.ws.pages.find(p => p.id === 'ann')!.values, before.ann)
  assert.deepEqual(dbOf(h, 'to').database.properties.find(p => p.id === 'tagsTo')!.options, before.options)
  assert.equal(h.ws.pages.at(-1)!.id, 'dune')
})

test('a relation in another database that targets the old one loses its link, named first and restored by Undo', () => {
  const h = shelves()
  h.run({ type: 'change-database', pageId: 'people', change: { kind: 'addProperty', property: { id: 'fav', name: 'Favourite', type: 'relation', target: 'from' } } })
  h.run({ type: 'set-values', pageId: 'ann', values: { fav: ['dune'] }, expected: {}, at })
  assert.deepEqual(planRowMove(h.ws, row(h), dbOf(h, 'from'), dbOf(h, 'to')).linksLost, [{ database: 'People', rows: 1 }])
  const r = h.run({ type: 'move-row', pageId: 'dune', databaseId: 'to', at })
  assert.equal(links(h, 'ann', 'fav'), undefined)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(links(h, 'ann', 'fav'), ['dune'])
})

test('a relation with no match lets go of its partner too, and rollups keep up', () => {
  const h = shelves()
  h.run({ type: 'change-database', pageId: 'to', change: { kind: 'removeProperty', propertyId: 'byTo' } })
  h.run({ type: 'change-database', pageId: 'people', change: { kind: 'addProperty', property: { id: 'count', name: 'Count', type: 'rollup', rollup: { relation: 'wrote', property: 'title', fn: 'countAll' } } } })
  const count = () => { const read = withLinks(h.ws); return cellValue(read.pages.find(p => p.id === 'people')!.database!, read.pages.find(p => p.id === 'ann')!, 'count') }
  assert.equal(count(), 1)
  assert.deepEqual(planRowMove(h.ws, row(h), dbOf(h, 'from'), dbOf(h, 'to')).leftBehind, ['Rating', 'By'])
  h.run({ type: 'move-row', pageId: 'dune', databaseId: 'to', at })
  assert.equal(links(h, 'ann', 'wrote'), undefined)
  assert.equal(count(), null)
})

test('refused: the same database, one in Trash, To-dos, and what isn\'t a row', () => {
  const h = shelves()
  assert.throws(() => h.run({ type: 'move-row', pageId: 'dune', databaseId: 'from', at }), /Already there/)
  assert.throws(() => h.run({ type: 'move-row', pageId: 'dune', databaseId: 'source:tasks', at }))
  h.run({ type: 'delete-page', pageId: 'people', at })
  assert.throws(() => h.run({ type: 'move-row', pageId: 'dune', databaseId: 'people', at }), /trash/)
  assert.throws(() => h.run({ type: 'move-row', pageId: 'first', databaseId: 'first', at }))
})

test('a tab that missed the move: its cell edit fails with the reason and writes nothing, even where the property id exists on both', () => {
  const h = shelves()
  h.run({ type: 'change-database', pageId: 'to', change: { kind: 'addProperty', property: { id: 'rate', name: 'Score', type: 'number' } } })
  h.run({ type: 'move-row', pageId: 'dune', databaseId: 'to', at })
  const before = structuredClone(row(h).values)
  assert.throws(() => h.run({ type: 'set-values', databaseId: 'from', pageId: 'dune', values: { rate: 1 }, expected: {}, at }), /This row moved to To/)
  assert.throws(() => h.run({ type: 'set-values', databaseId: 'from', pageId: 'dune', values: { title: 'Renamed' }, expected: {}, at }), /This row moved to To/)
  // An older tab, which doesn't say: a property the new database hasn't got is still refused.
  assert.throws(() => h.run({ type: 'set-values', pageId: 'dune', values: { pages: 1 }, expected: {}, at }), /Property not found/)
  assert.deepEqual(row(h).values, before)
  assert.equal(row(h).title, 'Dune')
})

function tree() {
  const h = shelves()
  const change = (pageId: string, c: DatabaseChange) => h.run({ type: 'change-database', pageId, change: c })
  change('from', { kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } })
  for (const id of ['kid', 'kid2', 'grand', 'other']) h.run({ type: 'add-row', databaseId: 'from', pageId: id, title: id, values: id === 'kid2' ? { genre: 'hist', rate: 2 } : {}, at })
  const set = (pageId: string, parent: string) => h.run({ type: 'set-values', pageId, values: { par: [parent] }, expected: {}, at })
  set('kid', 'dune'); set('kid2', 'dune'); set('grand', 'kid')
  const move = () => h.run({ type: 'move-row', pageId: 'dune', databaseId: 'to', at })
  return { h, change, set, move }
}
const parentThere = (h: ReturnType<typeof harness>) => dbOf(h, 'to').database.subItems!
test('a parent takes its whole tree: sub-items turn on there, links are made again in the target, and the old ones are gone', () => {
  const { h, move } = tree()
  move()
  for (const id of ['dune', 'kid', 'kid2', 'grand']) assert.equal(h.ws.pages.find(p => p.id === id)!.parentId, 'to')
  assert.equal(h.ws.pages.find(p => p.id === 'other')!.parentId, 'from')
  const { parent, sub } = parentThere(h)
  assert.deepEqual(links(h, 'kid', parent), ['dune'])
  assert.deepEqual(links(h, 'kid2', parent), ['dune'])
  assert.deepEqual(links(h, 'grand', parent), ['kid'])
  assert.deepEqual(links(h, 'dune', sub), ['kid', 'kid2'])
  assert.deepEqual(links(h, 'kid', sub), ['grand'])
  for (const id of ['dune', 'kid', 'grand']) { assert.equal(links(h, id, 'par'), undefined); assert.equal(links(h, id, 'sub'), undefined) }
  assert.equal(h.ws.pages.find(p => p.id === 'kid2')!.values?.genreTo !== undefined, true, 'its own values come by name too')
  const numbers = ['dune', 'kid', 'kid2', 'grand'].map(id => links(h, id, rowNumberKey)) as number[]
  assert.equal(new Set(numbers).size, 4, 'each takes its own number there')
})
test('what it says first covers the tree, once each: no word about its own links, and the count leaves out Trash', () => {
  const { h } = tree()
  h.run({ type: 'delete-page', pageId: 'grand', at })
  const plan = planRowMove(h.ws, row(h), dbOf(h, 'from'), dbOf(h, 'to'))
  assert.equal(plan.subItems, 2)
  assert.deepEqual(plan.leftBehind, ['Rating'])
  assert.deepEqual(plan.linksLost, [])
  assert.deepEqual(plan.optionsAdded.filter(o => o.name === 'History').length, 1)
})
test('a sub-item taken alone keeps what\'s under it and names the parent it leaves', () => {
  const { h } = tree()
  const kid = h.ws.pages.find(p => p.id === 'kid')!
  const plan = planRowMove(h.ws, kid, dbOf(h, 'from'), dbOf(h, 'to'))
  assert.equal(plan.subItems, 1)
  assert.deepEqual(plan.leftBehind, ['Parent item'])
  assert.deepEqual(plan.linksLost, [{ database: 'From', rows: 1 }])
  h.run({ type: 'move-row', pageId: 'kid', databaseId: 'to', at })
  assert.deepEqual(links(h, 'grand', parentThere(h).parent), ['kid'])
  assert.equal(links(h, 'kid', parentThere(h).parent), undefined)
  assert.deepEqual(links(h, 'dune', 'sub'), ['kid2'], 'the old parent keeps its other sub-item')
})
test('a row in Trash goes with the tree, so restoring it puts it back under its parent', () => {
  const { h, move } = tree()
  h.run({ type: 'delete-page', pageId: 'grand', at })
  move()
  const grand = h.ws.pages.find(p => p.id === 'grand')!
  assert.equal(grand.parentId, 'to')
  assert.ok(grand.trashedAt)
  assert.deepEqual(links(h, 'grand', parentThere(h).parent), ['kid'])
})
test('sub-items already on in the target are used, not made twice, with its names taken', () => {
  const { h, change, move } = tree()
  change('to', { kind: 'setSubItems', on: { parent: 'upTo', sub: 'downTo' } })
  const count = dbOf(h, 'to').database.properties.length
  move()
  assert.equal(dbOf(h, 'to').database.properties.length, count)
  assert.deepEqual(links(h, 'kid', 'upTo'), ['dune'])
  assert.deepEqual(links(h, 'dune', 'downTo'), ['kid', 'kid2'])
})
test('a row with no sub-items doesn\'t turn them on there; a tree that won\'t fit and To-dos are refused', () => {
  const { h, move } = tree()
  h.run({ type: 'move-row', pageId: 'other', databaseId: 'to', at })
  assert.equal(dbOf(h, 'to').database.subItems, undefined)
  const page = dbOf(h, 'to')
  const filler = Array.from({ length: 9_997 }, (_, n) => ({ id: `f${n}`, type: 'document' as const, date: null, title: '', parentId: 'to', document: '[]', createdAt: at, editedAt: at }))
  h.ws.pages.push(...filler as never[])
  assert.equal(page.id, 'to')
  assert.throws(move, /is full/)
  dbOf(h, 'people').database.fixed = true
  assert.throws(() => h.run({ type: 'move-row', pageId: 'dune', databaseId: 'people', at }), /To-dos/)
})
test('one Undo puts the whole tree back with its links, and the target\'s sub-items off', () => {
  const { h, move } = tree()
  const before = structuredClone(h.ws.pages.filter(p => p.parentId === 'from' && !p.trashedAt).map(p => [p.id, p.values]))
  const r = move()
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(h.ws.pages.filter(p => p.parentId === 'from' && !p.trashedAt).map(p => [p.id, p.values]), before)
  assert.equal(dbOf(h, 'to').database.subItems, undefined)
  assert.equal(dbOf(h, 'to').database.properties.some(p => /Parent item/.test(p.name)), false)
})

