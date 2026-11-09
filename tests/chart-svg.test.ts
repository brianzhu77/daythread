// Chart Export's picture (chart.md §5, G4-8): every form draws from the data, on a solid paper in the theme's colours, with names escaped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartData, chartSettings, type ChartForm } from '../src/domain/chart.ts'
import { chartSvg, pictureName, type ChartPalette } from '../src/domain/chart-svg.ts'
import { viewRows, type View } from '../src/domain/database.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z', context = { today: '2026-11-05', pageDate: null, weekStart: 0 as const }
const dark: ChartPalette = { paper: '#191919', ink: '#ececec', muted: '#b4b4b4', line: '#3a3a3a', greys: ['#ececec', '#b4b4b4', '#7b7b7b', '#5a5a5a'] }
function setup() {
  const h = harness()
  const C = (change: unknown) => h.run({ type: 'change-database', pageId: 'runs', change } as never)
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  C({ kind: 'addProperty', property: { id: 'st', name: 'Stage', type: 'select', options: [{ id: 'a', name: 'A & <B>', color: 'gray' }, { id: 'b', name: 'B', color: 'gray' }] } })
  C({ kind: 'addProperty', property: { id: 'tg', name: 'Tags', type: 'multiSelect', options: [{ id: 'x', name: 'X', color: 'gray' }, { id: 'y', name: 'Y', color: 'gray' }] } })
  for (const [id, values] of [['r1', { st: 'a', tg: ['x'] }], ['r2', { st: 'b', tg: ['x', 'y'] }], ['r3', { st: 'a' }]] as const) h.run({ type: 'add-row', databaseId: 'runs', pageId: id, title: id, values, at } as never)
  return h
}
const chart = (form: ChartForm, extra: Partial<View> = {}): View => ({ id: 'c', name: 'Chart', layout: 'chart', columns: [], sort: [], filter: [], groupBy: 'st', chart: { form }, ...extra } as View)
const picture = (view: View, palette?: ChartPalette) => {
  const h = setup(), db = h.page('runs').database!, data = chartData(db, view, viewRows(h.ws, 'runs', view, context))
  assert.ok(data && data !== 'choose')
  return { svg: chartSvg({ title: 'Runs · Chart', measureName: 'Count', settings: chartSettings(view), data, valueText: p => String(p.value ?? ''), ...(palette ? { palette } : {}) }), data }
}

for (const form of ['bar', 'barHorizontal', 'line', 'donut'] as const) {
  test(`${form}: a whole SVG with escaped names and no stray markup`, () => {
    const { svg } = picture(chart(form))
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>.*<\/svg>$/s)
    assert.ok(svg.includes('A &amp; &lt;B&gt;'))
    assert.ok(!svg.includes('<B>'))
    assert.ok(!/NaN|undefined/.test(svg))
  })
}

test('the paper is solid and in the theme it was exported from', () => {
  const { svg } = picture(chart('bar'), dark)
  assert.match(svg, /<rect width="720" height="420" fill="#191919"\/>/)
  assert.ok(svg.includes('fill="#ececec"'))
  assert.ok(!svg.includes('#ffffff'))
})

test('a bar is drawn for each value', () => {
  const { svg, data } = picture(chart('bar'))
  const bars = svg.match(/<rect x=/g)?.length ?? 0
  assert.equal(bars, data.points.filter(p => p.value).length)
})

test('series are drawn as parts, with a legend', () => {
  const { svg, data } = picture(chart('bar', { subGroupBy: 'tg' } as Partial<View>))
  if (!data.series || data.series.length < 2) return assert.fail('expected series')
  for (const sr of data.series) assert.ok(svg.includes(`>${sr.name}</text>`), sr.name)
})

test('a number is the number and what it measures', () => {
  const svg = chartSvg({ title: 'Runs', measureName: 'Count', settings: chartSettings(chart('number')), data: null, number: '3', valueText: () => '' })
  assert.ok(svg.includes('>3</text>') && svg.includes('>Count</text>'))
})

test("a picture's name leaves out the view's default name, and keeps one he gave it (Jazz 60439831)", () => {
  assert.equal(pictureName('Reading list', 'Chart', ' - '), 'Reading list')
  assert.equal(pictureName('Reading list', 'By month', ' · '), 'Reading list · By month')
  assert.equal(pictureName('  ', 'Chart', ' - '), 'Untitled')
})
