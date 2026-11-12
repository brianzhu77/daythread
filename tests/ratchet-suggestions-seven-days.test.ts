import {test} from 'node:test'
import assert from 'node:assert/strict'
import {harness,todo,heading,para,text,dayId} from './v2-helpers.ts'
import {buildDayDraftRequest,withFallback} from '../src/server/model/day-draft.ts'
const day='2026-11-12',yesterday='2026-11-11';
function setup(){const h=harness();h.day(yesterday);h.day(day);return h}
test('independent baseline: yesterday Tomorrow heading, plain plan and task reach the request',()=>{
 const h=setup();h.save(dayId(yesterday),()=>[heading('next',"Tomorrow’s Todo"),todo('t','Call the clinic'),para('plain',text('Tomorrow: mail the signed form'))]);
 const req=buildDayDraftRequest(h.ws,h.page(dayId(day))),body=req.messages[1]!.content;
 assert.match(body,/Tomorrow’s Todo/);assert.match(body,/Call the clinic/);assert.match(body,/mail the signed form/);
 const task=h.task('Call the clinic');assert.ok([...req.tasks.values()].some(t=>t.id===task.id));
 const result=withFallback(h.ws,h.page(dayId(day)),[],()=>crypto.randomUUID());
 assert.ok(!result.items.some(i=>i.taskId===task.id),'a model omission is not forced into suggestions for this ordinary Tomorrow heading');
 assert.ok(result.moreOpen.includes(task.id),'it is only in the separate more-open list');
});
test('new requirement: an old day page updated yesterday reaches the seven-day request',()=>{
 const h=setup();h.day('2026-10-01');h.save(dayId('2026-10-01'),()=>[para('old',text('RECENT_EDIT_OLD_DAY'))]);h.page(dayId('2026-10-01')).editedAt='2026-11-11T18:00:00Z';
 assert.match(buildDayDraftRequest(h.ws,h.page(dayId(day))).messages[1]!.content,/RECENT_EDIT_OLD_DAY/);
});
test('new requirement: a recently edited ordinary document reaches the request',()=>{
 const h=setup();h.run({type:'create-document',title:'Project notes',pageId:'notes',body:''});h.save('notes',()=>[para('note',text('RECENT_EDIT_DOCUMENT'))]);h.page('notes').editedAt='2026-11-11T18:00:00Z';
 assert.match(buildDayDraftRequest(h.ws,h.page(dayId(day))).messages[1]!.content,/RECENT_EDIT_DOCUMENT/);
});
test('new requirement prerequisite: an ordinary day save records its edit time',()=>{
 const h=setup();h.save(dayId(yesterday),()=>[para('plan',text('Fresh yesterday plan'))],{at:'2026-11-11T18:00:00Z'});
 assert.equal(h.page(dayId(yesterday)).editedAt,'2026-11-11T18:00:00Z');
});
