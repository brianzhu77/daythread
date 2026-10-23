// Disposable synthetic fixture with dates relative to the same Vancouver day as the browser gate.
import {existsSync} from 'node:fs'
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
import {editorSeed,pageContentKey} from '../../../src/domain/editor-document.ts'
const path=process.argv[2]
if(!path?.startsWith('/tmp/ratchet-save-leave-')||existsSync(path))throw Error('New /tmp/ratchet-save-leave-* database required')
const repo=new SqliteWorkspaceRepository(path),today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Vancouver'})
let op=0
for(const n of [3,2,1,0]){
 const date=new Date(Date.parse(today+'T12:00:00Z')-n*86400000).toISOString().slice(0,10)
 let ws=(await repo.execute({operationId:`seed-${++op}`,expectedRevision:(await repo.load()).revision,action:{type:'ensure-day',date}})).workspace
 const page=ws.pages.find(p=>p.date===date)!,doc=editorSeed(page,ws)
 const words=n===3?['奥德赛','DRIVE Basketball','English Lesson']:['Synthetic note '+date]
 for(const [i,text]of words.entries())doc.push({id:`fixture-${n}-${i}`,type:'paragraph',content:text})
 await repo.execute({operationId:`seed-${++op}`,expectedRevision:ws.revision,action:{type:'save-editor',pageId:page.id,expectedContent:pageContentKey(page),document:JSON.stringify(doc)}})
}
console.log(JSON.stringify({path,today,days:[3,2,1,0].map(n=>new Date(Date.parse(today+'T12:00:00Z')-n*86400000).toISOString().slice(0,10))}))
