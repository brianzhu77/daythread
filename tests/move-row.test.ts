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
