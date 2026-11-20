import {harness,dayId,today,tomorrow,text,heading,nodesOf} from './v2-helpers.ts'
import {draftView} from '../src/domain/day-draft.ts'
import {inlineText} from '../src/domain/editor-document.ts'
for(const mode of ['fill','missing']){
 const h=harness();h.day(tomorrow)
 h.save(dayId(tomorrow),()=>[heading('m','Morning'),{id:'slot',type:'task',props:{taskId:'editor-task:slot'},content:[],children:[]},heading('end','Reflection')])
 h.run({type:'set-draft',pageId:dayId(tomorrow),status:'ready',recipe:3,allowedTaskIds:[],moreOpen:[],items:['Alpha','Beta','Gamma'].map((w,i)=>({id:'i'+i,anchor:mode==='fill'?'slot':'gone',place:mode==='fill'?'fill':'after',source:'model',state:'open',block:{id:'b'+i,type:'task',props:{},content:[text(w)],children:[]}}))})
 for(const id of ['i2','i0','i1'])h.run({type:'apply-draft',pageId:dayId(tomorrow),itemIds:[id],today})
 console.log(mode,nodesOf(h.page(dayId(tomorrow))).map(n=>inlineText(n.content)))
}
