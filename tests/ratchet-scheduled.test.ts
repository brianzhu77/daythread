// Automations (docs/design/automations.md, G3-13 to G3-17): rules run inside the command that set them off, each on its own copy, with one Undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSteps, stepsKey, writeSteps, type ButtonStep } from '../src/domain/buttons.ts'
import { automationProblem, withLiveNames, type Automation } from '../src/domain/automations.ts'
import { pageContentKey } from '../src/domain/editor-document.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z', today = '2026-11-05'
const setN = (raw: number, id = 'n', name = 'N'): ButtonStep => ({ id: `s-${id}`, kind: 'edit-property', set: [{ id, name, type: id === 'n' ? 'number' : 'text', value: { kind: 'fixed', raw } }] } as ButtonStep)
const rule = (over: Partial<Automation> = {}): Automation => ({ id: 'r', name: 'Log finish', active: true, triggers: [{ kind: 'property-edited', propertyId: 'st', name: 'Status', condition: { by: 'st', op: 'isAnyOf', value: ['done'] } }], steps: writeSteps([setN(5)]), ...over })
function setup(rules: Automation[] = []) {
  const h = harness()
  const C = (change: unknown, pageId = 'runs') => h.run({ type: 'change-database', pageId, change } as never)
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  C({ kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } })
  C({ kind: 'addProperty', property: { id: 'st', name: 'Status', type: 'select', options: [{ id: 'todo', name: 'Todo', color: 'gray' }, { id: 'done', name: 'Done', color: 'gray' }] } })
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { n: 1, st: 'todo' }, at } as never)
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r2', title: 'Two', values: { n: 2, st: 'todo' }, at } as never)
  for (const r of rules) C({ kind: 'addAutomation', automation: r })
  return { h, C }
}
const edit = (h: ReturnType<typeof harness>, id: string, values: object, expected: object) => h.run({ type: 'set-values', pageId: id, values, expected, at } as never)
const val = (h: ReturnType<typeof harness>, id: string, key = 'n') => h.page(id).values?.[key]
const rules = (h: ReturnType<typeof harness>) => h.page('runs').database!.automations ?? []


const every = (over: object = {}, repeat: object = {}): Automation => rule({ id: 'wk', name: 'Weekly review', triggers: [{ kind: 'every', repeat: { every: 'week', interval: 1, start: '2026-11-02', notBefore: '2026-11-02T00:00', ...repeat } as never }], steps: writeSteps([{ id: 'a', kind: 'add-row', databaseId: 'runs', databaseName: 'Runs', title: 'Review', set: [] }]), ...over })
const tick = (h: ReturnType<typeof harness>, today: string, time = '09:00', op?: string) => h.run({ type: 'run-repeats', today, time, at: `${today}T${time}:00.000Z` }, op)
const reviews = (h: ReturnType<typeof harness>) => h.ws.pages.filter(p => p.title === 'Review' && !p.trashedAt)
test('independent: changing a scheduled time preserves once-per-date behavior',()=>{
 const {h,C}=setup([every({}, {every:'day',time:'09:00'})]);
 tick(h,'2026-11-05','09:00');assert.equal(reviews(h).length,1);
 const r=structuredClone(rules(h)[0]!); const t=r.triggers[0] as any;t.repeat.time='10:00';
 C({kind:'updateAutomation',automation:r});
 tick(h,'2026-11-05','10:00');console.log('TIME_EDIT',{count:reviews(h).length,rule:rules(h)[0]});assert.equal(reviews(h).length,1);
});
test('independent: a scheduled partial write is discarded on a later invalid value',()=>{
 const steps:ButtonStep[]=[{id:'a',kind:'add-row',databaseId:'runs',databaseName:'Runs',title:'Review',set:[]},{id:'b',kind:'edit-rows',filter:[],databaseId:'runs',databaseName:'Runs',set:[{id:'n',name:'N',type:'number',value:{kind:'fixed',raw:'not-a-number'}}]}] as any;
 const {h}=setup([every({steps:writeSteps(steps)})]);const result=tick(h,'2026-11-05');console.log('FAILED_COPY',result.receipt.automations);
 assert.equal(reviews(h).length,0);assert.equal(val(h,'r1'),1);assert.ok(rules(h)[0]!.paused);assert.equal((rules(h)[0]!.triggers[0] as any).repeat.last,undefined);
});

test('independent: fixing a failed rule recovers only its latest missed period once',()=>{
 const broken:ButtonStep[]=[{id:'a',kind:'add-row',databaseId:'runs',databaseName:'Runs',title:'Review',set:[{id:'n',name:'N',type:'number',value:{kind:'fixed',raw:'invalid'}}]}] as any;
 const {h,C}=setup([every({steps:writeSteps(broken)}, {every:'day',time:'09:00'})]);
 tick(h,'2026-11-05','10:00');assert.ok(rules(h)[0]!.paused);
 const fixed=structuredClone(rules(h)[0]!);fixed.steps=writeSteps([{id:'a',kind:'add-row',databaseId:'runs',databaseName:'Runs',title:'Review',set:[]}]);(fixed.triggers[0] as any).repeat.notBefore='2026-11-06T12:00';
 C({kind:'updateAutomation',automation:fixed});assert.equal(rules(h)[0]!.active,true);
 tick(h,'2026-11-06','12:05');console.log('FIX_RESUME',{count:reviews(h).length,trigger:rules(h)[0]!.triggers[0]});assert.equal(reviews(h).length,1);tick(h,'2026-11-06','12:10');assert.equal(reviews(h).length,1);
});

test('independent: explicit off/on and actual schedule edits suppress old missed times',()=>{
 for(const how of ['off-on','schedule']) {
 const broken:ButtonStep[]=[{id:'a',kind:'add-row',databaseId:'runs',databaseName:'Runs',title:'Review',set:[{id:'n',name:'N',type:'number',value:{kind:'fixed',raw:'invalid'}}]}] as any;
 const {h,C}=setup([every({steps:writeSteps(broken)}, {every:'day',time:'09:00'})]);tick(h,'2026-11-05','10:00');assert.ok(rules(h)[0]!.paused);
 if(how==='off-on') C({kind:'setAutomationActive',automationId:'wk',active:false});
 const fixed=structuredClone(rules(h)[0]!);fixed.steps=writeSteps([{id:'a',kind:'add-row',databaseId:'runs',databaseName:'Runs',title:'Review',set:[]}]);(fixed.triggers[0] as any).repeat.notBefore='2026-11-06T12:00';if(how==='schedule')(fixed.triggers[0] as any).repeat.time='09:15';
 C({kind:'updateAutomation',automation:fixed});if(how==='off-on'){assert.equal(rules(h)[0]!.active,false);C({kind:'setAutomationActive',automationId:'wk',active:true,notBefore:'2026-11-06T12:00'});}
 tick(h,'2026-11-06','11:00');assert.equal(reviews(h).length,0,how+' stale tick');tick(h,'2026-11-06','12:05');assert.equal(reviews(h).length,0,how+' no catch-up');tick(h,'2026-11-07','12:05');assert.equal(reviews(h).length,1,how+' next date');
 }
});
