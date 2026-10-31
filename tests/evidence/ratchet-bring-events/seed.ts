import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {harness,heading,todo,para,bullet,text,chip,dayId,nodesOf} from '../../v2-helpers.ts'
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
import {flatNodes,inlineText} from '../../../src/domain/editor-document.ts'
const h=harness();const prior='2026-10-31';h.day(prior)
h.save(dayId(prior),()=>[heading('source-h','Old notes'),todo('old-task','Carried fixture','plan',prior),bullet('bring-one',text('Brought fixture one')),bullet('bring-two',text('Brought fixture two')),...['2026-11-01','2026-11-02','2026-11-03','2026-11-04'].map((date,i)=>para('event'+i,text('Event fixture '+i+' '),chip('event-id'+i,date,'09:00')))])
const task=h.task('Carried fixture');const originalSource=structuredClone(h.page(dayId(prior)))
h.run({type:'create-template',title:'Custom',pageId:'tpl',dayPage:true});h.save('tpl',()=>[heading('head','Morning'),para('prompt',text('Own labelled slot')),todo('empty','','reference',''),heading('end','Evening'),para('end-prompt',text('Last prompt'))]);h.day('2026-11-01')
h.run({type:'bring-line',date:'2026-11-01',sourcePageId:dayId(prior),sourceBlockId:'bring-one'});h.run({type:'plan-task',date:'2026-11-01',taskId:task.id,today:'2026-11-01'});h.run({type:'bring-line',date:'2026-11-01',sourcePageId:dayId(prior),sourceBlockId:'bring-two'})
let doc=nodesOf(h.page(dayId('2026-11-01')));assert.deepEqual(doc.slice(0,6).map(n=>[n.type,inlineText(n.content)]),[['heading','Morning'],['task','Carried fixture'],['bulletListItem','Brought fixture one'],['bulletListItem','Brought fixture two'],['paragraph','Own labelled slot'],['task','']]);assert.deepEqual(h.page(dayId(prior)),originalSource)
const latestBring=h.ws.undo.operationId;h.run({type:'undo',targetOperationId:latestBring});assert.equal(nodesOf(h.page(dayId('2026-11-01'))).filter(n=>n.id.startsWith('brought:')).length,1);h.run({type:'bring-line',date:'2026-11-01',sourcePageId:dayId(prior),sourceBlockId:'bring-two'})
console.log('PASS Bring-before-carry group/order, second Bring, Undo/restoration, source immutable')
h.save('tpl',()=>[para('own-label',text('No heading prompt')),bullet('empty-bullet')]);h.day('2026-11-02');h.run({type:'bring-line',date:'2026-11-02',sourcePageId:dayId(prior),sourceBlockId:'bring-one'});assert.equal(inlineText(nodesOf(h.page(dayId('2026-11-02')))[0].content),'Brought fixture one')
h.day('2026-11-04');h.run({type:'set-template-target',pageId:'tpl',target:null});h.day('2026-11-03');h.run({type:'bring-line',date:'2026-11-03',sourcePageId:dayId(prior),sourceBlockId:'bring-one'});assert.equal(h.ws.tasks.length,1)
const repo=new SqliteWorkspaceRepository('/tmp/ratchet246.sqlite');await repo.load();const db=new DatabaseSync('/tmp/ratchet246.sqlite');db.prepare('update workspace set revision=?,data=? where id=1').run(h.ws.revision,JSON.stringify(h.ws));db.close();console.log('PASS no-heading Bring at top; builtin Bring fallback; invented fixtures ready')
