import assert from 'node:assert/strict'
import {harness,dayId,text} from './v2-helpers.ts'
import {draftView} from '../src/domain/day-draft.ts'
const item=(id:string,from?:string)=>({id,anchor:'',place:'after' as const,source:'model' as const,state:'open' as const,...(from?{from}:{}),block:{id:id+'block',type:'task',props:{},content:[text('Pack bags')],children:[]}})
for(const remake of [false,true]){
const h=harness(),old=remake?'2026-11-20':'2026-11-10',now='2026-11-21';h.day(old);h.day(now)
const set=(date:string,items:any[],recipe:number)=>h.run({type:'set-draft',pageId:dayId(date),status:'ready',items,recipe,allowedTaskIds:[],moreOpen:[]})
set(old,[item('old')],2)
if(remake){h.run({type:'skip-draft',pageId:dayId(old),itemIds:['old']});set(old,[],3)}
set(now,[item('new','source-line')],3)
if(!remake)h.run({type:'apply-draft',pageId:dayId(now),itemIds:['new'],today:now})
assert.deepEqual(draftView(h.ws,h.page(dayId(remake?now:old)))?.items.map(i=>i.id),[])
if(!remake){assert.throws(()=>h.run({type:'apply-draft',pageId:dayId(old),itemIds:['old'],today:now}),/Nothing to apply/);assert.equal(h.ws.tasks.filter(t=>t.title==='Pack bags').length,1)}
console.log('PASS',remake?'remade-decided-old':'long-gap-old')
}
