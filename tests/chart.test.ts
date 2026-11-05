// Chart (docs/design/chart.md): its numbers are the view's own rows and groups, so they match a table and a column calculation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { axisLabels, axisStep, chartData, chartMeasure, chartTicks, chartValue, donutSlices, otherKey, shortNumber, type ChartPoint } from '../src/domain/chart.ts'
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
  // No value only where a row has none.
  assert.deepEqual(pairs(of(shelf(), view({ filter: [{ by: 'kind', op: 'isNotEmpty' }] }))), [['Novel', 2], ['Essay', 1], ['Poem', 0]])
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
  // A view that hides empty groups has asked not to.
  assert.deepEqual(pairs(of(h, view({ groupBy: 'due', hideEmptyGroups: true }))).map(x => x[1]), [1, 2, 1])
})
test('sorting by value, and cumulative along the axis, with no cumulative when sorted', () => {
  const h = shelf()
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'bar', sortByValue: true } }))).map(x => x[0]), ['Novel', 'Essay', 'No value', 'Poem'])
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'bar', cumulative: true } }))).map(x => x[1]), [2, 3, 3, 1])
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'bar', sortByValue: true, cumulative: true } }))).map(x => x[1]), [2, 1, 1, 0])
  // No value keeps its own number, out of the running total (Roadbuster).
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'bar', cumulative: true, measure: { by: 'pages', kind: 'sum' } } }))).map(x => x[1]), [700, 800, 800, null])
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
test('Ratchet: by year goes through months, whatever the axis was; a hidden group stays hidden; past the limit the data keeps every real value', () => {
  const h = shelf()
  // Jan 1, 2027 is in a week that starts in 2026.
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'newyear', title: 'newyear', values: { due: { start: '2027-01-01' } } as never, at })
  assert.deepEqual(pairs(of(h, view({ groupBy: 'due', groupDateBy: 'week', chart: { form: 'bar', byYear: true } }))), [['2026', 3], ['2027', 1], ['No value', 1]])
  assert.deepEqual(pairs(of(h, view({ groupBy: 'due', hiddenGroups: ['2026-02'], filter: [{ by: 'due', op: 'before', value: { date: '2026-12-01' } }] }))).map(x => x[0]), ['January 2026', 'March 2026'])
  // By year, a month hidden in a month view doesn't take from the year, and hiding empty groups drops an empty year (Roadbuster).
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'later', title: 'later', values: { due: { start: '2029-06-01' } } as never, at })
  assert.deepEqual(pairs(of(h, view({ groupBy: 'due', hiddenGroups: ['2026-01'], chart: { form: 'bar', byYear: true }, filter: [{ by: 'due', op: 'isNotEmpty' }] }))), [['2026', 3], ['2027', 1], ['2028', 0], ['2029', 1]])
  assert.deepEqual(pairs(of(h, view({ groupBy: 'due', hideEmptyGroups: true, chart: { form: 'bar', byYear: true }, filter: [{ by: 'due', op: 'isNotEmpty' }] }))).map(x => x[0]), ['2026', '2027', '2029'])
  const days = view({ groupBy: 'due', groupDateBy: 'day' }), d = chartData(h.db(), days, viewRows(h.ws, 'list', days, ctx))
  assert.ok(d && d !== 'choose'); assert.equal(d.tooMany, true)
  assert.deepEqual(d.points.filter(p => p.value).map(p => p.key), ['2026-01-15', '2026-03-02', '2026-03-20', '2027-01-01', '2029-06-01', 'none'])
})
test('an axis gives a year on the first label and where it changes, and thins so every label has room', () => {
  const months = ['2025-11', '2025-12', '2026-01', '2026-02'].map(key => ({ key, name: key }))
  assert.deepEqual(axisLabels(months, 1, true).map(l => l.label), ['Nov 2025', 'Dec', 'Jan 2026', 'Feb'])
  assert.deepEqual(axisLabels(months, 2, true).map(l => l.label), ['Nov 2025', 'Jan 2026'])
  assert.deepEqual(axisLabels([{ key: '2025-12-29', name: 'x' }, { key: '2026-01-05', name: 'y' }, { key: '2026-01-12', name: 'z' }], 1, true).map(l => l.label), ['Dec 29, 2025', 'Jan 5, 2026', 'Jan 12'])
  assert.deepEqual(axisLabels([{ key: 'none', name: 'No value' }, { key: 'novel', name: 'Novel' }], 1, false).map(l => l.label), ['No value', 'Novel'])
  assert.equal(axisStep(months, 100, true), 1)
  // The last has what's left after the one before: 'No value' on one bar, with a short label beside it, needs no thinning past that.
  const days = Array.from({ length: 9 }, (_, i) => ({ key: `2026-03-0${i + 1}`, name: 'x' }))
  assert.equal(axisLabels(days, axisStep(days, 30, true), true).length > 1, true)
  assert.ok(axisStep(months, 20, true) > 1)
  assert.equal(axisStep(months, 0, true), 1)
  // Jazz: a Chinese name takes about twice a Latin one's room, so it thins or goes across where the same length wouldn't.
  const named = (name: string) => Array.from({ length: 12 }, (_, i) => ({ key: `o${i}`, name: `${name}${i}` }))
  assert.equal(axisStep(named('abcde'), 60, false), 1)
  assert.ok(axisStep(named('中文选项名'), 60, false) > 1)
})
test('a calculation keeps a large number exact, and still cleans a float', () => {
  const h = shelf()
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'big', title: 'big', values: { pages: 987654321 } as never, at })
  const big = viewRows(h.ws, 'list', view({ filter: [{ by: 'pages', op: 'gt', value: 900000000 }] }), ctx)
  assert.deepEqual(columnCalc(h.db(), big, 'pages', 'sum'), { type: 'number', value: 987654321 })
  h.run({ type: 'set-values', pageId: 'big', values: { pages: 123456789.125 } as never, expected: {}, at } as never)
  assert.equal((columnCalc(h.db(), [h.page('big')], 'pages', 'sum') as { value: number }).value, 123456789.125)
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'p1', title: 'p1', values: { pages: 0.1 } as never, at }); h.run({ type: 'add-row', databaseId: 'list', pageId: 'p2', title: 'p2', values: { pages: 0.2 } as never, at })
  assert.equal((columnCalc(h.db(), [h.page('p1'), h.page('p2')], 'pages', 'sum') as { value: number }).value, 0.3)
})
test('a donut: the four largest are named, with greys in axis order among them, a blank or a zero is no slice, a loss is said, and the rest fold into Other', () => {
  const p = (key: string, value: number | null, order: number) => ({ key, name: key, rows: [{ id: `r-${key}` }] as never[], value, order, result: { type: 'count' as const, value: value ?? 0 } })
  const { slices, total } = donutSlices([p('a', 3, 0), p('b', 0, 1), p('c', null, 2), p('d', 1, 3)])
  assert.equal(total, 4); assert.deepEqual(slices.map(s => [s.key, s.share, s.grey]), [['a', 0.75, 0], ['d', 0.25, 1]])
  // The biggest has a name, wherever it comes along the axis.
  const eight = donutSlices([1, 1, 1, 1, 1, 1, 1, 12].map((v, i) => p(`v${i}`, v, i)))
  assert.ok(eight.slices.some(s => s.key === 'v7' && s.grey === 3)); assert.equal(eight.slices.at(-1)!.key, otherKey); assert.equal(eight.slices.at(-1)!.value, 4); assert.equal(eight.slices.at(-1)!.name, 'Other (4)')
  assert.equal(eight.slices.at(-1)!.from!.get('r-v4'), 'v4')
  // Sorted by value, the greys don't move.
  assert.deepEqual(donutSlices([p('z', 9, 2), p('y', 1, 0), p('x', 2, 1)]).slices.map(s => [s.key, s.grey]), [['z', 2], ['y', 0], ['x', 1]])
  // A loss can't be a slice: it's listed, for the legend to say.
  const loss = donutSlices([p('gain', 100, 0), p('loss', -40, 1)]); assert.deepEqual(loss.undrawn.map(u => u.key), ['loss']); assert.equal(loss.slices.length, 1)
  assert.deepEqual(donutSlices([p('a', 0, 0)]).slices, [])
  // Cumulative means nothing on a donut, so it's left out of its values.
  const h = shelf(), v = view({ chart: { form: 'donut', cumulative: true } })
  assert.deepEqual(pairs(of(h, v)).map(x => x[1]), [2, 1, 0, 1])
})
test('a line has its points in order, with a blank left as a blank', () => {
  const h = shelf()
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'line', measure: { by: 'pages', kind: 'sum' } } }))).map(x => x[1]), [700, 100, null, null])
  assert.deepEqual(pairs(of(h, view({ chart: { form: 'line', cumulative: true } }))).map(x => x[1]), [2, 3, 3, 1])
})
test('a short number for tight places', () => {
  assert.equal(shortNumber(1000000000), '1B'); assert.equal(shortNumber(1234567), '1.2M'); assert.equal(shortNumber(9999), '9,999'); assert.equal(shortNumber(0.5), '0.5'); assert.equal(shortNumber(-25000), '-25K')
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
  assert.equal(new Set(chartTicks([1e-10])).size, chartTicks([1e-10]).length)
  for (const values of [[3], [0.4], [-5, 12], [1234567], [99, 100]]) { const t = chartTicks(values); assert.ok(t.includes(0)); assert.ok(t[0]! <= Math.min(...values)); assert.ok(t.at(-1)! >= Math.max(...values)) }
})
