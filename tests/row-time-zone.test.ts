// A row's Created and Edited times are wall clocks; the server reads them in the account's zone, not its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, rowTime, viewRows, type Database, type Property, type View } from '../src/domain/database.ts'
import { exportFiles } from '../src/domain/export.ts'
import type { Action, Page } from '../src/domain/types.ts'
import { harness } from './v2-helpers.ts'

// The Worker runs in UTC; this file pins the process to it, whatever zone the machine running the tests is in.
process.env.TZ = 'UTC'

// 18:30 on 22 October in Vancouver, already 23 October in UTC.
const created = '2026-10-23T01:30:00.000Z'
const block = (id: string, pageId: string) => ({ id, type: 'database', props: { pageId, view: '' }, content: undefined, children: [] })

/** A host page with an inline database "Reading list" holding a Created-time property and one row `r1`. */
function setup() {
  const h = harness()
  h.run({ type: 'create-document', title: 'Books', body: '', pageId: 'books' })
  h.save('books', d => [...d, block('home', 'list')])
  h.run({ type: 'create-database', pageId: 'list', parentId: 'books', homeBlockId: 'home', title: 'Reading list' })
  const change: Extract<Action, { type: 'change-database' }>['change'] = { kind: 'addProperty', property: { id: 'made', name: 'Made', type: 'createdTime' } }
  h.run({ type: 'change-database', pageId: 'list', change })
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'r1', title: 'Dune', values: {}, at: created })
  const database = h.page('list').database as Database
  const property = database.properties.find((p: Property) => p.id === 'made')!
  return { h, database, property, row: h.page('r1') }
}

test('a row time reads in the given zone, and in the process zone without one', () => {
  const { property, row } = setup()
  assert.deepEqual(rowTime(property, row, 'America/Vancouver'), { start: '2026-10-22T18:30' })
  assert.deepEqual(rowTime(property, row, 'Asia/Shanghai'), { start: '2026-10-23T09:30' })
  assert.deepEqual(rowTime(property, row), { start: '2026-10-23T01:30' })
  assert.deepEqual(rowTime(property, row, 'Not/AZone'), rowTime(property, row))
})

test('the hour after the clocks go back reads as the first pass through that hour', () => {
  const { property, row } = setup()
  const later: Page = { ...row, createdAt: '2026-11-01T06:30:00.000Z' }
  assert.deepEqual(rowTime(property, later, 'America/New_York'), { start: '2026-11-01T01:30' })
})

test('a cell value passes the zone through to a Created time', () => {
  const { database, row } = setup()
  assert.deepEqual(cellValue(database, row, 'made', 'America/Vancouver'), { start: '2026-10-22T18:30' })
})

test('a filter on Created is today follows the context zone', () => {
  const { h, database } = setup()
  const view: View = { ...database.views[0]!, filter: [{ by: 'made', op: 'is', value: { relative: 'today' } }] }
  const ids = (zone?: string) => viewRows(h.ws, 'list', view, { today: '2026-10-22', pageDate: null, zone }).map(r => r.id)
  assert.ok(ids('America/Vancouver').includes('r1'))
  assert.ok(!ids().includes('r1'))
})

test('the export shows the account day a row was created on', () => {
  const { h } = setup()
  const files = exportFiles(h.ws, new Date('2026-10-23T02:00:00.000Z'))
  const list = files.find(f => f.path.endsWith('/pages/Reading list.md'))!.text
  assert.match(list, /2026-10-22 18:30/)
  assert.doesNotMatch(list, /2026-10-23/)
})
