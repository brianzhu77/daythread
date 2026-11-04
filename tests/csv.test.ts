// CSV (docs/design/csv.md, R4-7): text in and out, and a database as a sheet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byteOrderMark, csvFile, databaseSheet, exportedRows, parseDelimited, writeDelimited } from '../src/domain/csv.ts'
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
