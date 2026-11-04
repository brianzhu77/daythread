// Formulas as a column (design §3, §5, R4-3): read-only and never stored, with the cell, a filter, a sort, a sum and the export reading one value.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, columnCalc, databaseRows, groupableProperties, isReadOnly, propertyOf, viewRows, type Database, type DatabaseChange } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { exportFiles } from '../src/domain/export.ts'
import { clockIn, formulaErrorOf, storedFormula } from '../src/domain/formula.ts'
import { withLinks } from '../src/domain/relations.ts'
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
  const db = () => h.ws.pages.find(p => p.id === 'shop')!.database!
  const addFormula = (id: string, name: string, typed: string) => change({ kind: 'addProperty', property: { id, name, type: 'formula', formula: storedFormula(typed, db()) } })
  const read = () => withLinks(h.ws)
  const readDb = () => read().pages.find(p => p.id === 'shop')!.database as Database
  const rowOf = (id: string) => read().pages.find(p => p.id === id) as Page
  const cell = (rowId: string, id: string) => cellValue(readDb(), rowOf(rowId), id)
  return { h, change, db, addFormula, read, readDb, rowOf, cell }
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
