// Chart (docs/design/chart.md): its numbers are the view's own rows and groups, so they match a table and a column calculation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartData, chartMeasure, chartTicks, chartValue, type ChartPoint } from '../src/domain/chart.ts'
import { columnCalc, groupableProperties, viewRows, type Database, type View } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import type { Action } from '../src/domain/types.ts'
import { harness, today } from './v2-helpers.ts'

const ctx = { today, pageDate: null }, at = `${today}T10:00:00.000Z`
function shelf() {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'list', homeBlockId: null, title: 'Reading list' })
  const change = (c: Extract<Action, { type: 'change-database' }>['change']) => h.run({ type: 'change-database', pageId: 'list', change: c })
  change({ kind: 'addProperty', property: { id: 'kind', name: 'Kind', type: 'select', options: [{ id: 'novel', name: 'Novel' }, { id: 'essay', name: 'Essay' }, { id: 'poem', name: 'Poem' }] } })
  change({ kind: 'addProperty', property: { id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'sf', name: 'SF' }, { id: 'hist', name: 'History' }] } })
  change({ kind: 'addProperty', property: { id: 'pages', name: 'Pages', type: 'number' } })
  change({ kind: 'addProperty', property: { id: 'due', name: 'Due', type: 'date' } })
  change({ kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } })
  change({ kind: 'addProperty', property: { id: 'att', name: 'Att', type: 'files' } })
  const add = (pageId: string, values: Record<string, unknown>) => h.run({ type: 'add-row', databaseId: 'list', pageId, title: pageId, values: values as never, at })
  add('dune', { kind: 'novel', tags: ['sf'], pages: 400, due: { start: '2026-01-15' } })
  add('emma', { kind: 'novel', tags: ['hist', 'sf'], pages: 300, due: { start: '2026-03-02' } })
  add('ubik', { kind: 'essay', pages: 100, due: { start: '2026-03-20' } })
  add('blank', {})
  const db = () => h.page('list').database as Database
  return Object.assign(h, { change, db })
}
const view = (fields: Partial<View> = {}): View => ({ id: 'v', name: 'C', layout: 'chart', columns: [], sort: [], filter: [], groupBy: 'kind', chart: { form: 'bar' }, ...fields })
const of = (h: ReturnType<typeof shelf>, v: View, weekStart: 0 | 1 = 0): ChartPoint[] => { const d = chartData(h.db(), v, viewRows(h.ws, 'list', v, ctx), weekStart); assert.ok(d && d !== 'choose'); return d.points }
const pairs = (p: ChartPoint[]) => p.map(x => [x.name, x.value])

test('count by a select: every option, and rows with none, in its own order', () => {
  assert.deepEqual(pairs(of(shelf(), view())), [['Novel', 2], ['Essay', 1], ['Poem', 0], ['No value', 1]])
})
test('a measure matches a column calculation on the same rows, and a blank is not a zero', () => {
  const h = shelf(), v = view({ chart: { form: 'bar', measure: { by: 'pages', kind: 'sum' } } }), points = of(h, v)
  assert.deepEqual(pairs(points), [['Novel', 700], ['Essay', 100], ['Poem', null], ['No value', null]])
  for (const p of points.filter(x => x.value !== null)) assert.equal(p.value, (columnCalc(h.db(), p.rows, 'pages', 'sum') as { value: number }).value)
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'bar', measure: { by: 'pages', kind: 'average' } } }))), [['Novel', 350], ['Essay', 100], ['Poem', null], ['No value', null]])
  for (const [kind, want] of [['median', 350], ['min', 300], ['max', 400], ['range', 100]] as const) assert.equal(of(h, view({ chart: { form: 'bar', measure: { by: 'pages', kind } } }))[0]!.value, want)
})
test('the view\'s filter applies, groups included', () => {
  const novels = { by: 'kind', op: 'isAnyOf', value: ['novel'] } as const
  assert.deepEqual(pairs(of(shelf(), view({ filter: [novels], filterGroups: [{ rules: [{ by: 'pages', op: 'gt', value: 350 }] }], hideEmptyGroups: true }))), [['Novel', 1]])
})
test('a multi-select counts a row under each value, as Group does', () => {
  assert.deepEqual(pairs(of(shelf(), view({ groupBy: 'tags', hideEmptyGroups: true }))), [['SF', 2], ['History', 1], ['No value', 2]])
})
test('a date axis fills empty periods, by month, week, day and year, and rows with no date come last', () => {
  const h = shelf(), byMonth = view({ groupBy: 'due' })
  assert.deepEqual(pairs(of(h, byMonth)), [['January 2026', 1], ['February 2026', 0], ['March 2026', 2], ['No value', 1]])
  assert.deepEqual(pairs(of(h, view({ groupBy: 'due', chart: { form: 'bar', byYear: true } }))), [['2026', 3], ['No value', 1]])
  const weeks = of(h, view({ groupBy: 'due', groupDateBy: 'week', filter: [{ by: 'due', op: 'onOrAfter', value: { date: '2026-03-01' } }] }))
  assert.deepEqual(pairs(weeks), [['Week of Mar 1, 2026', 1], ['Week of Mar 8, 2026', 0], ['Week of Mar 15, 2026', 1]])
  // Week starts moves the weeks (R3-20).
  assert.equal(of(h, view({ groupBy: 'due', groupDateBy: 'week', filter: [{ by: 'due', op: 'onOrAfter', value: { date: '2026-03-01' } }] }), 1)[0]!.name, 'Week of Mar 2, 2026')
  assert.deepEqual(of(h, byMonth).map(p => p.short), ['Jan 2026', 'Feb 2026', 'Mar 2026', 'No value'])
  assert.equal(of(h, view({ groupBy: 'due', groupDateBy: 'week', filter: [{ by: 'due', op: 'onOrAfter', value: { date: '2026-03-01' } }] }))[0]!.short, 'Mar 1')
  // A view that hides empty groups has asked not to.
  assert.deepEqual(pairs(of(h, view({ groupBy: 'due', hideEmptyGroups: true }))).map(x => x[1]), [1, 2, 1])
})
test('sorting by value, and cumulative along the axis, with no cumulative when sorted', () => {
  const h = shelf()
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'bar', sortByValue: true } }))).map(x => x[0]), ['Novel', 'Essay', 'No value', 'Poem'])
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'bar', cumulative: true } }))).map(x => x[1]), [2, 3, 3, 4])
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'bar', sortByValue: true, cumulative: true } }))).map(x => x[1]), [2, 1, 1, 0])
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'bar', cumulative: true, measure: { by: 'pages', kind: 'sum' } } }))).map(x => x[1]), [700, 800, 800, 800])
})
test('a property gone asks again, and Undo or changing back restores it', () => {
  const h = shelf(), rows = () => viewRows(h.ws, 'list', view(), ctx)
  assert.equal(chartData(h.db(), view({ groupBy: 'gone' }), rows()), 'choose')
  assert.equal(chartData(h.db(), view({ chart: { form: 'bar', measure: { by: 'note', kind: 'sum' } } }), rows()), 'choose')
  assert.equal(chartMeasure(h.db(), view({ chart: { form: 'bar', measure: { by: 'gone', kind: 'sum' } } })), 'gone')
  assert.equal(chartData(h.db(), view({ chart: { form: 'number' } }), rows()), null)
  assert.deepEqual(chartValue(h.db(), rows(), null), { type: 'count', value: 4 })
})
test('what can be charted: not text, files, ID or a rollup', () => {
  const names = groupableProperties(shelf().db(), 'chart').map(p => p.id)
  for (const id of ['kind', 'tags', 'pages', 'due']) assert.ok(names.includes(id), id)
  for (const id of ['note', 'att']) assert.ok(!names.includes(id), id)
})
test('past the limit it says so, and doesn\'t try to draw', () => {
  const h = shelf()
  h.change({ kind: 'updateView', viewId: h.db().views[0]!.id, name: 'Keep' })
  const days = view({ groupBy: 'due', groupDateBy: 'day' }), d = chartData(h.db(), days, viewRows(h.ws, 'list', days, ctx))
  assert.ok(d && d !== 'choose'); assert.equal(d.tooMany, false)
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'far', title: 'far', values: { due: { start: '2030-01-01' } } as never, at })
  const far = chartData(h.db(), days, viewRows(h.ws, 'list', days, ctx)); assert.ok(far && far !== 'choose'); assert.equal(far.tooMany, true)
})
test('stored on the view through the command, kept by other edits, and refused where it can\'t be', () => {
  const h = shelf(), v = () => h.db().views[0]!
  h.change({ kind: 'updateView', viewId: v().id, layout: 'chart', groupBy: 'kind', chart: { form: 'barHorizontal', measure: { by: 'pages', kind: 'sum' }, sortByValue: true } })
  assert.deepEqual(v().chart, { form: 'barHorizontal', measure: { by: 'pages', kind: 'sum' }, sortByValue: true })
  h.change({ kind: 'updateView', viewId: v().id, name: 'Renamed' }); h.change({ kind: 'updateView', viewId: v().id, layout: 'table' })
  assert.equal(v().chart?.form, 'barHorizontal')
  assert.throws(() => h.change({ kind: 'updateView', viewId: v().id, chart: { form: 'bar', measure: { by: 'note', kind: 'sum' } } }), /Can't chart that/)
  assert.throws(() => h.change({ kind: 'updateView', viewId: v().id, layout: 'chart', groupBy: 'note' }), /Can't group by that/)
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: 'v', layout: 'chart', chart: { form: 'number' } } } }).success)
  assert.ok(!commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: 'v', chart: { form: 'pie' } } } }).success)
})
test('ticks are round, hold zero and every value', () => {
  assert.deepEqual(chartTicks([]), [0, 1])
  assert.deepEqual(chartTicks([2, 1]), [0, 1, 2])
  assert.deepEqual(chartTicks([712]), [0, 500, 1000])
  for (const values of [[3], [0.4], [-5, 12], [1234567], [99, 100]]) { const t = chartTicks(values); assert.ok(t.includes(0)); assert.ok(t[0]! <= Math.min(...values)); assert.ok(t.at(-1)! >= Math.max(...values)) }
})
