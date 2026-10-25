import {SqliteWorkspaceRepository} from '../../../../src/server/sqlite-repository.ts'
import {editorSeed,pageContentKey} from '../../../../src/domain/editor-document.ts'
import {writeFileSync} from 'node:fs'
const path=process.argv[2]; if(!path?.startsWith('/tmp/ratchet220-'))throw Error('scratch only');
const repo=new SqliteWorkspaceRepository(path);
const run=async(action:any)=>{const w=await repo.load();return(await repo.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action})).workspace};
const text=(text:string)=>({type:'text',text,styles:{}}), chip=(date:string,time='')=>({type:'dateMention',props:{eventId:crypto.randomUUID(),date,time}});
await run({type:'ensure-day',date:'2026-10-24'});
await run({type:'create-document',pageId:'rollback-doc',title:'Rollback document',body:''});
await run({type:'create-document',pageId:'rollback-trash',title:'Rollback trash',body:''});
for(const id of ['day:2026-10-24','rollback-doc','rollback-trash']){
 const w=await repo.load(),p=w.pages.find(p=>p.id===id)!;
 const doc=[...editorSeed(p,w),{id:`${id}-probe`,type:'bulletListItem',props:{},content:[text('Before '),chip('2026-11-20','15:00'),text(' after')],children:[{id:`${id}-child`,type:'bulletListItem',props:{},content:[text('Nested '),chip('2027-01-05'),text(' end')],children:[]}]}];
 await run({type:'save-editor',pageId:id,expectedContent:pageContentKey(p),document:JSON.stringify(doc)});
}
await run({type:'delete-page',pageId:'rollback-trash',at:'2026-10-25T07:00:00Z'});
const w=await repo.load();writeFileSync('/tmp/ratchet220-before.json',JSON.stringify(w));console.log('seed',w.revision,w.pages.length,Boolean(w.undo));
