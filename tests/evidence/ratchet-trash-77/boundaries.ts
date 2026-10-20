import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository as Repo } from '../../../src/server/sqlite-repository.ts'
import { SqliteWorkspaceRepository as Old } from '../../../../daythread-ratchet-trash-old/src/server/sqlite-repository.ts'
const dir=mkdtempSync(join(tmpdir(),'ratchet-trash77-edge-'))
const cmd=async(r:any,action:any)=>{const w=await r.load();return (await r.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action})).workspace}
const sql=(p:string,f:(d:DatabaseSync)=>any)=>{const d=new DatabaseSync(p);try{return f(d)}finally{d.close()}}
const snap=(p:string)=>sql(p,d=>JSON.stringify([d.prepare('PRAGMA user_version').get(),d.prepare('PRAGMA application_id').get(),d.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),...d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t=>[t.name,d.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()])]))
const down=(p:string)=>spawnSync(process.execPath,['scripts/sqlite-rollback-trash.ts',p],{encoding:'utf8'})
async function seed(name:string){const p=join(dir,name+'.sqlite'),r=new Repo(p);await cmd(r,{type:'create-document',pageId:'P',title:'held content',body:'important'});await cmd(r,{type:'delete-page',pageId:'P',at:'2026-10-20T17:00:00Z'});return {p,r}}
// Failure after held table creation must roll back all rows, schema, revision and Undo.
{
 const {p}=await seed('down-fault');sql(p,d=>{d.exec("UPDATE materials SET sources='bad json'");d.exec("CREATE TRIGGER fail_after_hold BEFORE DELETE ON pages WHEN OLD.snapshot='current' BEGIN SELECT RAISE(ABORT,'injected-down-fault'); END")});const before=snap(p),res=down(p);assert.notEqual(res.status,0);assert.match(res.stderr,/injected-down-fault/);assert.equal(snap(p),before);console.log('PASS injected down-script failure rolls back schema, held tables, rows and Undo')
}
// Bad held content fails after ALTERs and a possible live collision deletion. Transaction must restore everything.
{
 const {p}=await seed('up-fault');assert.equal(down(p).status,0);const old=new Old(p);await cmd(old,{type:'create-document',pageId:'P',title:'',body:''});sql(p,d=>d.exec("UPDATE held_trash_l4 SET editorJSON='bad json'"));const before=snap(p);await assert.rejects(()=>new Repo(p).load());assert.equal(snap(p),before);console.log('PASS failed re-upgrade rolls back ALTERs, dropped recreation and all held data')
}
// No body in Retry recreation, but a new external source task makes it nonempty. Old recorded source task alone does not.
{
 const {p}=await seed('new-source');assert.equal(down(p).status,0);const old=new Old(p);await cmd(old,{type:'create-document',pageId:'P',title:'',body:''});let w=await cmd(old,{type:'create-document',pageId:'S',title:'source holder',body:''});w=await cmd(old,{type:'add-task',pageId:'S',sectionId:w.pages.find(x=>x.id==='S')!.sections[0].id,title:'new externally sourced task'});const task=w.tasks.find((t:any)=>t.title==='new externally sourced task')!;sql(p,d=>{d.prepare("UPDATE tasks SET sourcePageId='P',present=? WHERE snapshot='current' AND id=?").run(JSON.stringify([...new Set([...JSON.parse(String(d.prepare("SELECT present FROM tasks WHERE snapshot='current' AND id=?").get(task.id)!.present)),'sourcePageId'])]),task.id)});w=await new Repo(p).load();assert.equal(w.pages.find(x=>x.id==='P')!.trashedAt,undefined);assert.equal(w.tasks.find(x=>x.id===task.id)!.sourcePageId,'P');assert.equal(w.pages.filter(x=>x.trashedAt).length,1);assert.notEqual(w.pages.find(x=>x.trashedAt)!.id,'P');console.log('PASS empty-body recreation with new unrecorded source task is kept; held page receives new id')
}
// Held content's references in different representations must follow the remapped old page, while live references do not.
{
 const {p}=await seed('held-references');sql(p,d=>{const row=d.prepare("SELECT sections,editorJSON,editorBlockMetadata FROM pages WHERE snapshot='current' AND id='P'").get()!;const sections=JSON.parse(String(row.sections));sections[0].blocks.push({id:'held-ref',kind:'reference',text:'self',targetPageId:'P'});d.prepare("UPDATE pages SET sections=?,editorJSON=?,editorBlockMetadata=?,present=? WHERE snapshot='current' AND id='P'").run(JSON.stringify(sections),JSON.stringify([{id:'held-ref',type:'pageLink',props:{pageId:'P'}}]),JSON.stringify({'held-ref':{targetPageId:'P'}}),JSON.stringify([...new Set([...JSON.parse(String(d.prepare("SELECT present FROM pages WHERE snapshot='current' AND id='P'").get()!.present)),'editorJSON','editorBlockMetadata'])]));});assert.equal(down(p).status,0);const old=new Old(p);await cmd(old,{type:'create-document',pageId:'P',title:'new live title',body:'new live content'});const w=await new Repo(p).load(),held=w.pages.find(x=>x.trashedAt)!;assert.notEqual(held.id,'P');assert.equal(held.sections[0].blocks.find(x=>x.id==='held-ref')!.targetPageId,held.id);assert.equal(JSON.parse(held.editorJSON!)[0].props.pageId,held.id);assert.equal(held.editorBlockMetadata!['held-ref'].targetPageId,held.id);console.log('PASS held section/editorJSON/block metadata references share one id map; new live content preserved')
}
console.log('PASS independent fault/source boundaries; fixtures '+dir)
