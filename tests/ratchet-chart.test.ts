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


test('independent: Year uses the row date, not the week-start year',()=>{
 const h=shelf();h.run({type:'add-row',databaseId:'list',pageId:'jan',title:'Jan',values:{due:{start:'2027-01-01'}},at});
 const points=of(h,view({groupBy:'due',groupDateBy:'week',filter:[{by:'due',op:'is',value:{date:'2027-01-01'}}],chart:{form:'bar',byYear:true}}));
 console.log('YEAR',pairs(points));assert.deepEqual(pairs(points),[['2027',1]]);
});
test('independent: hiding a middle date group does not recreate it as zero',()=>{
 const h=shelf();h.run({type:'add-row',databaseId:'list',pageId:'apr',title:'Apr',values:{due:{start:'2026-04-01'}},at});
 const points=of(h,view({groupBy:'due',hiddenGroups:['2026-03']}));console.log('HIDDEN',pairs(points));assert.ok(!points.some(p=>p.key==='2026-03'));
});
test('independent: data beyond the drawing cap stays available',()=>{
 const h=shelf();h.run({type:'add-row',databaseId:'list',pageId:'far',title:'Far',values:{due:{start:'2030-01-01'}},at});
 const points=of(h,view({groupBy:'due',groupDateBy:'day'}));console.log('DATA_CAP',{points:points.length,farPresent:points.some(p=>p.rows.some(r=>r.id==='far'))});assert.ok(points.some(p=>p.rows.some(r=>r.id==='far')));
});
