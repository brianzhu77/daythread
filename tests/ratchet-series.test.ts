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


const data=(h:ReturnType<typeof shelf>,v:View)=>{const d=chartData(h.db(),v,viewRows(h.ws,'list',v,ctx));assert.ok(d&&d!=='choose');return d};
test('independent: grouped Sum line keeps blank month as gap, not a made-up zero',()=>{
 const h=shelf(),v=view({groupBy:'due',subGroupBy:'kind',chart:{form:'line',measure:{by:'pages',kind:'sum'}}});const d=data(h,v);const feb=d.points.find(p=>p.key==='2026-02')!;console.log('BLANK_SUM',{value:feb.value,parts:feb.parts});assert.equal(feb.value,null);assert.ok(feb.parts?.every(p=>p.value===null));
});
test('independent: Count gaps are zero and multi-select membership is counted per group',()=>{
 const h=shelf();const month=data(h,view({groupBy:'due',subGroupBy:'kind',chart:{form:'line'}}));assert.ok(month.points.find(p=>p.key==='2026-02')!.parts!.every(p=>p.value===0));
 const d=data(h,view({groupBy:'kind',subGroupBy:'tags',chart:{form:'bar'}}));const novel=d.points.find(p=>p.key==='novel')!;console.log('MULTI',{total:novel.value,parts:novel.parts});assert.equal(novel.value,2);assert.equal(novel.parts!.reduce((n,p)=>n+p.value,0),3);
});
test('independent: grouped single-select parts sum to every point, including unassigned rows',()=>{
 const h=shelf();for(const measure of [undefined,{by:'pages',kind:'sum' as const}]){const d=data(h,view({groupBy:'due',subGroupBy:'kind',chart:{form:'bar',...(measure?{measure}:{})}}));for(const p of d.points)assert.equal(p.parts!.reduce((n,x)=>n+x.value,0),p.value??0);}
});
