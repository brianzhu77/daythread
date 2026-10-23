// Independent synthetic fixture. Refuses an existing path. No model calls, no real workspace reads.
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const path=process.argv[2], manifest=process.argv[3]
if(!path||!manifest||existsSync(path)||existsSync(manifest)) throw Error('Supply NEW sqlite and NEW manifest paths')
const repo=new SqliteWorkspaceRepository(resolve(path));let n=0
const run=async(action:Action)=>(await repo.execute({operationId:`independent-${++n}`,expectedRevision:(await repo.load()).revision,action})).workspace
const today='2026-10-22',past='2026-10-21'
await run({type:'ensure-day',date:past});await run({type:'ensure-day',date:today})
let ws=await repo.load(), old=ws.pages.find(p=>p.date===past)!
ws=await run({type:'add-task',pageId:old.id,sectionId:old.sections.find(s=>s.kind==='other')!.id,title:'Independent history task',plannedOn:past})
const task=ws.tasks[0]!, historyId=ws.pages.find(p=>p.id===old.id)!.sections.flatMap(s=>s.blocks).find(b=>b.taskId===task.id)!.id
await run({type:'plan-task',taskId:task.id,date:today,section:'other',from:past,today})
for(const [id,title] of [['independent-target','Independent target'],['independent-source','Independent source'],['independent-trash','Independent trash']]) await run({type:'create-document',pageId:id,title,body:''})
const text=(id:string,value:string)=>({id,type:'paragraph',content:value})
const save=async(id:string,nodes:unknown[])=>{const p=(await repo.load()).pages.find(p=>p.id===id)!;return run({type:'save-editor',pageId:id,expectedContent:pageContentKey(p),document:JSON.stringify(nodes)})}
await save('independent-target',[...Array.from({length:32},(_,i)=>text(`before-${i}`,`Before ${i}`)),text('independent-line','Independent long line 原生家庭创伤导致的讨好型人格 '.repeat(5)),...Array.from({length:40},(_,i)=>text(`after-${i}`,`After ${i}`))])
await save('independent-trash',[text('trash-line','Independent trashed passage'),{id:'trash-task-row',type:'task',props:{taskId:task.id,role:'reference'},content:task.title}])
const ref=(id:string,pageId:string,lineId:string,taskId?:string)=>({id,type:'paragraph',content:[{type:'text',text:'Before ',styles:{}},{type:'pageRef',props:{pageId,lineId,refId:`ref-${id}`,newTitle:'',...(taskId?{taskId}:{})}},{type:'text',text:' after',styles:{}}]})
await save('independent-source',[ref('chip-plain','independent-target','independent-line'),ref('chip-task',old.id,historyId,task.id),ref('chip-trash','independent-trash','trash-line')])
await run({type:'delete-page',pageId:'independent-trash',at:'2026-10-22T12:00:00Z'})
ws=await repo.load()
const current=ws.pages.find(p=>p.date===today)!,currentRow=current.sections.flatMap(s=>s.blocks).find(b=>b.taskId===task.id)!
if(!ws.pages.find(p=>p.id===old.id)!.sections.flatMap(s=>s.blocks).some(b=>b.id===historyId)) throw Error('History fixture invalid')
writeFileSync(manifest,JSON.stringify({fixture:'ratchet-a11-v1',sqlite:resolve(path),source:'/pages?page=independent-source',plain:'/pages?page=independent-target&block=independent-line',plainBlock:'independent-line',taskUrls:[`/pages?page=${encodeURIComponent(old.id)}&block=${encodeURIComponent(historyId)}`,`/pages?page=${encodeURIComponent(old.id)}&block=${encodeURIComponent(historyId)}&task=${encodeURIComponent(task.id)}`],trashedTaskUrl:`/pages?page=independent-trash&block=trash-task-row&task=${encodeURIComponent(task.id)}`,taskDestination:`/day/${today}`,taskBlock:currentRow.id,plainChip:'chip-plain',trashChip:'chip-trash',trashPage:'independent-trash'},null,2))
console.log(`Synthetic fixture ready at revision ${ws.revision}; manifest ${manifest}`)
