import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Ratchet #70: a Retry sent straight to the server while the model is paused or out of budget is refused before the
// capture is touched (the receipt hiding the button is only the second layer).
test('server Retry is refused while the model is paused; the capture keeps its revision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-service-'))
  Object.assign(process.env, { DAYTHREAD_STORAGE: 'sqlite', DAYTHREAD_SQLITE_PATH: join(dir, 'w.sqlite'), OPENROUTER_API_KEY: 'fake', OPENROUTER_MODEL: 'fake/model' })
  try {
    const { getRepository } = await import('../src/server/storage.ts')
    const { SqliteWorkspaceRepository } = await import('../src/server/sqlite-repository.ts')
    const { retryCaptureForModel } = await import('../src/server/model/service.ts')
    const repo = getRepository() as InstanceType<typeof SqliteWorkspaceRepository>
    let ws = await repo.load()
    ws = (await repo.execute({ operationId: 'd', expectedRevision: ws.revision, action: { type: 'ensure-day', date: '2026-10-19' } })).workspace
    const old = await repo.execute({ operationId: 'c1', expectedRevision: ws.revision, action: { type: 'capture-for-model', pageId: ws.pages[0]!.id, text: 'call dentist', model: 'fake/model', capturedAt: '2026-10-19T16:00:00Z' } })
    const id = old.receipt.entityId!
    ws = (await repo.execute({ operationId: 'f1', expectedRevision: old.workspace.revision, action: { type: 'model-failed', captureId: id, revision: 1, failure: 'failure', error: 'Model unavailable · text saved' } })).workspace
    // Another capture's charge has a generation id but no cost: the model is paused.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(new Date())
    await repo.reserveModelAttempt({ id: 'a1', captureId: 'other', revision: 1, day, upperBoundUsd: 0.004, model: 'fake/model', requestHash: 'h', now: new Date().toISOString() })
    await repo.recordModelResult({ attemptId: 'a1', actualUsd: null, generationId: 'gen-1', now: new Date().toISOString() })
    const r = await retryCaptureForModel('retry-1', id)
    assert.equal(r.ok, false); assert.equal(r.info.state, 'paused')
    const c = (await repo.load()).captures.find(x => x.id === id)!
    assert.equal(c.proposalRevision, 1); assert.equal(c.status, 'failed')
    assert.equal((await repo.modelAttempts()).length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
