import {test} from 'node:test'
import assert from 'node:assert/strict'
import {harness,todo,dayId,today,yesterday} from './v2-helpers.ts'
import {draftOf,draftView,DRAFT_RECIPE} from '../src/domain/day-draft.ts'
import {withFallback} from '../src/server/model/day-draft.ts'
test('independent: a skipped task stays absent from more open after remake',()=>{
 const h=harness();h.day(yesterday);h.save(dayId(yesterday),()=>[todo('t','Buy a dog bed')]);h.day(today);
 const task=h.task('Buy a dog bed').id;
 h.run({type:'set-draft',pageId:dayId(today),status:'ready',moreOpen:[],allowedTaskIds:[task],items:[{id:'old',anchor:'',place:'after',taskId:task,source:'model',state:'open'}]});
 h.run({type:'skip-draft',pageId:dayId(today),itemIds:['old']});
 const replacement=withFallback(h.ws,h.page(dayId(today)),[],()=>crypto.randomUUID());
 h.run({type:'set-draft',pageId:dayId(today),status:'ready',recipe:DRAFT_RECIPE,allowedTaskIds:[task],...replacement});
 assert.equal(draftOf(h.ws,dayId(today))!.items[0]!.state,'skipped');
 assert.equal(draftView(h.ws,h.page(dayId(today)))!.moreOpen.some(t=>t.taskId===task),false,'skipped task should not be offered again');
});
test('independent: commit merges a skip made while the model was working',()=>{
 const h=harness();h.day(yesterday);h.save(dayId(yesterday),()=>[todo('t','Buy a dog bed')]);h.day(today);const task=h.task('Buy a dog bed').id;
 const item={id:'old',anchor:'',place:'after' as const,taskId:task,source:'model' as const,state:'open' as const};
 h.run({type:'set-draft',pageId:dayId(today),status:'ready',moreOpen:[],allowedTaskIds:[task],items:[item]});
 const incoming={...item,id:'fresh'};
 h.run({type:'skip-draft',pageId:dayId(today),itemIds:['old']});
 h.run({type:'set-draft',pageId:dayId(today),status:'ready',recipe:DRAFT_RECIPE,moreOpen:[],allowedTaskIds:[task],items:[incoming]});
 assert.deepEqual(draftOf(h.ws,dayId(today))!.items.map(i=>[i.id,i.state,i.taskId]),[['old','skipped',task]]);
});
