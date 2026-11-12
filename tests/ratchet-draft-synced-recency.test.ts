import {test} from 'node:test'
import assert from 'node:assert/strict'
import {harness,dayId,today,yesterday,para,text} from './v2-helpers.ts'
import {syncedBlockType} from '../src/domain/synced.ts'
import {rowsOf,workspaceOf,planWrites} from '../src/server/workspace-rows.ts'
import {buildDayDraftRequest} from '../src/server/model/day-draft.ts'
test('independent: a recent edit inside an old synced note reaches seven-day input',()=>{
 const h=harness();h.run({type:'create-document',title:'Old project note',body:'',pageId:'note'});
 h.save('note',()=>[{id:'s',type:syncedBlockType,props:{syncId:'record',roles:''},children:[para('l',text('Earlier words'))]}],{at:'2026-10-01T12:00:00.000Z'});
 h.day(yesterday);h.day(today);
 const before=rowsOf(h.ws);
 h.save('note',d=>d.map(n=>n.type===syncedBlockType?{...n,children:[para('l',text('Tomorrow: deliver the signed contract'))]}:n),{at:`${yesterday}T18:00:00.000Z`});
 assert.equal(JSON.parse(h.page('note').document).length,1,'no conflict copy');
 assert.equal(h.page('note').editedAt,'2026-10-01T12:00:00.000Z','own page timestamp stays old');
 assert.match(h.page('note').document,/deliver the signed contract/,'edit was stored');
 assert.equal(h.ws.synced![0]!.editedAt,`${yesterday}T18:00:00.000Z`);
 assert.deepEqual(planWrites(before,h.ws).write.pages.upsert.map(p=>p.id),['synced:record']);
 const loaded=workspaceOf(rowsOf(h.ws));
 assert.equal(loaded.synced![0]!.editedAt,`${yesterday}T18:00:00.000Z`);
 assert.match(buildDayDraftRequest(loaded,loaded.pages.find(p=>p.id===dayId(today))!,'UTC').messages[1]!.content,/deliver the signed contract/,'storage roundtrip preserves source selection');
 assert.match(buildDayDraftRequest(h.ws,h.page(dayId(today)),'UTC').messages[1]!.content,/deliver the signed contract/,'recently edited synced words must reach the model');
});
