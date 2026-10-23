import assert from 'node:assert/strict'
import {applyCommand,createEmptyWorkspace,carryAncestor,carrySection} from '../../../src/domain/workspace.ts'
import {editorSeed,pageContentKey} from '../../../src/domain/editor-document.ts'
let w=createEmptyWorkspace(),n=0;const old='2026-10-22',today='2026-10-23',run=(action:any)=>w=applyCommand(w,{operationId:`ind-${++n}`,expectedRevision:w.revision,action}).workspace
run({type:'ensure-day',date:old});const ids=[]
for(const title of ['A','B','b1','C']){const p=w.pages.find(p=>p.date===old)!;run({type:'add-task',pageId:p.id,sectionId:p.sections.find(s=>s.kind==='top3')!.id,title,plannedOn:old});ids.push(w.tasks.at(-1)!.id)}
let p=w.pages.find(p=>p.date===old)!,doc=editorSeed(p,w),parent=doc.find(x=>x.props?.taskId===ids[1])!,child=doc.find(x=>x.props?.taskId===ids[2])!
run({type:'save-editor',pageId:p.id,expectedContent:pageContentKey(p),document:JSON.stringify(doc.filter(x=>x.id!==child.id).map(x=>x.id===parent.id?{...x,children:[child]}:x))})
p=w.pages.find(p=>p.date===old)!
const items=ids.map(taskId=>({taskId,section:carrySection(p,taskId),...(carryAncestor(p,taskId)?{follows:carryAncestor(p,taskId)!}:{})}))
run({type:'ensure-day',date:today})
// The same card order as Add all, but four individual plus taps (separate commands).
for(const item of items)run({type:'plan-tasks',date:today,items:[item]})
const now=w.pages.find(p=>p.date===today)!,top=now.sections.find(s=>s.kind==='top3')!.blocks.map(b=>b.text),other=now.sections.find(s=>s.kind==='other')!.blocks.map(b=>b.text)
console.log(JSON.stringify({top,other}));assert.deepEqual(top,['A','B','b1','C'],'individual + taps must not make child b1 consume C slot');assert.deepEqual(other,[])
