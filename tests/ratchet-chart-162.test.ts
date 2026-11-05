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


test('independent: donut conserves positive totals, names largest, and keeps negative values explicit',()=>{
 const shared={id:'shared'} as any;
 const points=[1,9,0,null,-40,3,12,2].map((value,order)=>({key:`p${order}`,name:`P${order}`,rows:order===0||order===7?[shared]:[{id:`r${order}`} as any],value,order,result:{type:'number',value}} as ChartPoint));
 const before=JSON.stringify(points);const d=donutSlices(points);
 assert.equal(d.total,27);assert.deepEqual(d.undrawn.map(p=>p.value),[-40]);
 assert.deepEqual(d.slices.filter(s=>s.grey!==null).map(s=>s.value),[9,3,12,2]);
 assert.deepEqual(d.slices.filter(s=>s.grey!==null).map(s=>s.grey),[0,1,2,3]);
 assert.equal(d.slices.reduce((n,s)=>n+s.value,0),27);assert.ok(Math.abs(d.slices.reduce((n,s)=>n+s.share,0)-1)<1e-12);
 assert.equal(JSON.stringify(points),before);
 const sorted=donutSlices([...points].reverse());assert.deepEqual(sorted.slices.filter(s=>s.grey!==null).map(s=>[s.key,s.grey]).sort(),d.slices.filter(s=>s.grey!==null).map(s=>[s.key,s.grey]).sort());
});
test('independent: Other preserves multi-group membership with deduplicated rows',()=>{
 const p=(key:string,value:number,rows:any[],order:number)=>({key,name:key,value,rows,order,result:{type:'number',value}} as ChartPoint);
 const d=donutSlices([p('a',10,[],0),p('b',9,[],1),p('c',8,[],2),p('d',7,[],3),p('e',2,[{id:'x'}],4),p('f',1,[{id:'x'},{id:'y'}],5)]);
 const other=d.slices.find(s=>s.key===otherKey)!;assert.equal(other.value,3);assert.deepEqual(other.rows.map(r=>r.id),['x','y']);assert.equal(other.from!.get('x'),'e, f');assert.equal(other.grey,null);
 assert.deepEqual(donutSlices([p('zero',0,[],0),p('none',null as any,[],1)]).slices,[]);
});
test('independent: Donut ignores stored cumulative and keeps blanks, negatives and No value separate',()=>{
 const h=shelf();const v=view({chart:{form:'donut',cumulative:true,measure:{by:'pages',kind:'sum'}}});
 const a=of(h,v),b=of(h,view({...v,chart:{...v.chart!,cumulative:undefined}}));assert.deepEqual(pairs(a),pairs(b));assert.deepEqual(a.map(p=>p.value),[700,100,null,null]);
 const sum=of(h,view({groupBy:'due',chart:{form:'line',cumulative:true,measure:{by:'pages',kind:'sum'}}}));assert.deepEqual(sum.map(p=>p.value),[400,400,800,null]);
 const count=of(h,view({groupBy:'due',chart:{form:'line',cumulative:true}}));assert.deepEqual(count.map(p=>p.value),[1,1,3,1]);
});
