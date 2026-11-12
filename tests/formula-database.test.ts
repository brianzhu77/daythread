// Formulas as a column (design §3, §5, R4-3): read-only and never stored, with the cell, a filter, a sort, a sum and the export reading one value.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, columnCalc, databaseRows, groupableProperties, isReadOnly, propertyOf, viewRows, type Database, type DatabaseChange, type PropertyInput } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { exportFiles } from '../src/domain/export.ts'
import { clockIn, formulaErrorOf, formulaRunsOf, storedFormula, worldOf } from '../src/domain/formula.ts'
import { withLinks } from '../src/domain/relations.ts'
import { todoRowId } from '../src/domain/todos-source.ts'
import type { Page } from '../src/domain/types.ts'
import { harness, today } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
function shop() {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'shop', homeBlockId: null, title: 'Shop' })
  const change = (c: DatabaseChange) => h.run({ type: 'change-database', pageId: 'shop', change: c })
  change({ kind: 'addProperty', property: { id: 'price', name: 'Price', type: 'number' } })
  change({ kind: 'addProperty', property: { id: 'qty', name: 'Qty', type: 'number' } })
  h.run({ type: 'add-row', databaseId: 'shop', pageId: 'r1', title: 'Pear', values: { price: 2, qty: 3 }, at })
  h.run({ type: 'add-row', databaseId: 'shop', pageId: 'r2', title: 'Plum', values: { price: 5, qty: 1 }, at })
  h.run({ type: 'add-row', databaseId: 'shop', pageId: 'r3', title: 'Fig', values: { price: 1 }, at })
  const addFormula = (id: string, name: string, typed: string) => change({ kind: 'addProperty', property: { id, name, type: 'formula', formula: storedFormula(typed, worldOf(h.ws), 'shop') } })
  const read = () => withLinks(h.ws)
  const readDb = () => read().pages.find(p => p.id === 'shop')!.database as Database
  const rowOf = (id: string) => read().pages.find(p => p.id === id) as Page
  const cell = (rowId: string, id: string) => cellValue(readDb(), rowOf(rowId), id)
  return { h, change, addFormula, read, readDb, rowOf, cell }
}
const context = { today, pageDate: null, weekStart: 0 as const }

test('a formula reads as a read-only column of what it works out to, and nothing is stored', () => {
  const s = shop()
  s.addFormula('total', 'Total', 'Price * Qty')
  s.addFormula('label', 'Label', 'Name + " x" + Qty')
  s.addFormula('big', 'Big', 'Total > 5')
  s.addFormula('when', 'When', 'parseDate("2026-01-02")')
  const shape = (id: string) => propertyOf(s.readDb(), id)!
  assert.equal(shape('total').type, 'number')
  assert.equal(shape('label').type, 'text')
  assert.equal(shape('big').type, 'checkbox')
  assert.equal(shape('when').type, 'date')
  assert.ok(isReadOnly(shape('total')))
  assert.equal(s.cell('r1', 'total'), 6)
  assert.equal(s.cell('r1', 'label'), 'Pear x3')
  assert.equal(s.cell('r1', 'big'), true)
  assert.equal(s.cell('r2', 'big'), false)
  assert.deepEqual(s.cell('r1', 'when'), { start: '2026-01-02' })
  // An empty number in a product reads empty rather than as nought.
  assert.equal(s.cell('r3', 'total'), null)
  const stored = s.h.ws.pages.find(p => p.id === 'r1')!
  assert.deepEqual(stored.values, { price: 2, qty: 3 })
  assert.equal(s.h.ws.pages.find(p => p.id === 'shop')!.database!.properties.find(p => p.id === 'total')!.type, 'formula')
  assert.throws(() => s.h.run({ type: 'set-values', pageId: 'r1', values: { total: 9 }, expected: {}, at }))
})

test('a cell, a filter, a sort, a sum at the foot and the export read one value', () => {
  const s = shop()
  s.addFormula('total', 'Total', 'Price * Qty')
  const view = (extra: object) => ({ ...s.readDb().views[0]!, ...extra })
  assert.deepEqual(viewRows(s.read(), 'shop', view({ filter: [{ by: 'total', op: 'gt', value: 5 }] }), context).map(r => r.id), ['r1'])
  assert.deepEqual(viewRows(s.read(), 'shop', view({ sort: [{ by: 'total', direction: 'desc' }] }), context).map(r => r.id).slice(0, 2), ['r1', 'r2'])
  assert.deepEqual(viewRows(s.read(), 'shop', view({ filter: [{ by: 'total', op: 'isEmpty' }] }), context).map(r => r.id), ['r3'])
  const rows = databaseRows(s.read(), 'shop')
  assert.deepEqual(columnCalc(s.readDb(), rows, 'total', 'sum', (r, id) => cellValue(s.readDb(), r, id)), { type: 'number', value: 11 })
  const json = exportFiles(s.h.ws, new Date(at)).find(f => f.path.endsWith('workspace.json'))!.text
  assert.ok(exportFiles(s.h.ws, new Date(at)).some(f => f.path.endsWith('/Shop.md') && /\[\[Pear\]\].*\| 6 \|/.test(f.text)), 'the table has the worked-out value')
  assert.ok(json.length > 0)
})

test('it groups by what it works out to, read-only, and makes no board', () => {
  const s = shop()
  s.addFormula('kind', 'Kind', 'if(Price > 1, "dear", "cheap")')
  assert.ok(groupableProperties(s.readDb(), 'table').some(p => p.id === 'kind'))
  assert.ok(!groupableProperties(s.readDb(), 'board').some(p => p.id === 'kind'))
})

test('rename: same result. Delete: Error on the column, and Undo restores it', () => {
  const s = shop()
  s.addFormula('total', 'Total', 'Price * Qty')
  s.change({ kind: 'updateProperty', propertyId: 'price', name: 'Cost' })
  assert.equal(s.cell('r1', 'total'), 6)
  const removed = s.change({ kind: 'removeProperty', propertyId: 'qty' })
  const broken = propertyOf(s.readDb(), 'total')!
  assert.match(broken.formulaError!, /deleted/)
  assert.equal(s.cell('r1', 'total'), null)
  assert.match(formulaErrorOf(s.rowOf('r1'), broken)!, /deleted/)
  s.h.run({ type: 'undo', targetOperationId: removed.receipt.operationId })
  assert.equal(s.cell('r1', 'total'), 6)
  assert.equal(propertyOf(s.readDb(), 'total')!.formulaError, undefined)
})

test('a formula that reads a broken one says so, and a type change that breaks it reads Error rather than a wrong number', () => {
  const s = shop()
  s.addFormula('total', 'Total', 'Price * Qty')
  s.addFormula('twice', 'Twice', 'Total * 2')
  assert.equal(s.cell('r1', 'twice'), 12)
  s.change({ kind: 'updateProperty', propertyId: 'qty', type: 'date' })
  assert.match(propertyOf(s.readDb(), 'total')!.formulaError!, /expects a number/)
  assert.match(propertyOf(s.readDb(), 'twice')!.formulaError!, /Total has an error/)
})

test('text that does not work is refused, with the reason, and leaves the old one', () => {
  const s = shop()
  s.addFormula('total', 'Total', 'Price * Qty')
  assert.throws(() => s.change({ kind: 'updateProperty', propertyId: 'total', formula: 'abs("x")' }), /abs expects a number/)
  assert.throws(() => s.change({ kind: 'updateProperty', propertyId: 'total', formula: 'prop("total")' }), /Cycle detected/)
  assert.equal(s.cell('r1', 'total'), 6)
})

test('changing to Formula and back keeps the values under it', () => {
  const s = shop()
  s.change({ kind: 'updateProperty', propertyId: 'qty', type: 'formula', formula: '10' })
  assert.equal(s.cell('r1', 'qty'), 10)
  assert.equal(s.h.ws.pages.find(p => p.id === 'r1')!.values!.qty, 3)
  s.change({ kind: 'updateProperty', propertyId: 'qty', type: 'number' })
  assert.equal(s.cell('r1', 'qty'), 3)
  assert.equal(s.h.ws.pages.find(p => p.id === 'shop')!.database!.properties.find(p => p.id === 'qty')!.formula, undefined)
})

test('with no formula, reading is the workspace itself', () => {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'plain', homeBlockId: null, title: 'Plain' })
  assert.equal(withLinks(h.ws), h.ws)
})

test('the schema carries a formula', () => {
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'change-database', pageId: 'p', change: { kind: 'updateProperty', propertyId: 'x', formula: '1 + 1' } } }).success)
  assert.ok(!commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'change-database', pageId: 'p', change: { kind: 'updateProperty', propertyId: 'x', formula: 'x'.repeat(10_001) } } }).success)
})

test('today() is the reader\'s, in the export as in the browser', () => {
  const s = shop()
  s.addFormula('day', 'Day', 'formatDate(today(), "YYYY-MM-DD")')
  const ws = { ...s.h.ws, timezone: 'Asia/Shanghai' }
  const files = exportFiles(ws, new Date('2026-10-22T18:00:00.000Z'))
  assert.ok(files.some(f => f.path.endsWith('/Shop.md') && f.text.includes('2026-10-23')))
  assert.equal(cellValue(withLinks(ws, clockIn('America/Vancouver', Date.parse(at))).pages.find(p => p.id === 'shop')!.database!, withLinks(ws, clockIn('America/Vancouver', Date.parse(at))).pages.find(p => p.id === 'r1')!, 'day'), '2026-10-22')
})

test('too long is that row\'s Error, says so, and the column stops paying after a few', () => {
  const s = shop()
  s.addFormula('slow', 'Slow', 'map(split(repeat("x", 90000), ""), current + current).length()')
  assert.equal(formulaErrorOf(s.rowOf('r1'), propertyOf(s.readDb(), 'slow')!), 'Too long')
  assert.equal(s.cell('r1', 'slow'), null)
})

// ---------------------------------------------------------------- step 2: across databases
function library() {
  const h = harness()
  const make = (pageId: string, title: string) => h.run({ type: 'create-database', pageId, homeBlockId: null, title })
  make('books', 'Books'); make('authors', 'Authors')
  const change = (pageId: string, c: DatabaseChange) => h.run({ type: 'change-database', pageId, change: c })
  const prop = (pageId: string, property: PropertyInput) => change(pageId, { kind: 'addProperty', property } as DatabaseChange)
  prop('authors', { id: 'age', name: 'Age', type: 'number' })
  prop('authors', { id: 'state', name: 'Status', type: 'status' })
  prop('books', { id: 'pages', name: 'Pages', type: 'number' })
  prop('books', { id: 'by', name: 'By', type: 'relation', target: 'authors' })
  change('books', { kind: 'setMirror', propertyId: 'by', mirror: { id: 'wrote', name: 'Sub-item' } })
  h.run({ type: 'add-row', databaseId: 'authors', pageId: 'herbert', title: 'Herbert', values: { age: 65 }, at })
  h.run({ type: 'add-row', databaseId: 'authors', pageId: 'austen', title: 'Austen', values: { age: 41 }, at })
  h.run({ type: 'add-row', databaseId: 'books', pageId: 'dune', title: 'Dune', values: { pages: 412 }, at })
  h.run({ type: 'add-row', databaseId: 'books', pageId: 'emma', title: 'Emma', values: { pages: 300 }, at })
  h.run({ type: 'set-values', pageId: 'dune', values: { by: ['herbert', 'austen'] }, expected: {}, at })
  const formula = (pageId: string, id: string, name: string, typed: string) => prop(pageId, { id, name, type: 'formula', formula: storedFormula(typed, worldOf(h.ws), pageId) })
  const read = () => withLinks(h.ws)
  const cell = (rowId: string, id: string) => { const row = read().pages.find(p => p.id === rowId)!; return cellValue(read().pages.find(p => p.id === row.parentId)!.database!, row, id) }
  const column = (dbId: string, id: string) => propertyOf(read().pages.find(p => p.id === dbId)!.database!, id)!
  return { h, change, prop, formula, read, cell, column }
}

test('walking a relation: length, a page\'s property, every, a flat walk, current, and let', () => {
  const s = library()
  s.formula('books', 'count', 'Count', 'By.length()')
  s.formula('books', 'oldest', 'Oldest', 'By.first().Age')
  s.formula('books', 'ages', 'Ages', 'sum(By.Age)')
  s.formula('books', 'grown', 'Grown', 'By.every(current.Age > 40)')
  s.formula('books', 'names', 'Names', 'By.map(current.Name).join(" & ")')
  s.formula('books', 'via', 'Via', 'let(a, By.first(), a.Name + " " + a.prop("Age"))')
  s.formula('authors', 'written', 'Written', 'Sub-item.Pages.sum()')
  assert.equal(s.cell('dune', 'count'), 2)
  assert.equal(s.cell('dune', 'oldest'), 65)
  assert.equal(s.cell('dune', 'ages'), 106)
  assert.equal(s.cell('dune', 'grown'), true)
  assert.equal(s.cell('dune', 'names'), 'Herbert & Austen')
  assert.equal(s.cell('dune', 'via'), 'Herbert 65')
  assert.equal(s.cell('herbert', 'written'), 412)
  // Nothing linked: nothing to read, with no Error.
  assert.equal(s.cell('emma', 'count'), 0)
  assert.equal(s.cell('emma', 'oldest'), null)
  assert.equal(formulaErrorOf(s.read().pages.find(p => p.id === 'emma'), s.column('books', 'oldest')), null)
})

test('the design\'s own, pasted as text: a hyphen through a relation, and a date with a status', () => {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'work', homeBlockId: null, title: 'Work' })
  const change = (c: DatabaseChange) => h.run({ type: 'change-database', pageId: 'work', change: c })
  change({ kind: 'addProperty', property: { id: 'state', name: 'Status', type: 'status' } })
  change({ kind: 'addProperty', property: { id: 'due', name: 'Due', type: 'date' } })
  change({ kind: 'addProperty', property: { id: 'parent', name: 'Parent', type: 'relation', target: 'work' } })
  change({ kind: 'setMirror', propertyId: 'parent', mirror: { id: 'subs', name: 'Sub-item' } })
  const options = h.ws.pages.find(p => p.id === 'work')!.database!.properties.find(p => p.id === 'state')!.options!
  const doneId = options.find(o => o.group === 'done')!.id, openId = options.find(o => o.group === 'todo')!.id
  h.run({ type: 'add-row', databaseId: 'work', pageId: 'top', title: 'Top', values: { due: '2020-01-01', state: openId }, at })
  h.run({ type: 'add-row', databaseId: 'work', pageId: 'kid1', title: 'Kid 1', values: { state: doneId, parent: ['top'] }, at })
  h.run({ type: 'add-row', databaseId: 'work', pageId: 'kid2', title: 'Kid 2', values: { state: openId, parent: ['top'] }, at })
  const formula = (id: string, name: string, typed: string) => change({ kind: 'addProperty', property: { id, name, type: 'formula', formula: storedFormula(typed, worldOf(h.ws), 'work') } })
  const doneName = options.find(o => o.group === 'done')!.name
  formula('siblings', 'Siblings done', `Parent.Sub-item.every(current.Status == "${doneName}")`)
  formula('late', 'Late', `if(and(now() > Due, Status != "${doneName}"), "Overdue", "")`)
  const read = withLinks(h.ws), db = read.pages.find(p => p.id === 'work')!.database!
  const cell = (rowId: string, id: string) => cellValue(db, read.pages.find(p => p.id === rowId)!, id)
  assert.equal(cell('kid1', 'siblings'), false)
  assert.equal(cell('top', 'late'), 'Overdue')
  assert.equal(cell('kid1', 'late'), null)
  h.run({ type: 'set-values', pageId: 'kid2', values: { state: doneId }, expected: {}, at })
  const after = withLinks(h.ws)
  assert.equal(cellValue(after.pages.find(p => p.id === 'work')!.database!, after.pages.find(p => p.id === 'kid1')!, 'siblings'), true)
})

test('a property read through a relation is kept by id, so a rename there reads through, and a delete there says so', () => {
  const s = library()
  s.formula('books', 'oldest', 'Oldest', 'By.first().Age')
  const stored = () => s.h.ws.pages.find(p => p.id === 'books')!.database!.properties.find(p => p.id === 'oldest')!.formula
  assert.equal(stored(), 'prop("by").first().prop("age")')
  s.change('authors', { kind: 'updateProperty', propertyId: 'age', name: 'Years' })
  assert.equal(s.cell('dune', 'oldest'), 65)
  s.change('authors', { kind: 'removeProperty', propertyId: 'age' })
  assert.match(s.column('books', 'oldest').formulaError!, /deleted/)
})

test('pages come out as a relation does, read-only, drawing their rows', () => {
  const s = library()
  s.formula('books', 'first', 'First', 'By.first()')
  s.formula('books', 'grown', 'Grown', 'By.filter(current.Age > 50)')
  assert.equal(s.column('books', 'grown').type, 'relation')
  assert.ok(isReadOnly(s.column('books', 'grown')))
  assert.deepEqual(s.column('books', 'grown').options!.map(o => o.name), ['Herbert', 'Austen'])
  assert.deepEqual(s.cell('dune', 'grown'), ['herbert'])
  assert.deepEqual(s.cell('dune', 'first'), ['herbert'])
  assert.equal(s.cell('emma', 'first'), null)
})

test('a rollup reads a formula, a formula reads a rollup, and a loop between two databases is refused', () => {
  const s = library()
  s.formula('authors', 'double', 'Double', 'Age * 2')
  s.prop('books', { id: 'sumDouble', name: 'Sum double', type: 'rollup', rollup: { relation: 'by', property: 'double', fn: 'sum' } })
  assert.equal(s.cell('dune', 'sumDouble'), 212)
  s.formula('books', 'half', 'Half', 'prop("Sum double") / 2')
  assert.equal(s.cell('dune', 'half'), 106)
  // authors.back reads books.half, which reads the rollup, which reads authors.double. Pointing double at back closes it.
  s.formula('authors', 'back', 'Back', 'Sub-item.map(current.Half).first()')
  assert.throws(() => s.change('authors', { kind: 'updateProperty', propertyId: 'double', formula: 'prop("back")' }), /Cycle detected/)
  assert.equal(s.cell('dune', 'sumDouble'), 212)
  assert.throws(() => s.prop('authors', { id: 'bad', name: 'Bad', type: 'formula', formula: 'prop("by")' }), /deleted/)
})

test('a chain across databases stops at 15', () => {
  const h = harness()
  const databases = ['a', 'b']
  for (const d of databases) h.run({ type: 'create-database', pageId: d, homeBlockId: null, title: d })
  const add = (pageId: string, property: object) => h.run({ type: 'change-database', pageId, change: { kind: 'addProperty', property } as DatabaseChange })
  add('a', { id: 'toB', name: 'ToB', type: 'relation', target: 'b' })
  add('b', { id: 'toA', name: 'ToA', type: 'relation', target: 'a' })
  // Each formula reads the one before it, through the other database.
  add('a', { id: 'f0', name: 'F0', type: 'formula', formula: '1' })
  for (let i = 1; i < 15; i++) {
    const here = i % 2 ? 'b' : 'a', link = i % 2 ? 'toA' : 'toB'
    add(here, { id: `f${i}`, name: `F${i}`, type: 'formula', formula: `prop("${link}").first().prop("f${i - 1}")` })
  }
  assert.throws(() => add('b', { id: 'f15', name: 'F15', type: 'formula', formula: 'prop("toA").first().prop("f14")' }), /more than 15/)
})

test('To-dos through a relation: Status and the dates read, and a formula on them', () => {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'jobs', homeBlockId: null, title: 'Jobs' })
  h.run({ type: 'ensure-day', date: today })
  h.run({ type: 'add-task', pageId: `day:${today}`, title: 'Book the flights', plannedOn: today })
  const task = h.ws.tasks.find(t => t.title === 'Book the flights')!
  h.run({ type: 'change-database', pageId: 'jobs', change: { kind: 'addProperty', property: { id: 'jobs', name: 'Jobs', type: 'relation', target: 'source:tasks' } } })
  h.run({ type: 'add-row', databaseId: 'jobs', pageId: 'j1', title: 'One', values: { jobs: [todoRowId(task.id)] }, at })
  const formula = (id: string, name: string, typed: string) => h.run({ type: 'change-database', pageId: 'jobs', change: { kind: 'addProperty', property: { id, name, type: 'formula', formula: storedFormula(typed, worldOf(h.ws), 'jobs') } } })
  formula('open', 'Open', 'Jobs.every(current.Status == "Open")')
  formula('named', 'Named', 'Jobs.first().Name')
  const read = withLinks(h.ws), db = read.pages.find(p => p.id === 'jobs')!.database!, row = read.pages.find(p => p.id === 'j1')!
  assert.equal(cellValue(db, row, 'named'), 'Book the flights')
  assert.equal(cellValue(db, row, 'open'), true)
})

test('a styled cell holds its words, for a filter, a sort and the export, with its look kept beside them', () => {
  const s = shop()
  s.addFormula('flag', 'Flag', 'style(Name, "b", "red")')
  assert.equal(s.cell('r1', 'flag'), 'Pear')
  assert.deepEqual(formulaRunsOf(s.rowOf('r1'), propertyOf(s.readDb(), 'flag')!), [{ text: 'Pear', b: true, color: 'red' }])
  const view = { ...s.readDb().views[0]!, filter: [{ by: 'flag', op: 'contains' as const, value: 'pea' }] }
  assert.deepEqual(viewRows(s.read(), 'shop', view, context).map(r => r.id), ['r1'])
  assert.ok(exportFiles(s.h.ws, new Date(at)).some(f => f.path.endsWith('/Shop.md') && /\| Pear \|/.test(f.text)))
})
