import {test} from 'node:test'
import assert from 'node:assert/strict'
import {harness,todo,today,dayId} from './v2-helpers.ts'
import {blockedNow,makesLoop} from '../src/domain/task-links.ts'
import {liveTaskIds} from '../src/domain/workspace.ts'
const at='2026-11-06T00:00:00Z';
function setup(){const h=harness();h.day(today);h.save(dayId(today),()=>[todo('a','A'),todo('b','B'),todo('c','C')]);return h}
const link=(h:ReturnType<typeof harness>,a:string,b:string)=>h.run({type:'link-tasks',taskId:h.task(a).id,add:[h.task(b).id],remove:[],at});
test('independent: copy survives original Trash; last line Trash suspends; restore different occurrence first',()=>{
 const h=setup(),a=h.task('A').id,b=h.task('B').id;
 for(const p of ['one','two']){h.run({type:'create-document',pageId:p,title:p,body:''});h.save(p,()=>[{...todo(p,'B','reference'),props:{taskId:b,role:'reference',planDate:''}}])}
 link(h,'A','B'); const links=JSON.stringify(h.ws.links);
 h.save(dayId(today),doc=>doc.filter(n=>n.id!=='b'));
 h.run({type:'delete-page',pageId:'one',at});assert.ok(blockedNow(h.ws,liveTaskIds(h.ws)).has(a));
 h.run({type:'delete-page',pageId:'two',at});assert.equal(blockedNow(h.ws,liveTaskIds(h.ws)).has(a),false);
 h.run({type:'restore-page',pageId:'two'});assert.equal(blockedNow(h.ws,liveTaskIds(h.ws)).get(a)?.by[0]?.id,b);
 assert.equal(JSON.stringify(h.ws.links),links);
});
test('independent: inactive edges still prevent cycles and a mixed invalid operation is atomic',()=>{
 const h=setup();link(h,'A','B');link(h,'B','C');h.run({type:'task-status',taskId:h.task('B').id,status:'cancelled',today});
 h.run({type:'create-document',pageId:'copy',title:'copy',body:''});const b=h.task('B').id;
 h.save('copy',()=>[{...todo('copy-b','B','reference'),props:{taskId:b,role:'reference',planDate:''}}]);
 h.save(dayId(today),doc=>doc.filter(n=>n.id!=='b'));h.run({type:'delete-page',pageId:'copy',at});
 const before=JSON.stringify(h.ws);
 assert.throws(()=>link(h,'C','A'),/already waits/);assert.equal(JSON.stringify(h.ws),before);
 // First addition would be legal; the second is self-link. Neither may survive.
 assert.throws(()=>h.run({type:'link-tasks',taskId:h.task('A').id,add:[h.task('C').id,h.task('A').id],remove:[b],at}),/can't block itself/);
 assert.equal(JSON.stringify(h.ws),before);
});
test('independent: stale Undo cannot restore an edge into a newer reverse edge',()=>{
 const h=setup();link(h,'A','B');const off=h.run({type:'link-tasks',taskId:h.task('A').id,add:[],remove:[h.task('B').id],at});
 link(h,'B','A');const before=JSON.stringify(h.ws);
 assert.throws(()=>h.run({type:'undo',targetOperationId:off.receipt.operationId}),/Cannot undo/);assert.equal(JSON.stringify(h.ws),before);
});
test('independent: a pasted deleted line cannot resurrect a dependency cycle',()=>{
 const h=setup();link(h,'A','B');link(h,'B','C');
 const b=h.task('B').id, saved=h.page(dayId(today)).document;
 h.save(dayId(today),doc=>doc.filter(n=>n.id!=='b'));
 assert.throws(()=>link(h,'C','A'),/Would make a loop through B \(deleted\)/)
 h.run({type:'create-document',pageId:'pasted',title:'Pasted',body:''});
 h.save('pasted',()=>[{...todo('pasted-b','B','reference'),props:{taskId:b,role:'reference',planDate:''}}]);
 const live=liveTaskIds(h.ws), edges=(h.ws.links??[]).filter(l=>live.has(l.blockedId)&&live.has(l.blockerId));
 assert.equal(edges.some((e,i)=>makesLoop(edges.filter((_,j)=>i!==j),e.blockedId,e.blockerId)),false,'restoring B must not reactivate A→B→C→A');
});
