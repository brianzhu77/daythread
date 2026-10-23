import {existsSync,writeFileSync} from 'node:fs'
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
import {pageContentKey} from '../../../src/domain/editor-document.ts'
const path=process.argv[2];if(!path?.startsWith('/tmp/ratchet-155-')||existsSync(path))throw Error('new isolated /tmp/ratchet-155-* path required')
const repo=new SqliteWorkspaceRepository(path);let n=0
const run=async(action:any)=>(await repo.execute({operationId:`seed-${++n}`,expectedRevision:(await repo.load()).revision,action})).workspace
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver'}).format(new Date()), yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10)
await run({type:'ensure-day',date:yesterday});await run({type:'ensure-day',date:today})
let w=await repo.load(),p=w.pages.find(p=>p.date===yesterday)!
await run({type:'add-task',pageId:p.id,sectionId:p.sections.find(s=>s.kind==='other')!.id,title:'Unfinished prior task',plannedOn:yesterday})
w=await repo.load();const historyTask=w.tasks[0]!;await run({type:'plan-task',taskId:historyTask.id,date:today,section:'other',from:yesterday,today});
await run({type:'create-document',pageId:'ratchet-writing',title:'Writing replay',body:''})
w=await repo.load();p=w.pages.find(p=>p.id==='ratchet-writing')!
await run({type:'save-editor',pageId:p.id,expectedContent:pageContentKey(p),document:JSON.stringify([{id:'new-task',type:'task',props:{taskId:'editor-task:new-task',role:'reference',planDate:''},content:''},{id:'parent',type:'paragraph',content:'Parent note'},{id:'child',type:'paragraph',content:'Child note'},{id:'delete-line',type:'paragraph',content:'Delete this line'},{id:'cut-line',type:'paragraph',content:'Cut this line'}])})
w=await repo.load();const historyPage=w.pages.find(p=>p.date===today)!,historyBlock=historyPage.sections.flatMap(s=>s.blocks).find(b=>b.taskId===historyTask.id)!;
writeFileSync(path+'.json',JSON.stringify({today,yesterday,historyTaskId:historyTask.id,historyBlockId:historyBlock.id,pageId:'ratchet-writing',path:'/pages?page=ratchet-writing'}))
console.log(path,today,yesterday)
