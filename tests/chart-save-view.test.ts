// Chart's Save as view (chart.md §5, G4-8): each bar becomes a Table view whose rows are that bar's, under the chart view's own filter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartData, pointView } from '../src/domain/chart.ts'
import { viewRows, type View } from '../src/domain/database.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z', context = { today: '2026-11-05', pageDate: null, weekStart: 0 as const }
function setup() {
  const h = harness()
  const C = (change: unknown) => h.run({ type: 'change-database', pageId: 'runs', change } as never)
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  C({ kind: 'addProperty', property: { id: 'st', name: 'Stage', type: 'select', options: [{ id: 'a', name: 'A', color: 'gray' }, { id: 'b', name: 'B', color: 'gray' }] } })
  C({ kind: 'addProperty', property: { id: 'tg', name: 'Tags', type: 'multiSelect', options: [{ id: 'x', name: 'X', color: 'gray' }, { id: 'y', name: 'Y', color: 'gray' }] } })
  C({ kind: 'addProperty', property: { id: 'ok', name: 'Done', type: 'checkbox' } })
  C({ kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } })
  C({ kind: 'addProperty', property: { id: 't', name: 'Kind', type: 'text' } })
  C({ kind: 'addProperty', property: { id: 'd', name: 'When', type: 'date' } })
  const rows: [string, object][] = [
    ['r1', { st: 'a', tg: ['x'], ok: true, n: 1, t: 'easy', d: { start: '2026-10-30' } }],
    ['r2', { st: 'b', tg: ['x', 'y'], n: 2, t: 'hard', d: { start: '2026-11-02' } }],
    ['r3', { st: 'a', n: 1, t: 'easy', d: { start: '2026-11-04' } }],
    ['r4', { tg: ['y'], ok: true, d: { start: '2026-12-15' } }],
    ['r5', { st: 'b', n: 3 }],
  ]
  for (const [id, values] of rows) h.run({ type: 'add-row', databaseId: 'runs', pageId: id, title: id, values, at } as never)
  return h
}
const chart = (groupBy: string, extra: Partial<View> = {}): View => ({ id: 'c', name: 'Chart', layout: 'chart', columns: [], sort: [], filter: [], groupBy, chart: { form: 'bar' }, ...extra } as View)

for (const [groupBy, extra] of [['st', {}], ['tg', {}], ['ok', {}], ['n', {}], ['d', { groupDateBy: 'day' }], ['d', { groupDateBy: 'week' }], ['d', { groupDateBy: 'month' }], ['d', { chart: { form: 'bar', byYear: true } }]] as const) {
  test(`each bar by ${groupBy}${'groupDateBy' in extra ? ` (${extra.groupDateBy})` : 'chart' in extra ? ' (year)' : ''} saves as a view of exactly its rows`, () => {
    const h = setup(), db = h.page('runs').database!, view = chart(groupBy, extra as Partial<View>)
    const data = chartData(db, view, viewRows(h.ws, 'runs', view, context))
    assert.ok(data && data !== 'choose')
    for (const point of data.points.filter(p => p.rows.length)) {
      const saved = pointView(db, view, point.key, point.name, `v-${point.key}`)
      assert.ok(saved, point.name)
      assert.deepEqual(viewRows(h.ws, 'runs', saved, context).map(r => r.id).sort(), point.rows.map(r => r.id).sort(), point.name)
    }
  })
}

test('the chart view\'s own filter comes along, an "any" one kept as its own group', () => {
  const h = setup(), db = h.page('runs').database!
  const view = chart('st', { filter: [{ by: 'n', op: 'eq', value: 1 }, { by: 'ok', op: 'is', value: true }], filterAny: true })
  const data = chartData(db, view, viewRows(h.ws, 'runs', view, context))
  assert.ok(data && data !== 'choose')
  const a = data.points.find(p => p.key === 'a')!
  const saved = pointView(db, view, 'a', a.name, 'v-a')!
  assert.equal(saved.filterAny, undefined)
  assert.deepEqual(viewRows(h.ws, 'runs', saved, context).map(r => r.id).sort(), a.rows.map(r => r.id).sort())
  // And it's a view the database takes.
  h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'addView', view: saved } } as never)
  assert.ok(h.page('runs').database!.views.some(v => v.id === 'v-a' && v.name === 'A'))
})
