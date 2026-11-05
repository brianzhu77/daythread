// R3-16: what a type change converts. Rows keep what they hold, so changing back restores it; what reads differently is how it's read (Lead 90ba3fec).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, groupValue, inView, viewGroups, type Database, type DatabaseChange, type Property, type View } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { valueText } from '../src/domain/database.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z'
function shelf(values: Record<string, unknown>[]) {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'Shelf' })
  const change = (c: DatabaseChange) => h.run({ type: 'change-database', pageId: 'db', change: c })
  change({ kind: 'addProperty', property: { id: 't', name: 'T', type: 'text' } })
  change({ kind: 'addProperty', property: { id: 'd', name: 'D', type: 'date' } })
  change({ kind: 'addProperty', property: { id: 'c', name: 'C', type: 'checkbox' } })
  change({ kind: 'addProperty', property: { id: 's', name: 'S', type: 'select', options: [{ id: 'x', name: 'Ex' }, { id: 'y', name: 'Why' }] } })
  values.forEach((v, i) => h.run({ type: 'add-row', databaseId: 'db', pageId: `r${i}`, title: `Row ${i}`, values: v as never, at }))
  const db = () => h.ws.pages.find(p => p.id === 'db')!.database as Database
  const prop = (id: string) => db().properties.find(p => p.id === id)! as Property
  const row = (i: number) => h.ws.pages.find(p => p.id === `r${i}`)!
  const type = (id: string, to: string) => change({ kind: 'updateProperty', propertyId: id, type: to as never })
  const words = (id: string, i: number) => valueText(db(), id, cellValue(db(), row(i), id))
  return { h, change, db, prop, row, type, words }
}
test('Text to Select: an option for each thing the rows say, once, by first spelling and in order; the rows keep their words and changing back restores them', () => {
  const s = shelf([{ t: 'Alpha' }, { t: ' alpha ' }, { t: 'Beta' }, {}, { t: '  ' }])
  const raws = () => [0, 1, 2].map(i => s.row(i).values?.t)
  const r = s.type('t', 'select')
  assert.equal(r.receipt.message, 'Changed to Select')
  assert.deepEqual(s.prop('t').options!.map(o => o.name), ['Alpha', 'Beta'])
  assert.deepEqual([0, 1, 2].map(i => s.words('t', i)), ['Alpha', 'Alpha', 'Beta'])
  assert.deepEqual(raws(), ['Alpha', ' alpha ', 'Beta'], 'nothing written to the rows')
  s.type('t', 'text')
  assert.deepEqual([0, 1, 2].map(i => cellValue(s.db(), s.row(i), 't')), ['Alpha', ' alpha ', 'Beta'], 'exactly what was there')
  s.type('t', 'select')
  assert.deepEqual(s.prop('t').options!.map(o => o.name), ['Alpha', 'Beta'], 'and again makes no second set')
})
test('Text to Multi-select splits on commas; back to Text is what it was', () => {
  const s = shelf([{ t: 'red, green' }, { t: 'Green,blue' }])
  s.type('t', 'multiSelect')
  assert.deepEqual(s.prop('t').options!.map(o => o.name), ['red', 'green', 'blue'])
  assert.equal(s.words('t', 0), 'red, green')
  assert.equal(s.words('t', 1), 'green, blue')
  s.type('t', 'text')
  assert.equal(cellValue(s.db(), s.row(1), 't'), 'Green,blue')
})
test('a renamed option keeps its rows, one picked later saves its id, and back to Text reads each', () => {
  const s = shelf([{ t: 'Alpha' }, { t: 'Beta' }])
  s.type('t', 'select')
  const options = s.prop('t').options!
  const renamed = options.map(o => o.name === 'Alpha' ? { ...o, name: 'First' } : o)
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'change-database', pageId: 'db', change: { kind: 'updateProperty', propertyId: 't', options: renamed } } }).success)
  s.change({ kind: 'updateProperty', propertyId: 't', options: renamed })
  assert.equal(s.words('t', 0), 'First')
  s.h.run({ type: 'set-values', pageId: 'r1', values: { t: options[0]!.id }, expected: {}, at })
  assert.equal(s.words('t', 1), 'First')
  s.type('t', 'text')
  assert.equal(cellValue(s.db(), s.row(0), 't'), 'Alpha', 'its own words')
  assert.equal(cellValue(s.db(), s.row(1), 't'), 'First', 'the option picked')
})
test('a name already an option takes it; past 200 and too long stay in the row, are counted, and come back', () => {
  const s = shelf([{ t: 'Ex' }, { t: 'y'.repeat(201) }])
  s.change({ kind: 'updateProperty', propertyId: 't', options: [{ id: 'old', name: 'ex' }] })
  const r = s.type('t', 'select')
  assert.equal(r.receipt.message, 'Changed to Select · 1 value shows as empty')
  assert.deepEqual(s.prop('t').options!.map(o => o.id), ['old'])
  assert.equal(s.words('t', 0), 'ex')
  s.type('t', 'text')
  assert.equal(cellValue(s.db(), s.row(1), 't'), 'y'.repeat(201))
  const many = shelf(Array.from({ length: 205 }, (_, i) => ({ t: `v${i}` })))
  const made = many.type('t', 'select')
  assert.equal(many.prop('t').options!.length, 200)
  assert.equal(made.receipt.message, 'Changed to Select · 5 values show as empty')
})
test('Date and Checkbox to Text keep their words, and changing back restores them', () => {
  const s = shelf([{ d: { start: '2026-11-05' }, c: true }, { d: { start: '2026-11-05', end: '2026-11-07' } }, { d: { start: '2026-11-05T09:30' } }])
  const r = s.type('d', 'text')
  assert.equal(r.receipt.message, 'Changed to Text')
  assert.deepEqual([0, 1, 2].map(i => cellValue(s.db(), s.row(i), 'd')), ['2026-11-05', '2026-11-05 → 2026-11-07', '2026-11-05 09:30'])
  assert.equal(s.type('c', 'text').receipt.message, 'Changed to Text')
  assert.equal(cellValue(s.db(), s.row(0), 'c'), 'Yes')
  assert.equal(cellValue(s.db(), s.row(1), 'c'), null, 'an unticked box says nothing')
  s.type('d', 'date'); s.type('c', 'checkbox')
  assert.deepEqual(cellValue(s.db(), s.row(1), 'd'), { start: '2026-11-05', end: '2026-11-07' })
  assert.equal(cellValue(s.db(), s.row(0), 'c'), true)
  assert.equal(s.type('d', 'url').receipt.message, 'Changed to URL · 3 values show as empty', 'an address is not a date')
})
test('Select or Multi-select to Relation counts as lost, and changing back restores them', () => {
  const s = shelf([{ s: 'x' }, { s: 'y' }, {}])
  s.h.run({ type: 'create-database', pageId: 'other', homeBlockId: null, title: 'Other' })
  const r = s.change({ kind: 'updateProperty', propertyId: 's', type: 'relation', target: 'other' } as never)
  assert.equal(r.receipt.message, 'Changed to Relation · 2 values show as empty')
  s.change({ kind: 'updateProperty', propertyId: 's', type: 'select' })
  assert.equal(s.words('s', 0), 'Ex')
})
test('a Select from Text groups, filters and takes a Board\'s move like any other', () => {
  const s = shelf([{ t: 'Alpha' }, { t: 'Beta' }, { t: 'Alpha' }])
  s.type('t', 'select')
  const alpha = s.prop('t').options!.find(o => o.name === 'Alpha')!.id, beta = s.prop('t').options!.find(o => o.name === 'Beta')!.id
  const view = { ...s.db().views[0]!, layout: 'board', groupBy: 't' } as View
  const rows = s.h.ws.pages.filter(p => p.parentId === 'db')
  const groups = viewGroups(s.db(), view, rows, (r, id) => r.values?.[id])
  const shown = groups!.shown.filter(g => g.rows.length).map(g => [g.name, g.rows.length])
  assert.deepEqual(shown, [['Alpha', 2], ['Beta', 1]])
  const filtered = { ...view, filter: [{ by: 't', op: 'isAnyOf', value: [alpha] }] } as View
  assert.deepEqual(rows.filter(r => inView(s.db(), r, filtered, { today: '2026-11-05', pageDate: null })).map(r => r.id), ['r0', 'r2'])
  assert.equal(groupValue(s.prop('t'), beta, s.row(0).values?.t, alpha, '2026-11-05'), beta)
})
test('a Multi-select from Text: a Board\'s move takes one word out and puts the other in, as ids, reading back right', () => {
  const s = shelf([{ t: 'red, green' }])
  s.type('t', 'multiSelect')
  const id = (n: string) => s.prop('t').options!.find(o => o.name === n)!.id
  const moved = groupValue(s.prop('t'), id('green'), s.row(0).values?.t, id('red'), '2026-11-05')
  assert.deepEqual(moved, [id('green')])
})
test('through more than one change: Text to Select to Multi-select keeps a name with a comma, and Text to Multi-select to Select reads the first, as a list does', () => {
  const s = shelf([{ t: 'Red, Blue' }])
  s.type('t', 'select')
  assert.equal(s.words('t', 0), 'Red, Blue')
  const toMulti = s.type('t', 'multiSelect')
  assert.equal(toMulti.receipt.message, 'Changed to Multi-select')
  assert.equal(s.words('t', 0), 'Red, Blue')
  s.type('t', 'text')
  assert.equal(cellValue(s.db(), s.row(0), 't'), 'Red, Blue')
  const other = shelf([{ t: 'Red, Blue' }])
  other.type('t', 'multiSelect')
  assert.equal(other.words('t', 0), 'Red, Blue')
  const toSelect = other.type('t', 'select')
  assert.equal(toSelect.receipt.message, 'Changed to Select')
  assert.equal(other.words('t', 0), 'Red')
  other.type('t', 'text')
  assert.equal(cellValue(other.db(), other.row(0), 't'), 'Red, Blue')
})
test('renamed along the way, both chains keep their rows', () => {
  const rename = (s: ReturnType<typeof shelf>, from: string, to: string) => s.change({ kind: 'updateProperty', propertyId: 't', options: s.prop('t').options!.map(o => (o.name === from ? { ...o, name: to } : o)) })
  const a = shelf([{ t: 'Red, Blue' }])
  a.type('t', 'select'); rename(a, 'Red, Blue', 'Purple')
  a.type('t', 'multiSelect')
  assert.equal(a.words('t', 0), 'Purple')
  a.type('t', 'text')
  assert.equal(cellValue(a.db(), a.row(0), 't'), 'Red, Blue', 'its own words at the end')
  const b = shelf([{ t: 'Red, Blue' }])
  b.type('t', 'multiSelect'); rename(b, 'Red', 'Crimson')
  assert.equal(b.words('t', 0), 'Crimson, Blue')
  b.type('t', 'select')
  assert.equal(b.words('t', 0), 'Crimson')
  b.type('t', 'multiSelect')
  assert.equal(b.words('t', 0), 'Crimson, Blue')
})

