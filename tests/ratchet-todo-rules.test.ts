// To-dos as an automation's source (automations.md §7, G3-20): its rules kept on the workspace, set off by a tick or a to-do's first words, with one Undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeSteps, type ButtonStep } from '../src/domain/buttons.ts'
import type { Automation } from '../src/domain/automations.ts'
import { todosSourceId } from '../src/domain/database.ts'
import { changesBetween, applyChanges } from '../src/domain/workspace-changes.ts'
import { applyDiff, planWrites, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'
import { harness, today, todo, dayId } from './v2-helpers.ts'

const log: ButtonStep = { id: 's-log', kind: 'add-row', databaseId: 'log', databaseName: 'Log', title: '', titleFormula: '"Done: " + prop("title")', set: [] }
const rule = (over: Partial<Automation> = {}): Automation => ({ id: 'r', name: 'Log it', active: true, triggers: [{ kind: 'property-edited', propertyId: 'status', name: 'Status', condition: { by: 'status', op: 'isAnyOf', value: ['done'] } } as never], steps: writeSteps([log]), ...over })
function setup(rules: Automation[] = [rule()]) {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'log', homeBlockId: null, title: 'Log' })
  h.day(today)
  h.save(dayId(today), () => [todo('l-a', 'Alpha'), todo('l-b', 'Bravo')])
  for (const r of rules) h.run({ type: 'change-database', pageId: todosSourceId, change: { kind: 'addAutomation', automation: r } } as never)
  return h
}
const logged = (h: ReturnType<typeof harness>) => h.ws.pages.filter(p => p.parentId === 'log' && !p.trashedAt).map(p => p.title)
const tick = (h: ReturnType<typeof harness>, title: string, status: 'done' | 'open' = 'done') => h.run({ type: 'task-status', taskId: h.task(title).id, status, today })

test('independent: clearing and retyping an existing task does not add it again',()=>{
 const h=setup([rule({id:'new',triggers:[{kind:'row-added'}],steps:writeSteps([{...log,titleFormula:'"New: " + prop("title")'}])})]);
 h.save(dayId(today),doc=>[...doc,todo('fresh','First')]);
 const id=h.task('First').id;assert.equal(logged(h).length,1);
 h.save(dayId(today),doc=>doc.map(n=>n.id==='fresh'?{...n,content:[]}:n));
 assert.ok(h.ws.tasks.some(t=>t.id===id),'task identity still exists while blank');
 h.save(dayId(today),doc=>doc.map(n=>n.id==='fresh'?{...n,content:[{type:'text',text:'Second',styles:{}}]}:n));
 assert.equal(h.task('Second').id,id);assert.equal(logged(h).length,1,'first saved words fires once per canonical task');
});
test('independent: returned and genuinely new tasks in one save distinguish identities',()=>{
 const h=setup([rule({id:'new',triggers:[{kind:'row-added'}],steps:writeSteps([{...log,titleFormula:'"New: " + prop("title")'}])})]);
 const a=h.task('Alpha').id;h.save(dayId(today),doc=>doc.filter(n=>n.id!=='l-a'));
 h.save(dayId(today),doc=>[...doc,{...todo('back','Alpha','reference'),props:{taskId:a,role:'reference',planDate:''}},todo('new','New one')]);
 assert.deepEqual(logged(h),['New: New one']);assert.equal(h.task('Alpha').id,a);
});
test('independent: copy, planning, Trash restore, Undo and template creation do not add a task again',()=>{
 const h=setup([rule({id:'new',triggers:[{kind:'row-added'}]})]);const a=h.task('Alpha').id;
 h.run({type:'create-document',pageId:'copy',title:'Copy',body:''});
 h.save('copy',()=>[{...todo('copy-a','Alpha','reference'),props:{taskId:a,role:'reference',planDate:''}}]);
 h.run({type:'plan-task',taskId:a,date:'2026-10-23',from:today,today});
 h.run({type:'delete-page',pageId:'copy',at:'2026-11-06T00:00:00Z'});h.run({type:'restore-page',pageId:'copy'});
 const ticked=tick(h,'Alpha');h.run({type:'undo',targetOperationId:ticked.receipt.operationId});
 h.run({type:'create-template',title:'Day',pageId:'tpl',dayPage:true});h.save('tpl',()=>[todo('template-task','Template words')]);h.day('2026-10-24');
 assert.deepEqual(logged(h),[]);
});
test('independent: an existing version-one blank box can still fire on first words',()=>{
 const h=setup([rule({id:'new',triggers:[{kind:'row-added'}]})]);
 // An older stored blank box, before any words or edit; current editor normally creates the task with its first words.
 const a=h.task('Alpha');a.title='';a.version=1;
 h.save(dayId(today),doc=>doc.map(n=>n.id==='l-a'?{...n,content:[]}:n));assert.equal(logged(h).length,0);
 h.save(dayId(today),doc=>doc.map(n=>n.id==='l-a'?{...n,content:[{type:'text',text:'First words',styles:{}}]}:n));
 assert.equal(h.task('First words').id,a.id);assert.equal(logged(h).length,1);
});
test('independent: a stored blank task edited before first words is not considered new',()=>{
 const h=setup([rule({id:'new',triggers:[{kind:'row-added'}]})]);const a=h.task('Alpha');a.title='';a.version=1;
 h.save(dayId(today),doc=>doc.map(n=>n.id==='l-a'?{...n,content:[]}:n));
 h.run({type:'set-task-dates',taskId:a.id,deadlineOn:'2026-10-25'});
 assert.ok(h.ws.tasks.find(t=>t.id===a.id)!.version>1);
 h.save(dayId(today),doc=>doc.map(n=>n.id==='l-a'?{...n,content:[{type:'text',text:'First words after date',styles:{}}]}:n));
 assert.equal(logged(h).length,0,'current heuristic treats the edited blank identity as already seen');
});
