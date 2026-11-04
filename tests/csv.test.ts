// CSV (docs/design/csv.md, R4-7): text in and out, and a database as a sheet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byteOrderMark, csvFile, databaseSheet, decodeCsv, detectDelimiter, exportedRows, importRefusal, parseDelimited, pastedValue, planImport, planPaste, readSheet, suggestKind, workspaceBytes, writeDelimited } from '../src/domain/csv.ts'
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

// ---------------------------------------------------------------- import
let n = 0
const id = () => `id-${n++}`
test('reading a file: GBK when it isn\'t UTF-8, a byte order mark, and which delimiter', () => {
  assert.equal(decodeCsv(new Uint8Array([0xe8, 0xaf, 0xbb, 0xe4, 0xb9, 0xa6])), '读书')
  assert.equal(decodeCsv(new Uint8Array([0xb6, 0xc1, 0xca, 0xe9])), '读书')
  assert.equal(detectDelimiter('a,b\n1,2'), ',')
  assert.equal(detectDelimiter('a;b;c\n1,5;2;3'), ';')
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t')
  assert.deepEqual(readSheet(`${byteOrderMark}名称,数\n读书,1`, null).columns.map(c => c.header), ['名称', '数'])
})
test('suggesting a type: never guesses a day, never a multi-select, and $ or % stay as written', () => {
  assert.equal(suggestKind(['1', '2,000', '-3.5', '']), 'number')
  assert.equal(suggestKind(['2026-01-02', '03/04/2026']), 'date')
  assert.equal(suggestKind(['03/04/2026', '25/04/2026']), 'text')
  assert.equal(suggestKind(['Yes', 'no', 'TRUE']), 'checkbox')
  assert.equal(suggestKind(['a', 'b', 'a', 'a', 'b']), 'select')
  assert.equal(suggestKind(['$12', '$13']), 'text')
  assert.equal(suggestKind(['45%', '50%']), 'text')
  assert.equal(suggestKind(['only one', 'and another']), 'text')
  assert.equal(suggestKind(['']), 'text')
})
test('a new database: Name found, properties made with their options, one command, one Undo', () => {
  const h = harness()
  const sheet = readSheet('Pages,Title,Read,Genre,Notes\n412,Dune,2026-01-02,SF,"a, b"\n100,Emma,03/04/2026,SF,\n1,Ubik,,Novel,\n2,Mir,,SF,\n\n', null)
  assert.equal(sheet.emptyRows, 1)
  assert.deepEqual(sheet.columns.map(c => c.target.to), ['new', 'name', 'new', 'new', 'new'])
  const plan = planImport(sheet, null, id)
  const r = h.run({ type: 'import-csv', databaseId: 'made', create: { homeBlockId: null, title: 'Made' }, changes: plan.changes, rows: plan.rows, at })
  const page = h.ws.pages.find(p => p.id === 'made')!, db = page.database as Database
  assert.deepEqual(db.properties.map(p => [p.name, p.type]), [['Pages', 'number'], ['Read', 'date'], ['Genre', 'select'], ['Notes', 'text']])
  const rows = h.ws.pages.filter(p => p.parentId === 'made')
  assert.deepEqual(rows.map(p => p.title), ['Dune', 'Emma', 'Ubik', 'Mir'])
  const get = (t: string, name: string) => { const p = db.properties.find(x => x.name === name)!; return cellValue(db, rows.find(x => x.title === t)!, p.id) }
  assert.equal(get('Dune', 'Pages'), 412)
  assert.deepEqual(get('Emma', 'Read'), { start: '2026-03-04' })
  assert.equal(get('Dune', 'Notes'), 'a, b')
  assert.equal(db.properties.find(x => x.name === 'Genre')!.options!.map(o => o.name).join(), 'SF,Novel')
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(h.ws.pages.some(p => p.id === 'made' || p.parentId === 'made'), false)
})
test('a merge: matching headers first, new options added, only rows added, and what can\'t be read counted and named', () => {
  const h = books(), db = dbOf(h)
  const sheet = readSheet('Name,Pages,Genre,Tags,Extra,Owned\nSolaris,many,SF,"one, three",x,Yes\nDune,10,Horror,,,maybe\n', db)
  assert.deepEqual(sheet.columns.map(c => (c.target.to === 'existing' ? c.target.propertyId : c.target.to)), ['name', 'n', 's', 'm', 'new', 'c'])
  sheet.columns[4]!.target = { to: 'skip' }
  const plan = planImport(sheet, db, id)
  assert.deepEqual(plan.skipped, ['Extra'])
  assert.deepEqual(plan.bad, [{ row: 2, column: 'Pages', value: 'many' }, { row: 3, column: 'Owned', value: 'maybe' }])
  const before = h.ws.pages.filter(p => p.parentId === 'b').length
  h.run({ type: 'import-csv', databaseId: 'b', changes: plan.changes, rows: plan.rows, at })
  const after = dbOf(h), rows = h.ws.pages.filter(p => p.parentId === 'b')
  // A row of the same name is another row, as Notion's.
  assert.equal(rows.length, before + 2)
  assert.deepEqual(after.properties.find(p => p.id === 's')!.options!.map(o => o.name), ['SF', 'Horror'])
  assert.deepEqual(after.properties.find(p => p.id === 'm')!.options!.map(o => o.name), ['one', 'two', 'three'])
  const solaris = rows.find(p => p.title === 'Solaris')!
  assert.equal(cellValue(after, solaris, 'n'), null)
  assert.equal(cellValue(after, solaris, 'c'), true)
})
test('our own export reads back as it was', () => {
  const h = books(), db = dbOf(h), { rows, columns } = exportedRows(h.ws, 'b', 'whole')
  const sheet = readSheet(csvFile(databaseSheet(db, rows, columns)), db)
  const plan = planImport(sheet, db, id)
  assert.deepEqual(plan.bad, [])
  assert.deepEqual(plan.rows.map(r => r.title), ['Dune', '@Emma'])
  assert.equal(plan.rows[0]!.values!.t, '=SUM(A1), and more')
  assert.equal(plan.rows[0]!.values!.n, -5)
  assert.deepEqual(plan.rows[0]!.values!.d, { start: '2026-01-02', end: '2026-01-09' })
})
test('the limits: rows, and the size of the workspace, asked on the server too', () => {
  const h = books()
  const big = Array.from({ length: 10_001 }, (_, i) => ({ pageId: `r${i}`, title: 'x' }))
  assert.match(importRefusal(h.ws, big)!, /10,001 rows.*Nothing was written/)
  assert.throws(() => h.run({ type: 'import-csv', databaseId: 'b', changes: [], rows: big, at }), /Nothing was written/)
  const wordy = Array.from({ length: 3000 }, (_, i) => ({ pageId: `w${i}`, title: 'y', values: { t: 'x'.repeat(4000) } }))
  assert.match(importRefusal(h.ws, wordy)!, /can hold about 10.0 MB/)
  assert.equal(importRefusal(h.ws, big.slice(0, 100)), null)
  assert.ok(workspaceBytes(h.ws) < 100_000)
  assert.equal(h.ws.pages.filter(p => p.parentId === 'b').length, 2)
})
