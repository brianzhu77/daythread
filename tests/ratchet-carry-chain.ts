import {harness,dayId,text,bullet,heading} from './v2-helpers.ts'
import {buildDayDraftRequest,withSkippedPlan} from '../src/server/model/day-draft.ts'
import {draftView} from '../src/domain/day-draft.ts'
const h=harness(); const plan='2026-11-19',old='2026-11-20',a='2026-11-21',b='2026-11-22'
h.day(plan);h.save(dayId(plan),d=>[...d,heading('h','Tomorrow'),bullet('p',text('Other note'))]);h.day(old)
h.run({type:'set-draft',pageId:dayId(old),recipe:2,status:'ready',moreOpen:[],allowedTaskIds:[],items:[{id:'old',anchor:'',place:'after',source:'model',state:'open',block:{id:'ob',type:'task',props:{},content:[text('Pack bags')],children:[]}}]})
function make(date:string,status:'ready'|'failed'){h.day(date);const req=buildDayDraftRequest(h.ws,h.page(dayId(date)),'UTC');const {items}=withSkippedPlan(h.ws,h.page(dayId(date)),req,[],()=>crypto.randomUUID());h.run({type:'set-draft',pageId:dayId(date),recipe:4,status,moreOpen:[],allowedTaskIds:[],items})}
const offered=(date:string)=>draftView(h.ws,h.page(dayId(date)))!.items
make(a,'failed');make(b,'ready');make(a,'ready')
console.log('after older Retry',offered(a).map(i=>i.id),offered(b).map(i=>i.id))
for(const date of [a,b]){const ids=offered(date).map(i=>i.id);if(ids.length)h.run({type:'apply-draft',pageId:dayId(date),itemIds:ids,today:b})}
console.log('tasks',h.ws.tasks.filter(t=>t.title==='Pack bags').length)
