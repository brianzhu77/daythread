import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkspaceRepository } from '../src/server/repository.ts'
export function repositoryContract(name: string, fixture: () => Promise<{ create(): WorkspaceRepository; failBeforeCommit(operationId: string): Promise<() => void>; cleanup():Promise<void> }>) {
  test(`${name}: reopen, lost-response replay, changed identity, stale rejection and continued use`,async()=>{
    const f=await fixture()
    try {
      const first=f.create();const c={operationId:'lost-response',expectedRevision:0,action:{type:'ensure-day' as const,date:'2026-10-17'}}
      await first.execute(c) // Commit succeeded; pretend its response was lost.
      const reopened=f.create(),before=await reopened.load(), replay=await reopened.execute(c)
      assert.deepEqual(replay.workspace,before);assert.equal(replay.receipt.operationId,c.operationId)
      await assert.rejects(reopened.execute({...c,action:{...c.action,date:'2026-10-18'}}))
      await assert.rejects(reopened.execute({...c,operationId:'stale'}))
      assert.deepEqual(await f.create().load(),before)
      await reopened.execute({...c,operationId:'next',expectedRevision:before.revision,action:{...c.action,date:'2026-10-18'}})
      assert.equal((await f.create().load()).pages.length,2)
    } finally {await f.cleanup()}
  })
  test(`${name}: competing clients serialize and stale loser can recover`,async()=>{
    const f=await fixture()
    try {
      const results=await Promise.allSettled([f.create(),f.create()].map((r,i)=>r.execute({operationId:`race-${i}`,expectedRevision:0,action:{type:'ensure-day',date:`2026-10-${17+i}`}})))
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
      assert.equal(results.filter(r=>r.status==='rejected').length,1)
      const r=f.create(),w=await r.load();assert.equal(w.revision,1)
      await r.execute({operationId:'after-race',expectedRevision:w.revision,action:{type:'ensure-day',date:'2026-10-19'}})
      assert.equal((await r.load()).revision,2)
    } finally {await f.cleanup()}
  })
  test(`${name}: storage failure after entity writes rolls back data, undo, receipts and revision`,async()=>{
    const f=await fixture()
    try {
      const r=f.create()
      await r.execute({operationId:'day',expectedRevision:0,action:{type:'ensure-day',date:'2026-10-17'}})
      const page=(await r.load()).pages[0]!
      await r.execute({operationId:'task',expectedRevision:1,action:{type:'add-task',pageId:page.id,sectionId:page.sections[0]!.id,title:'Before'}})
      const before=await r.load(),restore=await f.failBeforeCommit('injected-failure')
      await assert.rejects(r.execute({operationId:'injected-failure',expectedRevision:before.revision,action:{type:'add-task',pageId:page.id,sectionId:page.sections[0]!.id,title:'Must roll back'}}))
      assert.deepEqual(await f.create().load(),before)
      restore()
      await r.execute({operationId:'after-failure',expectedRevision:before.revision,action:{type:'ensure-day',date:'2026-10-18'}})
      assert.equal((await f.create().load()).revision,before.revision+1)
    }finally{await f.cleanup()}
  })

}
