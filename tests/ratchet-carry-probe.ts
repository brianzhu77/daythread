import {harness,dayId,today,yesterday,twoDaysAgo,text,bullet,heading} from './v2-helpers.ts'
import {buildDayDraftRequest,itemsFromModel,withSkippedPlan} from '../src/server/model/day-draft.ts'
import {draftView} from '../src/domain/day-draft.ts'
for(const mode of ['model-new-todo','source-missing']){
const h=harness();h.day(twoDaysAgo);h.save(dayId(twoDaysAgo),d=>[...d,heading('h','Tomorrow'),bullet('p',text(mode==='source-missing'?'Other note':'Pack bags'))]);h.day(yesterday);h.day(today)
h.run({type:'set-draft',pageId:dayId(yesterday),recipe:2,status:'ready',moreOpen:[],allowedTaskIds:[],items:[{id:'old',anchor:'',place:'after',source:'model',state:'open',block:{id:'ob',type:'task',props:{},content:[text('Pack bags')],children:[]}}]})
const req=buildDayDraftRequest(h.ws,h.page(dayId(today)),'UTC');let n=0;const newid=()=>`n${++n}`
const model=mode==='model-new-todo'?itemsFromModel(req,[{anchor:[...req.blocks.keys()][0]!,place:'after',kind:'new_todo',taskId:'',lineId:'',text:'Pack bags',why:''}],newid):[]
const {items}=withSkippedPlan(h.ws,h.page(dayId(today)),req,model,newid)
h.run({type:'set-draft',pageId:dayId(today),recipe:4,status:'ready',moreOpen:[],allowedTaskIds:[],items})
h.run({type:'apply-draft',pageId:dayId(today),itemIds:items.map(i=>i.id),today})
console.log(mode,'from',items[0]?.from,'old eligible',draftView(h.ws,h.page(dayId(yesterday)))?.items.map(i=>i.id))
h.run({type:'apply-draft',pageId:dayId(yesterday),itemIds:['old'],today});console.log('tasks',h.ws.tasks.filter(t=>t.title==='Pack bags').length)
}
