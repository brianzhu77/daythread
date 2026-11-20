import assert from 'node:assert/strict'
import {harness,dayId,today,tomorrow,text,heading,nodesOf} from './v2-helpers.ts'
import {draftView} from '../src/domain/day-draft.ts'
import {inlineText} from '../src/domain/editor-document.ts'
for(const mode of ['fill','missing']){
 const h=harness();h.day(tomorrow)
 h.save(dayId(tomorrow),()=>[heading('m','Morning'),{id:'slot',type:'task',props:{taskId:'editor-task:slot'},content:[],children:[]},heading('end','Reflection')])
 h.run({type:'set-draft',pageId:dayId(tomorrow),status:'ready',recipe:3,allowedTaskIds:[],moreOpen:[],items:['Alpha','Beta','Gamma'].map((w,i)=>({id:'i'+i,anchor:mode==='fill'?'slot':'gone',place:mode==='fill'?'fill':'after',source:'model',state:'open',block:{id:'b'+i,type:'task',props:{},content:[text(w)],children:[]}}))})
 for(const id of ['i2','i0','i1'])h.run({type:'apply-draft',pageId:dayId(tomorrow),itemIds:[id],today})
 assert.deepEqual(nodesOf(h.page(dayId(tomorrow))).map(n=>inlineText(n.content)).filter(Boolean),['Morning','Alpha','Beta','Gamma','Reflection']);console.log('PASS',mode)
}
{
 const h=harness();h.day(tomorrow);h.save(dayId(tomorrow),()=>[heading('m','Morning'),{id:'slot',type:'task',props:{taskId:'editor-task:slot'},content:[],children:[]},heading('end','Reflection')])
 h.run({type:'set-draft',pageId:dayId(tomorrow),status:'ready',recipe:3,allowedTaskIds:[],moreOpen:[],items:['Alpha line','Beta task'].map((w,i)=>({id:'mix'+i,anchor:'slot',place:'fill',source:'model',state:'open',block:{id:'mb'+i,type:i?'task':'paragraph',props:{},content:[text(w)],children:[]}}))})
 h.run({type:'apply-draft',pageId:dayId(tomorrow),itemIds:['mix0','mix1'],today})
 assert.deepEqual(nodesOf(h.page(dayId(tomorrow))).map(n=>inlineText(n.content)).filter(Boolean),['Morning','Alpha line','Beta task','Reflection']);console.log('PASS mixed-fill Apply all')
}
