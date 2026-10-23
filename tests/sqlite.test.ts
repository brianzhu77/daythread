import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { sqliteMigrations } from '../src/server/sqlite-mapping.ts'
import { createEmptyWorkspace,applyCommand } from '../src/domain/workspace.ts'
import { repositoryContract } from './repository-contract.ts'
import type { Workspace, Page, Task, Event, Placement, Material, Capture, Receipt } from '../src/domain/types.ts'
const fixture=async()=>{const dir=await mkdtemp(join(tmpdir(),'daythread-sqlite-'));const path=join(dir,'workspace.sqlite');return{dir,path,create:()=>new SqliteWorkspaceRepository(path),failBeforeCommit:async(operationId:string)=>{
 const db=new DatabaseSync(path)
 db.prepare('SELECT 1').get()
 // Generated fixture operationId is constant; keep trigger SQL independent from input payloads.
 assert.equal(operationId,'injected-failure')
 db.exec("CREATE TRIGGER inject_failure BEFORE INSERT ON receipts WHEN NEW.snapshot='current' AND NEW.operationId='injected-failure' BEGIN SELECT RAISE(ABORT,'injected SQL failure'); END");db.close()
 return()=>{const db=new DatabaseSync(path);db.exec('DROP TRIGGER inject_failure');db.close()}
},cleanup:()=>rm(dir,{recursive:true,force:true})}}
repositoryContract('SQLite',fixture)
function fullFixture(): Workspace {
  const task: Required<Task>={id:'task',title:'private task',status:'open',version:2,plannedOn:'2026-10-17',attentionOn:null,deadlineOn:'2026-10-18',paused:false,createdOn:'2026-10-16',lastPlannedOn:'2026-10-17',sourcePageId:'page'}
  const placement: Required<Placement>={taskId:task.id,date:'2026-10-17',state:'included',order:0,section:'top3'}
  const page: Required<Page>={id:'page',type:'daily',date:'2026-10-17',title:'private day',parentId:null,sections:[{id:'section',kind:'top3',title:'Top 3',blocks:[{id:'block',kind:'task',taskId:task.id,text:task.title,planRole:'plan'}]}],editorJSON:'[]',templateApplied:true,editorSections:'[]',editorBlockMetadata:{block:{id:'block',kind:'paragraph',text:'private note'}},editorCreations:{block:task.id},editorDeletions:{removed:{task,placements:[placement],afterVersion:3,afterPlacements:[]}},reviewText:'private review',reviewSaved:true,handoffDone:true,reviewStep:2,reviewSource:'direct',reviewSkipped:false,draftError:'private error',draft:{simulated:true,taskIds:[task.id],materialIds:['material'],text:'private draft'}}
  const event:Required<Event>={id:'event',title:'private event',date:'2026-10-17',time:null,cancelled:false}
  const material:Required<Material>={id:'material',url:'https://example.com/private',title:'private link',body:'private body',savedOn:'2026-10-16',reviewState:'watching',nextReviewOn:'2026-10-23',resurface:true,lastDecisionOn:null,skippedUntil:null,taskId:task.id,openedOn:['2026-10-17'],dismissedOn:[],decisions:[{date:'2026-10-17',decision:'watching'}],sources:[{pageId:page.id,blockId:'source',note:'private annotation'}]}
  const capture:Required<Capture>={id:'capture',pageId:page.id,text:'private capture',status:'needs_confirmation',contextLine:'private context',error:'private error',failure:'context',proposals:[{id:'proposal',kind:'update-task',title:'private proposal',taskId:task.id,expectedVersion:2,status:'done',url:'https://example.com'}],proposalRevision:2,simulated:true,proposedTitle:'private title',taskId:task.id}
  const receipt:Required<Receipt>={operationId:'prior',message:'private message',entityId:task.id,simulated:true,fingerprint:'private fingerprint'}
  const before={...createEmptyWorkspace(),revision:1,tasks:[{...task,version:1}],pages:[page],placements:[placement],events:[event],materials:[material],captures:[capture],receipts:{prior:receipt}}
  return {...before,revision:2,tasks:[task],undo:{operationId:'prior',revision:2,before}}
}
test('SQLite imports every optional field, arrays/order, receipts and undo exactly once; preserves source bytes',async()=>{
 const f=await fixture(),source=join(f.dir,'legacy.json'),w=fullFixture();
 w.pages.push({...w.pages[0]!,id:'second-page',title:'Second'})
 w.tasks.unshift({...w.tasks[0]!,id:'first-task'})
 try {
  const bytes=JSON.stringify(w,null,2);await writeFile(source,bytes)
  const r=new SqliteWorkspaceRepository(f.path,source);assert.deepEqual(await r.load(),w)
  assert.equal(await readFile(source,'utf8'),bytes)
  await writeFile(source,'broken source after successful import')
  assert.deepEqual(await new SqliteWorkspaceRepository(f.path,source).load(),w)
  const expected=applyCommand(w,{operationId:'undo-now',expectedRevision:2,action:{type:'undo',targetOperationId:'prior'}})
  assert.deepEqual(await r.execute({operationId:'undo-now',expectedRevision:2,action:{type:'undo',targetOperationId:'prior'}}),expected)
 }finally{await f.cleanup()}
})
test('SQLite invalid and duplicate-key imports abort with source intact, and can retry after correction',async()=>{
 for(const kind of ['duplicate','unknown','invalid'] as const){
  const f=await fixture(),source=join(f.dir,'legacy.json'),w=fullFixture()
  try {
   if(kind==='duplicate')w.placements.push({...w.placements[0]!})
   if(kind==='unknown')(w.tasks[0] as unknown as Record<string,unknown>).futureField='do not lose'
   const bytes=kind==='invalid'?'broken json':JSON.stringify(w);await writeFile(source,bytes)
   await assert.rejects(new SqliteWorkspaceRepository(f.path,source).load());assert.equal(await readFile(source,'utf8'),bytes)
   await writeFile(source,JSON.stringify(createEmptyWorkspace()));assert.equal((await new SqliteWorkspaceRepository(f.path,source).load()).revision,0)
  }finally{await f.cleanup()}
 }
})
test('SQLite initialized missing-table and newer-layout stores fail instead of reimporting',async()=>{
 for(const damage of ['DROP TABLE tasks','ALTER TABLE pages DROP COLUMN editorJSON','PRAGMA user_version=999']){
  const f=await fixture(),source=join(f.dir,'legacy.json')
  try {
   await f.create().load();await writeFile(source,JSON.stringify(fullFixture()))
   const db=new DatabaseSync(f.path);db.exec(damage);db.close()
   await assert.rejects(new SqliteWorkspaceRepository(f.path,source).load())
  }finally{await f.cleanup()}
 }
})
test('SQLite independent processes contend under one transaction; one stale writer loses',async()=>{
 const f=await fixture()
 try {
  await f.create().load()
  const url=new URL('../src/server/sqlite-repository.ts',import.meta.url).href
  const source=`import {SqliteWorkspaceRepository} from ${JSON.stringify(url)};const r=new SqliteWorkspaceRepository(process.argv[1]);try{await r.execute({operationId:process.argv[2],expectedRevision:0,action:{type:'ensure-day',date:'2026-10-17'}});process.exitCode=0}catch{process.exitCode=2}`
  const codes=await Promise.all(['a','b','c'].map(id=>new Promise<number|null>((resolve,reject)=>{const c=spawn(process.execPath,['--input-type=module','-e',source,f.path,id],{stdio:'ignore'});c.on('error',reject);c.on('exit',resolve)})))
  assert.deepEqual(codes.sort(),[0,2,2]);assert.equal((await f.create().load()).revision,1)
 }finally{await f.cleanup()}
})

test('SQLite explicit missing import source fails before creating a database; only default-path mode permits empty initialization',async()=>{
 const f=await fixture(),missing=join(f.dir,'typo-workspace.json')
 try {
  await assert.rejects(new SqliteWorkspaceRepository(f.path,missing).load(),{code:'ENOENT'})
  await assert.rejects(stat(f.path),{code:'ENOENT'})
  const allowed=new SqliteWorkspaceRepository(f.path,missing,{allowMissingLegacy:true})
  assert.deepEqual(await allowed.load(),createEmptyWorkspace())
  // After successful initialization the old import source is no longer a runtime dependency.
  assert.deepEqual(await new SqliteWorkspaceRepository(f.path,missing).load(),createEmptyWorkspace())
 }finally{await f.cleanup()}
})
test('SQLite layout 1 (no parentId) upgrades in place; old pages stay top level and new subpages keep their parent',async()=>{
 const f=await fixture()
 try {
  let repo=f.create(), ws=await repo.load()
  ws=(await repo.execute({operationId:'doc',expectedRevision:ws.revision,action:{type:'create-document',title:'Old page',body:''}})).workspace
  // Recreate the layout an existing store has before this change.
  let db=new DatabaseSync(f.path);db.exec('ALTER TABLE tasks DROP COLUMN doneOn');db.exec('ALTER TABLE pages DROP COLUMN url');db.exec('ALTER TABLE pages DROP COLUMN trashedAt');db.exec('ALTER TABLE pages DROP COLUMN trashId');db.exec('ALTER TABLE pages DROP COLUMN parentId');db.exec('ALTER TABLE captures DROP COLUMN model');db.exec('ALTER TABLE captures DROP COLUMN mode');db.exec('ALTER TABLE captures DROP COLUMN capturedAt');db.exec('PRAGMA user_version=1');db.close()
  repo=f.create(); ws=await repo.load()
  assert.equal(ws.pages[0]!.parentId,undefined)
  ws=(await repo.execute({operationId:'sub',expectedRevision:ws.revision,action:{type:'create-document',title:'',body:'',pageId:'child',parentId:ws.pages[0]!.id}})).workspace
  ws=await f.create().load()
  assert.equal(ws.pages.find(p=>p.id==='child')!.parentId,ws.pages[0]!.id)
  db=new DatabaseSync(f.path)
  assert.equal(Number(db.prepare('PRAGMA user_version').get()!.user_version),sqliteMigrations.length)
  assert.ok(db.prepare('PRAGMA table_info(pages)').all().some(c=>c.name==='parentId'))
  db.close()
 }finally{await f.cleanup()}
})
test('rollback script: a store with a subpage and its card goes back to layout 1 with no pageLink left anywhere',async()=>{
 const f=await fixture()
 try {
  const repo=f.create(); let ws=await repo.load()
  ws=(await repo.execute({operationId:'day',expectedRevision:ws.revision,action:{type:'ensure-day',date:'2026-10-18'}})).workspace
  const day=ws.pages[0]!
  ws=(await repo.execute({operationId:'sub',expectedRevision:ws.revision,action:{type:'create-document',title:'Trip ideas',body:'',pageId:'child',parentId:day.id}})).workspace
  const { editorSeed, pageContentKey } = await import('../src/domain/editor-document.ts')
  const p=ws.pages.find(x=>x.id===day.id)!, doc=[...editorSeed(p,ws),{id:'card1',type:'pageLink',props:{pageId:'child'}}]
  ws=(await repo.execute({operationId:'card',expectedRevision:ws.revision,action:{type:'save-editor',pageId:p.id,expectedContent:pageContentKey(p),document:JSON.stringify(doc)}})).workspace
  const before=ws.pages.length
  const script=(name:string)=>new Promise<string>((ok,fail)=>{const c=spawn(process.execPath,[name,f.path]);let s='';c.stdout.on('data',d=>s+=d);c.stderr.on('data',d=>s+=d);c.on('exit',code=>code===0?ok(s):fail(new Error(s)))})
  // Rollbacks run newest first: layout 7 → 6 (doneOn), 6 → 5 (page links), 5 → 4 (link pages), 4 → 3 (trash), 3 → 2 (model ledger), then 2 → 1 (parentId).
  await script('scripts/sqlite-rollback-done-on.ts')
  await script('scripts/sqlite-rollback-page-links.ts')
  await script('scripts/sqlite-rollback-link-pages.ts')
  await script('scripts/sqlite-rollback-trash.ts')
  await script('scripts/sqlite-rollback-model.ts')
  const out=await script('scripts/sqlite-rollback-parent-id.ts')
  assert.match(out,/Layout 2 → 1\. 1 subpage now top level; [12] page cards? \(all snapshots\) now links/)
  const db=new DatabaseSync(f.path)
  assert.equal(Number(db.prepare('PRAGMA user_version').get()!.user_version),1)
  assert.equal(db.prepare('PRAGMA table_info(pages)').all().some(c=>c.name==='parentId'),false)
  for (const row of db.prepare('SELECT * FROM pages').all()) assert.equal(JSON.stringify(row).includes('pageLink')||JSON.stringify(row).includes('parentId'),false)
  const dayRow=db.prepare("SELECT editorJSON FROM pages WHERE snapshot='current' AND id=?").get(day.id)!
  assert.ok(String(dayRow.editorJSON).includes('Trip ideas'))
  assert.equal(Number(db.prepare("SELECT count(*) n FROM pages WHERE snapshot='current'").get()!.n),before)
  db.close()
  // Rolling forward again (this build reopens it as layout 2) keeps everything, the old card as a reference.
  const again=await f.create().load()
  assert.equal(again.pages.length,before)
  assert.equal(again.pages.find(x=>x.id===day.id)!.sections.flatMap(s=>s.blocks).find(b=>b.id==='card1')!.targetPageId,'child')
 }finally{await f.cleanup()}
})
