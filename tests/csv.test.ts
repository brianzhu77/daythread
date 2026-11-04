// CSV (docs/design/csv.md, R4-7): text in and out, and a database as a sheet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byteOrderMark, csvFile, databaseSheet, exportedRows, parseDelimited, pastedValue, planPaste, writeDelimited } from '../src/domain/csv.ts'
import { cellValue } from '../src/domain/database.ts'
import type { Database, DatabaseChange, View } from '../src/domain/database.ts'
import { harness, today } from './v2-helpers.ts'

test('commas, quotes and newlines survive a round trip; Chinese too', () => {
  const rows = [['a,b', 'say "hi"', 'two\nlines', 'x\r\ny'], ['读书', '', ' spaced ', 'tab\there']]
  assert.deepEqual(parseDelimited(writeDelimited(rows)), rows)
  assert.deepEqual(parseDelimited(writeDelimited(rows, '\t'), '\t'), rows)
})
test('reading: line endings, a byte order mark, a last line without an ending, and what a spreadsheet writes', () => {
  assert.deepEqual(parseDelimited(`${byteOrderMark}a,b\r\n1,2\r\n`), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseDelimited('a,b\n1,2'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseDelimited('a\rb\r'), [['a'], ['b']])
  assert.deepEqual(parseDelimited('"x\ty"\tz\n', '\t'), [['x\ty', 'z']])
  assert.deepEqual(parseDelimited('a,,\n'), [['a', '', '']])
  assert.deepEqual(parseDelimited(''), [])
  assert.deepEqual(parseDelimited('say "hi",b'), [['say "hi"', 'b']])
})

const at = '2026-10-22T18:00:00.000Z'
function books() {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'b', homeBlockId: null, title: 'Books' })
  const add = (property: object) => h.run({ type: 'change-database', pageId: 'b', change: { kind: 'addProperty', property } as DatabaseChange })
  add({ id: 'n', name: 'Pages', type: 'number' }); add({ id: 'd', name: 'Read', type: 'date' }); add({ id: 'c', name: 'Owned', type: 'checkbox' }); add({ id: 't', name: 'Notes', type: 'text' })
  add({ id: 's', name: 'Genre', type: 'select', options: [{ id: 'sf', name: 'SF' }] })
  add({ id: 'm', name: 'Tags', type: 'multiSelect', options: [{ id: 'x', name: 'one' }, { id: 'y', name: 'two' }] })
  h.run({ type: 'add-row', databaseId: 'b', pageId: 'dune', title: 'Dune', values: { n: -5, d: { start: '2026-01-02', end: '2026-01-09' }, c: true, t: '=SUM(A1), and more', s: 'sf', m: ['x', 'y'] }, at })
  h.run({ type: 'add-row', databaseId: 'b', pageId: 'emma', title: '@Emma', values: { n: 300, t: '-minus' }, at })
  return h
}
const dbOf = (h: ReturnType<typeof harness>) => h.ws.pages.find(p => p.id === 'b')!.database as Database

test('a sheet: ISO dates, Yes and No, names joined, a number left as a number, and text that would run is defused', () => {
  const h = books(), db = dbOf(h)
  const { rows, columns } = exportedRows(h.ws, 'b', 'whole')
  const sheet = databaseSheet(db, rows, columns)
  assert.deepEqual(sheet[0], ['Name', 'Pages', 'Read', 'Owned', 'Notes', 'Genre', 'Tags'])
  assert.deepEqual(sheet[1], ['Dune', '-5', '2026-01-02 → 2026-01-09', 'Yes', "'=SUM(A1), and more", 'SF', 'one, two'])
  assert.deepEqual(sheet[2], ["'@Emma", '300', '', 'No', "'-minus", '', ''])
  assert.ok(csvFile(sheet).startsWith(byteOrderMark))
  assert.deepEqual(parseDelimited(csvFile(sheet)), sheet)
})
test('this view: its rows and visible properties, in its order; the whole database: everything', () => {
  const h = books(), db = dbOf(h)
  const view: View = { ...db.views[0]!, filter: [{ by: 'n', op: 'gt', value: 0 }], columns: [{ id: 'n' }, { id: 't' }] }
  const context = { today, pageDate: null, weekStart: 0 as const }
  const shown = exportedRows(h.ws, 'b', { view, context })
  assert.deepEqual(shown.rows.map(r => r.id), ['emma'])
  assert.deepEqual(shown.columns.map(c => c.id), ['n', 't'])
  const whole = exportedRows(h.ws, 'b', 'whole')
  assert.equal(whole.rows.length, 2)
  assert.equal(whole.columns.length, 6)
})

test('pasted words: each type, and what they can\'t be', () => {
  const db = dbOf(books()), p = (id: string) => db.properties.find(x => x.id === id)!
  assert.equal(pastedValue(db, p('n'), '1,234'), 1234)
  assert.equal(pastedValue(db, p('n'), 'many'), undefined)
  assert.deepEqual(pastedValue(db, p('d'), '2026-01-02'), { start: '2026-01-02' })
  assert.deepEqual(pastedValue(db, p('d'), '03/04/2026'), { start: '2026-03-04' })
  assert.equal(pastedValue(db, p('d'), '25/04/2026'), undefined)
  assert.deepEqual(pastedValue(db, p('d'), '2026-01-02 → 2026-01-09'), { start: '2026-01-02', end: '2026-01-09' })
  assert.equal(pastedValue(db, p('c'), 'Yes'), true)
  assert.equal(pastedValue(db, p('c'), 'false'), null)
  assert.equal(pastedValue(db, p('c'), 'maybe'), undefined)
  assert.equal(pastedValue(db, p('s'), 'sf'), 'sf')
  assert.equal(pastedValue(db, p('s'), 'New one'), undefined)
  assert.deepEqual(pastedValue(db, p('m'), 'one, two'), ['x', 'y'])
  assert.equal(pastedValue(db, p('m'), 'one, three'), undefined)
})
test('a grid: across and down from the cell, new rows past the end, what doesn\'t fit counted, one Undo takes it all', () => {
  const h = books(), db = dbOf(h), p = (id: string) => db.properties.find(x => x.id === id)!
  const rows = exportedRows(h.ws, 'b', 'whole').rows
  const columns = [{ id: 'title', name: 'Name', type: 'text' as const }, p('n'), p('t')]
  const plan = planPaste(db, parseDelimited('11\tfirst\textra\nmany\t\n33\tthird', '\t'), rows, columns, 0, 1)
  assert.deepEqual(plan.items.map(i => i.pageId), ['dune', 'emma'])
  assert.deepEqual(plan.items[0]!.values, { n: 11, t: 'first' })
  assert.deepEqual(plan.items[1]!.values, { t: null })
  assert.deepEqual(plan.newRows, [{ title: '', values: { n: 33, t: 'third' } }])
  assert.deepEqual([plan.pasted, plan.unconverted, plan.readOnly, plan.dropped], [5, 1, 0, 1])
  const before = h.ws.pages.filter(x => x.parentId === 'b').length
  const r = h.run({ type: 'paste-cells', databaseId: 'b', items: plan.items, rows: plan.newRows.map(n => ({ ...n, pageId: 'made' })), at })
  const value = (rowId: string, id: string) => cellValue(dbOf(h), h.ws.pages.find(x => x.id === rowId)!, id)
  assert.equal(value('dune', 'n'), 11)
  assert.equal(value('emma', 't'), null)
  assert.equal(value('made', 'n'), 33)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(value('dune', 'n'), -5)
  assert.equal(h.ws.pages.filter(x => x.parentId === 'b').length, before)
})
test('a grid doesn\'t write what changed underneath it, and read-only columns are skipped and counted', () => {
  const h = books(), db = dbOf(h)
  const rows = exportedRows(h.ws, 'b', 'whole').rows
  const plan = planPaste(db, [['9']], rows, [db.properties.find(x => x.id === 'n')!], 0, 0)
  h.run({ type: 'set-values', pageId: 'dune', values: { n: 1 }, expected: {}, at })
  assert.throws(() => h.run({ type: 'paste-cells', databaseId: 'b', items: plan.items, rows: [], at }), /Changed elsewhere/)
  const readOnly = planPaste(db, [['x']], rows, [{ id: 'made', name: 'Made', type: 'createdTime' }], 0, 0)
  assert.deepEqual([readOnly.pasted, readOnly.readOnly], [0, 1])
})
