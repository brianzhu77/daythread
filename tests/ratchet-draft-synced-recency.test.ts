import {test} from 'node:test'
import assert from 'node:assert/strict'
import {harness,dayId,today,yesterday,para,text} from './v2-helpers.ts'
import {syncedBlockType} from '../src/domain/synced.ts'
import {buildDayDraftRequest} from '../src/server/model/day-draft.ts'
test('independent: a recent edit inside an old synced note reaches seven-day input',()=>{
 const h=harness();h.run({type:'create-document',title:'Old project note',body:'',pageId:'note'});
 h.save('note',()=>[{id:'s',type:syncedBlockType,props:{syncId:'record',roles:''},children:[para('l',text('Earlier words'))]}],{at:'2026-10-01T12:00:00.000Z'});
 h.day(yesterday);h.day(today);
 h.save('note',d=>d.map(n=>n.type===syncedBlockType?{...n,children:[para('l',text('Tomorrow: deliver the signed contract'))]}:n),{at:`${yesterday}T18:00:00.000Z`});
 assert.match(h.page('note').document,/deliver the signed contract/,'edit was stored');
 assert.match(buildDayDraftRequest(h.ws,h.page(dayId(today)),'UTC').messages[1]!.content,/deliver the signed contract/,'recently edited synced words must reach the model');
});
