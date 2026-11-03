// Relations and rollups (design §6, R3-5, R3-6, R3-7): links stored on rows, both sides in one operation, read through `withLinks`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, databaseRows, groupableProperties, groupValue, isReadOnly, newRowValues, noGroupKey, propertyOf, viewGroups, viewRows, type Database, type DatabaseChange, type Rollup } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { exportFiles } from '../src/domain/export.ts'
import { listedPages } from '../src/domain/page-tree.ts'
import { withLinks } from '../src/domain/relations.ts'
import { todoRowId, todosSourceId } from '../src/domain/todos-source.ts'
import type { Page } from '../src/domain/types.ts'
import { dayId, harness, todo, today } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z', later = '2026-10-23T18:00:00.000Z'
function books() {
  const h = harness()
  const database = (pageId: string, title: string) => h.run({ type: 'create-database', pageId, homeBlockId: null, title })
  database('books', 'Books'); database('authors', 'Authors')
  const change = (pageId: string, c: DatabaseChange) => h.run({ type: 'change-database', pageId, change: c })
  const row = (databaseId: string, pageId: string, title: string, values = {}) => h.run({ type: 'add-row', databaseId, pageId, title, values, at })
  change('authors', { kind: 'addProperty', property: { id: 'born', name: 'Born', type: 'date' } })
  change('authors', { kind: 'addProperty', property: { id: 'age', name: 'Age', type: 'number' } })
  change('authors', { kind: 'addProperty', property: { id: 'alive', name: 'Alive', type: 'checkbox' } })
  row('authors', 'herbert', 'Herbert', { age: 65, born: { start: '1920-10-08' } })
  row('authors', 'austen', 'Austen', { age: 41, born: { start: '1775-12-16' }, alive: true })
  row('books', 'dune', 'Dune'); row('books', 'emma', 'Emma')
  change('books', { kind: 'addProperty', property: { id: 'by', name: 'By', type: 'relation', target: 'authors' } })
  return { h, change, row }
}
const db = (h: ReturnType<typeof harness>, id: string): Page & { database: Database } => withLinks(h.ws).pages.find(p => p.id === id) as Page & { database: Database }
const links = (h: ReturnType<typeof harness>, id: string, prop: string) => { const p = h.ws.pages.find(x => x.id === id)!; return p.values?.[prop] ?? null }
const read = (h: ReturnType<typeof harness>, dbId: string, rowId: string, prop: string) => cellValue(db(h, dbId).database, withLinks(h.ws).pages.find(p => p.id === rowId)!, prop)
const set = (h: ReturnType<typeof harness>, pageId: string, values: object, expected: object = {}, when = later) => h.run({ type: 'set-values', pageId, values: values as never, expected: expected as never, at: when })
const twoWay = (ctx: ReturnType<typeof books>) => ctx.change('books', { kind: 'setMirror', propertyId: 'by', mirror: { id: 'wrote', name: 'Wrote' } })

test('a one-way relation reads the target rows; a row in Trash reads without it, and comes back with it', () => {
  const { h } = books()
  set(h, 'dune', { by: ['herbert', 'austen'] })
  assert.deepEqual(read(h, 'books', 'dune', 'by'), ['herbert', 'austen'])
  assert.equal(links(h, 'herbert', 'by'), null, 'one way: nothing written on the other side')
  h.run({ type: 'delete-page', pageId: 'austen', at })
  assert.deepEqual(read(h, 'books', 'dune', 'by'), ['herbert'])
  assert.deepEqual(links(h, 'dune', 'by'), ['herbert', 'austen'], 'the stored link stays')
  h.run({ type: 'restore-page', pageId: 'austen' })
  assert.deepEqual(read(h, 'books', 'dune', 'by'), ['herbert', 'austen'])
})

test('two-way: "Show on" fills the other side; each edit writes both, moves Edited there, and one Undo takes both back', () => {
  const ctx = books(), { h } = ctx
  set(h, 'dune', { by: ['herbert'] })
  twoWay(ctx)
  assert.deepEqual(links(h, 'herbert', 'wrote'), ['dune'])
  const r = set(h, 'emma', { by: ['austen'] }, {}, later)
  assert.deepEqual(links(h, 'austen', 'wrote'), ['emma'])
  assert.equal(h.ws.pages.find(p => p.id === 'austen')!.editedAt, later)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(links(h, 'austen', 'wrote'), null)
  assert.equal(links(h, 'emma', 'by'), null)
  // From the other side too, and taking one off.
  set(h, 'herbert', { wrote: ['dune', 'emma'] })
  assert.deepEqual(links(h, 'emma', 'by'), ['herbert'])
  set(h, 'herbert', { wrote: ['emma'] })
  assert.equal(links(h, 'dune', 'by'), null)
})

test('two-way: a row deleted and restored keeps its links on both sides', () => {
  const ctx = books(), { h } = ctx
  twoWay(ctx)
  set(h, 'dune', { by: ['herbert'] })
  h.run({ type: 'delete-page', pageId: 'dune', at })
  assert.equal(read(h, 'authors', 'herbert', 'wrote'), null)
  assert.deepEqual(links(h, 'herbert', 'wrote'), ['dune'])
  h.run({ type: 'restore-page', pageId: 'dune' })
  assert.deepEqual(read(h, 'authors', 'herbert', 'wrote'), ['dune'])
  assert.deepEqual(read(h, 'books', 'dune', 'by'), ['herbert'])
})

test('a new row and a duplicate write their back-links', () => {
  const ctx = books(), { h, row } = ctx
  twoWay(ctx)
  row('books', 'ubik', 'Ubik', { by: ['herbert'] })
  assert.deepEqual(links(h, 'herbert', 'wrote'), ['ubik'])
  h.run({ type: 'add-row', databaseId: 'books', pageId: 'ubik2', copyOf: 'ubik', title: '', at })
  assert.deepEqual(links(h, 'herbert', 'wrote'), ['ubik', 'ubik2'])
})

test('1 page: the newest pick stays, and a limit on the other side lets go of the old link', () => {
  const ctx = books(), { h, change } = ctx
  change('books', { kind: 'updateProperty', propertyId: 'by', limit: 1 })
  set(h, 'dune', { by: ['herbert', 'austen'] })
  assert.deepEqual(links(h, 'dune', 'by'), ['austen'])
  change('books', { kind: 'updateProperty', propertyId: 'by', limit: null })
  set(h, 'emma', { by: [] })
  twoWay(ctx)
  change('authors', { kind: 'updateProperty', propertyId: 'wrote', limit: 1 })
  set(h, 'emma', { by: ['austen'] })
  assert.deepEqual(links(h, 'austen', 'wrote'), ['emma'])
  assert.equal(links(h, 'dune', 'by'), null, 'Austen held Dune: it lets go')
})

test('deleting one side removes both, says so, and one Undo brings back both with their links', () => {
  const ctx = books(), { h, change } = ctx
  twoWay(ctx)
  set(h, 'dune', { by: ['herbert'] })
  const r = change('authors', { kind: 'removeProperty', propertyId: 'wrote' })
  assert.match(r.receipt.message, /Wrote and By on Books deleted/)
  assert.ok(!db(h, 'books').database.properties.some(p => p.id === 'by'))
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(read(h, 'books', 'dune', 'by'), ['herbert'])
  assert.deepEqual(read(h, 'authors', 'herbert', 'wrote'), ['dune'])
})

test('a self-relation works both ways with one property; two-way makes two', () => {
  const { h, change, row } = books()
  change('books', { kind: 'addProperty', property: { id: 'see', name: 'See also', type: 'relation', target: 'books' } })
  set(h, 'dune', { see: ['emma'] })
  assert.deepEqual(links(h, 'emma', 'see'), ['dune'])
  set(h, 'emma', { see: [] })
  assert.equal(links(h, 'dune', 'see'), null)
  // A row linking itself writes itself once.
  set(h, 'dune', { see: ['dune'] })
  assert.deepEqual(links(h, 'dune', 'see'), ['dune'])
  row('books', 'ubik', 'Ubik')
  change('books', { kind: 'addProperty', property: { id: 'next', name: 'Next', type: 'relation', target: 'books' } })
  change('books', { kind: 'setMirror', propertyId: 'next', mirror: { id: 'prev', name: 'Previous' } })
  set(h, 'dune', { next: ['ubik'] })
  assert.deepEqual(links(h, 'ubik', 'prev'), ['dune'])
  assert.equal(links(h, 'ubik', 'next'), null)
})

test('rollups: each function, "—" when nothing is linked, read-only, and filter and sort agree with what is shown', () => {
  const { h, change } = books()
  const add = (id: string, fn: Rollup['fn'], property = 'age') => change('books', { kind: 'addProperty', property: { id, name: id, type: 'rollup', rollup: { relation: 'by', property, fn } } })
  for (const fn of ['countAll', 'sum', 'average', 'median', 'min', 'max', 'range', 'percentEmpty', 'countUnique'] as const) add(fn, fn)
  add('first', 'earliest', 'born'); add('last', 'latest', 'born'); add('span', 'dateRange', 'born')
  add('names', 'original', 'title'); add('done', 'checked', 'alive'); add('share', 'percentChecked', 'alive')
  set(h, 'dune', { by: ['herbert', 'austen'] })
  const value = (id: string, row = 'dune') => read(h, 'books', row, id)
  assert.equal(value('countAll'), 2); assert.equal(value('sum'), 106); assert.equal(value('average'), 53); assert.equal(value('median'), 53)
  assert.equal(value('min'), 41); assert.equal(value('max'), 65); assert.equal(value('range'), 24); assert.equal(value('percentEmpty'), 0); assert.equal(value('countUnique'), 2)
  assert.deepEqual(value('first'), { start: '1775-12-16' }); assert.deepEqual(value('last'), { start: '1920-10-08' }); assert.equal(value('span'), '52891 days')
  assert.equal(value('names'), 'Herbert, Austen'); assert.equal(value('done'), 1); assert.equal(value('share'), 50)
  // The rest of the list, with one linked row missing its value.
  for (const fn of ['countValues', 'countEmpty', 'countNotEmpty', 'percentNotEmpty'] as const) add(fn, fn, 'alive')
  add('uniques', 'unique', 'title'); add('off', 'unchecked', 'alive'); add('offShare', 'percentUnchecked', 'alive')
  assert.equal(value('countValues'), 1); assert.equal(value('countEmpty'), 1); assert.equal(value('countNotEmpty'), 1); assert.equal(value('percentNotEmpty'), 50)
  assert.equal(value('uniques'), 'Herbert, Austen'); assert.equal(value('off'), 1); assert.equal(value('offShare'), 50)
  assert.equal(value('countAll', 'emma'), null, 'nothing linked')
  assert.equal(value('sum', 'emma'), null)
  const sum = db(h, 'books').database.properties.find(p => p.id === 'sum')!
  assert.deepEqual([sum.type, sum.readOnly], ['number', true])
  assert.throws(() => set(h, 'dune', { sum: 3 }))
  // A change in a linked row shows at once.
  set(h, 'austen', { age: 42 })
  assert.equal(value('sum'), 107)
  // Sort and filter read the same number.
  const context = { today: '2026-11-02', pageDate: null }, view = db(h, 'books').database.views[0]!
  const ws = withLinks(h.ws)
  assert.deepEqual(viewRows(ws, 'books', { ...view, filter: [{ by: 'sum', op: 'gt', value: 100 }] }, context).map(r => r.id), ['dune'])
  assert.deepEqual(viewRows(ws, 'books', { ...view, sort: [{ by: 'sum', direction: 'desc' }] }, context).map(r => r.id)[0], 'dune')
})

test('no loops: a rollup reads a relation of its database and a real property, never another rollup', () => {
  const { h, change } = books()
  const add = (id: string, relation: string, property: string) => change('books', { kind: 'addProperty', property: { id, name: id, type: 'rollup', rollup: { relation, property, fn: 'countAll' } } })
  add('count', 'by', 'age')
  assert.throws(() => add('bad1', 'nope', 'age'), /reads a relation/)
  assert.throws(() => add('bad2', 'by', 'nope'), /not found/)
  change('authors', { kind: 'addProperty', property: { id: 'wrote', name: 'Wrote', type: 'relation', target: 'books' } })
  assert.throws(() => change('authors', { kind: 'addProperty', property: { id: 'loop', name: 'Loop', type: 'rollup', rollup: { relation: 'wrote', property: 'count', fn: 'countAll' } } }), /another rollup/)
  // A property it reads, deleted since: nothing rather than a wrong number.
  change('authors', { kind: 'removeProperty', propertyId: 'age' })
  set(h, 'dune', { by: ['herbert'] })
  assert.equal(read(h, 'books', 'dune', 'count'), null)
})

test('a target in Trash still reads its links, and with neither type the workspace is untouched', () => {
  const { h } = books()
  set(h, 'dune', { by: ['herbert'] })
  h.run({ type: 'delete-page', pageId: 'authors', at })
  assert.deepEqual(read(h, 'books', 'dune', 'by'), ['herbert'])
  const plain = harness()
  assert.equal(withLinks(plain.ws), plain.ws)
})

test('Pages and the export list each row once, and the export reads titles', () => {
  const { h } = books()
  const count = () => listedPages(h.ws).length
  const before = count()
  set(h, 'dune', { by: ['herbert'] })
  assert.equal(count(), before)
  const files = exportFiles(h.ws, new Date(at))
  assert.equal(files.filter(f => f.path.endsWith('/pages/Dune.md')).length, 1)
  assert.match(files.find(f => f.path.endsWith('/pages/Dune.md'))!.text, /"By": "Herbert"/)
  assert.match(files.find(f => f.path.endsWith('/pages/Books.md'))!.text, /\| \[\[Dune\]\] \| Herbert \|/)
  assert.equal(databaseRows(h.ws, 'books').length, 2)
})

test('a type change follows §6.2: a relation read as text shows its titles, and changing back brings the links back', () => {
  const { h, change } = books()
  set(h, 'dune', { by: ['herbert'] })
  change('books', { kind: 'updateProperty', propertyId: 'by', type: 'text' })
  assert.equal(links(h, 'dune', 'by')?.toString(), 'herbert', 'stored as it was')
  change('books', { kind: 'updateProperty', propertyId: 'by', type: 'relation', target: 'authors' })
  assert.deepEqual(read(h, 'books', 'dune', 'by'), ['herbert'])
  // Two-way: its other side has to go first, so nothing is left half kept in step.
  change('books', { kind: 'setMirror', propertyId: 'by', mirror: { id: 'wrote', name: 'Wrote' } })
  assert.throws(() => change('books', { kind: 'updateProperty', propertyId: 'by', type: 'text' }), /other side/)
})

test('R3-22: Group and Board by a relation: a group per linked row, a row in each, No value last, and a move swaps that one link on both sides', () => {
  const ctx = books(), { h } = ctx
  twoWay(ctx)
  set(h, 'dune', { by: ['herbert', 'austen'] })
  const read2 = () => db(h, 'books').database, view = (layout: 'board' | 'table') => ({ ...read2().views[0]!, layout, groupBy: 'by' })
  const context = { today: '2026-11-02', pageDate: null }
  const groupsOf = (layout: 'board' | 'table') => { const ws = withLinks(h.ws); return viewGroups(read2(), view(layout), viewRows(ws, 'books', view(layout), context))!.shown.map(g => [g.name, g.rows.map(r => r.id)]) }
  assert.deepEqual(groupsOf('board'), [['Herbert', ['dune']], ['Austen', ['dune']], ['No value', ['emma']]])
  assert.deepEqual(groupsOf('table'), groupsOf('board'))
  assert.ok(groupableProperties(read2(), 'board').some(p => p.id === 'by'))
  // A move from Herbert to Austen's column: only that link changes.
  const property = propertyOf(read2(), 'by')!
  set(h, 'emma', { by: groupValue(property, 'herbert', links(h, 'emma', 'by'), noGroupKey, context.today) })
  assert.deepEqual(links(h, 'herbert', 'wrote'), ['dune', 'emma'])
  set(h, 'dune', { by: groupValue(property, 'austen', links(h, 'dune', 'by'), 'herbert', context.today) })
  assert.deepEqual(links(h, 'dune', 'by'), ['austen'])
  assert.deepEqual(links(h, 'herbert', 'wrote'), ['emma'])
  // "1 page": a move replaces it.
  ctx.change('books', { kind: 'updateProperty', propertyId: 'by', limit: 1 })
  set(h, 'emma', { by: groupValue(propertyOf(read2(), 'by')!, 'austen', links(h, 'emma', 'by'), 'herbert', context.today) })
  assert.deepEqual(links(h, 'emma', 'by'), ['austen'])
  ctx.change('books', { kind: 'updateProperty', propertyId: 'by', limit: null })
  // + New under a group starts linked to it.
  assert.deepEqual(newRowValues(read2(), view('table'), context, 'herbert').values.by, ['herbert'])
})

test('R3-22: a rollup groups a table by what it works out to, read-only, and makes no board', () => {
  const { h, change } = books()
  change('books', { kind: 'addProperty', property: { id: 'sum', name: 'Sum', type: 'rollup', rollup: { relation: 'by', property: 'age', fn: 'sum' } } })
  change('books', { kind: 'addProperty', property: { id: 'names', name: 'Names', type: 'rollup', rollup: { relation: 'by', property: 'title', fn: 'original' } } })
  set(h, 'dune', { by: ['herbert'] })
  const database = () => db(h, 'books').database, ws = () => withLinks(h.ws), context = { today: '2026-11-02', pageDate: null }
  const groups = (by: string) => { const view = { ...database().views[0]!, layout: 'table' as const, groupBy: by }; return viewGroups(database(), view, viewRows(ws(), 'books', view, context))!.shown.map(g => [g.name, g.rows.map(r => r.id)]) }
  assert.deepEqual(groups('sum'), [['65', ['dune']], ['No value', ['emma']]])
  assert.deepEqual(groups('names'), [['Herbert', ['dune']], ['No value', ['emma']]])
  const sum = propertyOf(database(), 'sum')!
  assert.equal(isReadOnly(sum), true)
  assert.ok(groupableProperties(database(), 'table').some(p => p.id === 'sum'))
  assert.ok(!groupableProperties(database(), 'board').some(p => p.id === 'sum'))
  // Nothing to prefill from a group it works out.
  assert.equal(newRowValues(database(), { ...database().views[0]!, layout: 'table', groupBy: 'sum' }, context, '65').values.sum, undefined)
})

test('R3-23: a relation to To-dos: one way, a task reads as its title, a deleted one drops out, a rollup reads its columns', () => {
  const { h, change } = books()
  h.day(today)
  h.save(dayId(today), d => [...d, todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed')])
  const flights = h.task('Book the flights').id, bed = h.task('Buy a dog bed').id
  change('books', { kind: 'addProperty', property: { id: 'jobs', name: 'Jobs', type: 'relation', target: todosSourceId } })
  assert.throws(() => change('books', { kind: 'setMirror', propertyId: 'jobs', mirror: { id: 'x', name: 'X' } }), /can't show it/)
  change('books', { kind: 'addProperty', property: { id: 'jobCount', name: 'Count', type: 'rollup', rollup: { relation: 'jobs', property: 'status', fn: 'countAll' } } })
  change('books', { kind: 'addProperty', property: { id: 'jobPlan', name: 'Plan', type: 'rollup', rollup: { relation: 'jobs', property: 'planned', fn: 'latest' } } })
  set(h, 'dune', { jobs: [todoRowId(flights), todoRowId(bed)] })
  assert.deepEqual(read(h, 'books', 'dune', 'jobs'), [todoRowId(flights), todoRowId(bed)])
  assert.equal(db(h, 'books').database.properties.find(p => p.id === 'jobs')!.options!.find(o => o.id === todoRowId(flights))!.name, 'Book the flights')
  assert.equal(read(h, 'books', 'dune', 'jobCount'), 2)
  assert.deepEqual(read(h, 'books', 'dune', 'jobPlan'), { start: today })
  // Nothing is written on a task.
  assert.equal(h.ws.tasks.find(t => t.id === flights)!.version, 1)
  // A deleted task drops out, and the stored link stays for a restore.
  const saved = h.page(dayId(today)).document
  h.save(dayId(today), d => d.filter(n => n.id !== 'r2'))
  assert.deepEqual(read(h, 'books', 'dune', 'jobs'), [todoRowId(flights)])
  assert.equal(read(h, 'books', 'dune', 'jobCount'), 1)
  h.save(dayId(today), () => JSON.parse(saved))
  assert.deepEqual(read(h, 'books', 'dune', 'jobs'), [todoRowId(flights), todoRowId(bed)])
  // The export reads titles, not ids, and To-dos stays out of Pages.
  assert.match(exportFiles(h.ws, new Date(at)).find(f => f.path.endsWith('/pages/Dune.md'))!.text, /Book the flights/)
  assert.ok(!listedPages(h.ws).some(p => p.id === todosSourceId))
})

test('the new changes pass the schema; a target must exist', () => {
  const { change } = books()
  assert.throws(() => change('books', { kind: 'addProperty', property: { id: 'x', name: 'X', type: 'relation', target: 'nowhere' } }), /isn't there/)
  const changes: DatabaseChange[] = [
    { kind: 'addProperty', property: { id: 'r', name: 'R', type: 'relation', target: 'books' } },
    { kind: 'addProperty', property: { id: 'u', name: 'U', type: 'rollup', rollup: { relation: 'r', property: 'title', fn: 'countAll' } } },
    { kind: 'updateProperty', propertyId: 'r', limit: null },
    { kind: 'setMirror', propertyId: 'r', mirror: { id: 'm', name: 'M' } },
    { kind: 'setMirror', propertyId: 'r', mirror: null },
  ]
  for (const c of changes) assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'change-database', pageId: 'p', change: c } }).success, true, c.kind)
})

test('a row template: its relation links nothing back until a row is made from it, and one gone since is dropped', () => {
  const ctx = books()
  twoWay(ctx)
  const { h } = ctx
  const backlinks = (id: string) => h.page(id).values?.wrote
  h.run({ type: 'create-template', databaseId: 'books', title: 'Review', pageId: 'tmpl' } as never)
  const authors = h.ws.pages.filter(p => p.parentId === 'authors').map(p => p.id)
  const [first, second] = authors as [string, string]
  h.run({ type: 'set-values', pageId: 'tmpl', values: { by: [first, second] } } as never)
  assert.deepEqual(h.page('tmpl').values?.by, [first, second])
  assert.equal((backlinks(first) as string[] | undefined)?.includes('tmpl') ?? false, false, 'nothing links to a template')
  h.run({ type: 'add-row', databaseId: 'books', pageId: 'made', title: '', template: 'tmpl', at: '2026-10-22T18:00:00.000Z' } as never)
  assert.equal((backlinks(first) as string[]).includes('made'), true, 'the new row links back')
  h.run({ type: 'delete-page', pageId: second, at: '2026-10-22T18:00:00.000Z' } as never)
  h.run({ type: 'add-row', databaseId: 'books', pageId: 'later', title: '', template: 'tmpl', at: '2026-10-22T18:00:00.000Z' } as never)
  assert.deepEqual(h.page('later').values?.by, [first], 'a row in Trash since is dropped')
})
