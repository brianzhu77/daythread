import assert from 'node:assert/strict'
import {applyCommand,createEmptyWorkspace,bornHere} from '../../../src/domain/workspace.ts'
import {editorSeed,pageContentKey} from '../../../src/domain/editor-document.ts'
let w=createEmptyWorkspace(),n=0;const run=(action:any)=>w=applyCommand(w,{operationId:`probe-${++n}`,expectedRevision:w.revision,action}).workspace
run({type:'ensure-day',date:'2026-10-23'});let p=w.pages[0]!;run({type:'add-task',pageId:p.id,sectionId:p.sections.find(s=>s.kind==='other')!.id,title:'Shared real task',plannedOn:p.date});const t=w.tasks[0]!,id=t.id
run({type:'create-document',pageId:'doc',title:'Reference page',body:''});const d=w.pages.find(p=>p.id==='doc')!
run({type:'save-editor',pageId:d.id,expectedContent:pageContentKey(d),document:JSON.stringify([{id:'ref',type:'task',props:{taskId:id,role:'reference'},content:t.title}])})
p=w.pages.find(p=>p.date==='2026-10-23')!;const row=p.sections.flatMap(s=>s.blocks).find(b=>b.taskId===id)!
const uiGoesWithLine=bornHere(w,w.tasks.find(x=>x.id===id)!,p);assert.equal(uiGoesWithLine,true)
run({type:'save-editor',pageId:p.id,expectedContent:pageContentKey(p),document:JSON.stringify(editorSeed(p,w).filter(b=>b.id!==row.id)),today:p.date,singleDeleteIds:[row.id]})
assert.ok(w.tasks.some(t=>t.id===id));console.log(JSON.stringify({uiGoesWithLine,uiPredictedNotice:'To-do deleted',taskStillExists:true,plannedOn:w.tasks.find(t=>t.id===id)!.plannedOn,reason:'another page still has a reference row'}))
