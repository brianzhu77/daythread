import {PGlite} from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {PostgresWorkspaceRepository} from '../../../src/server/postgres-repository.ts'
import {pgliteClient} from '../../../src/server/db/sql.ts'
import {pageContentKey} from '../../../src/domain/editor-document.ts'
const {PostgresWorkspaceRepository:Old}=await import(pathToFileURL(process.argv[2]+'/src/server/postgres-repository.ts').href)
const db=new PGlite(),sql=pgliteClient(db),old=new Old(sql,'ratchet_anchor'),now=new PostgresWorkspaceRepository(sql,'ratchet_anchor');let n=0;
const run=async(repo:any,action:any,id='op'+(++n))=>repo.execute({operationId:id,expectedRevision:(await repo.load()).revision,action})
await old.load();await run(old,{type:'create-document',pageId:'p',title:'P',body:''});
await run(old,{type:'save-editor',pageId:'p',expectedContent:pageContentKey((await old.load()).pages.find((p:any)=>p.id==='p')),document:JSON.stringify([{id:'line',type:'paragraph',content:[{type:'text',text:'Words',styles:{}}],props:{},children:[]}])});
await now.load();await run(now,{type:'add-comment',pageId:'p',threadId:'t',commentId:'c',body:'Note',at:'2026-11-05T10:00:00Z',anchor:{blockId:'line',quote:'Words'}});
assert.equal((await old.load()).threads[0].anchor,undefined);
await run(old,{type:'resolve-thread',resolved:true,threadId:'t',version:1,at:'2026-11-05T10:00:00Z'},'resolve-old');
assert.ok((await now.load()).threads![0]!.resolvedAt);assert.equal((await now.load()).threads![0]!.anchor!.blockId,'line');
await run(now,{type:'undo',targetOperationId:'resolve-old'});assert.equal((await now.load()).threads![0]!.resolvedAt,undefined);assert.equal((await now.load()).threads![0]!.anchor!.blockId,'line');
await run(old,{type:'add-comment',pageId:'p',threadId:'t',commentId:'reply',body:'Old reply',at:'2026-11-05T11:00:00Z'});
assert.equal((await now.load()).threads![0]!.anchor!.blockId,'line');assert.equal((await now.load()).threads![0]!.comments.length,2);
console.log('PASS PGlite old-floor migration/reply/Resolve and newer Undo preserve anchor');await db.close();
