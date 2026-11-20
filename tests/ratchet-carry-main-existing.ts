import assert from 'node:assert/strict'
import {harness,dayId,today,yesterday,twoDaysAgo,text,bullet,heading,todo} from '/tmp/ratchet-carry-ref/tests/v2-helpers.ts'
import {buildDayDraftRequest,itemsFromModel} from '/tmp/ratchet-carry-ref/src/server/model/day-draft.ts'
import {draftView} from '/tmp/ratchet-carry-ref/src/domain/day-draft.ts'
for(const mode of ['model-existing-todo']){
const h=harness();h.day(twoDaysAgo);h.save(dayId(twoDaysAgo),d=>[...d,heading('h','Tomorrow'),bullet('p',text(mode==='source-missing'?'Other note':'Pack bags'))]);h.day(yesterday);h.day(today)
h.run({type:'set-draft',pageId:dayId(yesterday),recipe:2,status:'ready',moreOpen:[],allowedTaskIds:[],items:[{id:'old',anchor:'',place:'after',source:'model',state:'open',block:{id:'ob',type:'task',props:{},content:[text('Pack bags')],children:[]}}]})
if(mode==='model-existing-todo')h.save(dayId(twoDaysAgo),d=>[...d,todo('existing','Pack bags')]);
const req=buildDayDraftRequest(h.ws,h.page(dayId(today)),'UTC');let n=0;const newid=()=>`n${++n}`
const model=mode==='model-new-todo'?itemsFromModel(req,[{anchor:[...req.blocks.keys()][0]!,place:'after',kind:'new_todo',taskId:'',lineId:'',text:'Pack bags',why:''}],newid):[]
if(mode==='model-existing-todo')model.push({id:'existing-model',anchor:[...req.blocks.values()][0]!.id,place:'after',source:'model',state:'open',taskId:[...req.tasks.values()].find(t=>t.title==='Pack bags')!.id});
const items=model
h.run({type:'apply-draft',pageId:dayId(yesterday),itemIds:['old'],today});
h.run({type:'set-draft',pageId:dayId(today),recipe:4,status:'ready',moreOpen:[],allowedTaskIds:[...req.tasks.values()].map(t=>t.id),items})
h.run({type:'apply-draft',pageId:dayId(today),itemIds:items.map(i=>i.id),today})
console.log(mode,'before old edit',draftView(h.ws,h.page(dayId(yesterday)))?.items.map(i=>i.id));
h.save(dayId(yesterday),d=>[...d,bullet('later-edit',text('Unrelated note after handoff'))]);
console.log(mode,'from',items[0]?.from,'old eligible',draftView(h.ws,h.page(dayId(yesterday)))?.items.map(i=>i.id))
assert.equal(h.ws.tasks.filter(t=>t.title==='Pack bags').length,mode==='model-existing-todo'?2:1);console.log('PASS race',mode)
}
