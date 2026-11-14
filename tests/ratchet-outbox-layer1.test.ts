import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import { OutboxHeld } from '../src/server/outbox-replay.ts'
import type { ServerRepository } from '../src/server/repository.ts'
async function seed(repo: ServerRepository) {
 await repo.execute({operationId:'day',expectedRevision:0,action:{type:'ensure-day',date:'2026-11-14'}})
 await repo.execute({operationId:'task',expectedRevision:1,action:{type:'add-task',pageId:'day:2026-11-14',title:'Water'}})
 const ws=await repo.load();return {base:ws.revision,id:ws.tasks[0]!.id}
}
for (const engine of ['sqlite','postgres'] as const) for (const scenario of ['gap','future'] as const) test(`${engine}: ${scenario} replay is held`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ratchet-outbox-')), path=join(dir,'test.sqlite')
 const pg=engine==='postgres'?await PGlite.create():null
 try {
  const repo:ServerRepository=pg?new PostgresWorkspaceRepository(pgliteClient(pg)):new SqliteWorkspaceRepository(path)
  const {base,id}=await seed(repo)
  // Simulate an older build reopening the task and advancing workspace revision without touching the outbox stamps.
  if(scenario==='gap' && pg) {
   await pg.query('update daythread.tasks set status=$1, version=version+1 where id=$2',['open',id])
   await pg.exec('update daythread.workspaces set revision=revision+1')
  } else if(scenario==='gap') {
   const db=new DatabaseSync(path),row=db.prepare('select data from workspace where id=1').get() as {data:string}
   const ws=JSON.parse(row.data); ws.revision++;ws.tasks[0].status='open';ws.tasks[0].version++
   db.prepare('update workspace set revision=?,data=? where id=1').run(ws.revision,JSON.stringify(ws));db.close()
  }
  const sentBase=scenario==='future'?base+50:base
  await assert.rejects(repo.executeOutbox({operationId:'stale-tick',expectedRevision:sentBase,action:{type:'task-status',taskId:id,status:'done',today:'2026-11-14'}}, {baseRevision:sentBase,ownRevisions:[],readsBeyond:false}),e=>e instanceof OutboxHeld && e.reason==='changed-since')
 } finally {await pg?.close();await rm(dir,{recursive:true,force:true})}
})
