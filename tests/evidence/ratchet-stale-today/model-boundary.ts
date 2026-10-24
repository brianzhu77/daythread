import assert from'node:assert/strict';import{readDraftAnswer,type DraftRequest}from'../../../src/server/model/draft-prompt.ts';
const request=(tasks:string[]=[],materials:string[]=[],lines:unknown[]=[])=>({manifest:{taskCandidates:tasks,materialCandidates:materials,lines},lines:new Map()}as unknown as DraftRequest);
const answer={taskIds:['invented'],materialIds:['invented'],proposals:[{lineId:'invented',propose:true,date:null}]};
assert.equal(readDraftAnswer(answer,request(),'2026-10-24').ok,true);
for(const r of[request(['real']),request([],['real']),request([],[],[{lineId:'real'}])])assert.equal(readDraftAnswer(answer,r,'2026-10-24').ok,false);
const valid=readDraftAnswer({...answer,taskIds:['real']},request(['real']),'2026-10-24');assert.equal(valid.ok,true);if(valid.ok)assert.deepEqual(valid.taskIds,['real']);
assert.equal(readDraftAnswer({taskIds:[],proposals:[]},request(),'2026-10-24').ok,false);
console.log('PASS: empty manifests ignored; invalid entries for each populated manifest still refuse; valid task retained; malformed schema refuses')
