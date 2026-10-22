import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { captureExpiryMs, expireStuckCaptures } from '../src/server/model/organize.ts'

// Jazz c971ce0b: an organize run that died (Vercel function frozen or killed, server restarted) must not leave the
// receipt on "Organizing…" forever; past the expiry it fails with the text kept and Retry offered.
const t0 = new Date('2026-10-22T16:00:00.000Z')
const at = (ms: number) => new Date(t0.getTime() + ms)
async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-expiry-'))
  const repo = new SqliteWorkspaceRepository(join(dir, 'w.sqlite'))
  let ws = await repo.load()
  ws = (await repo.execute({ operationId: 'day', expectedRevision: ws.revision, action: { type: 'ensure-day', date: '2026-10-22' } })).workspace
  const r = await repo.execute({ operationId: 'cap', expectedRevision: ws.revision, action: { type: 'capture-for-model', pageId: ws.pages[0]!.id, text: 'call dentist', model: 'fake/model', capturedAt: t0.toISOString() } })
  const capture = async () => (await repo.load()).captures.find(c => c.id === r.receipt.entityId)!
  return { repo, id: r.receipt.entityId!, capture, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
const reserve = (repo: SqliteWorkspaceRepository, id: string, captureId: string, revision: number, now: Date) =>
  repo.reserveModelAttempt({ id, subject: { kind: 'capture', id: captureId, revision }, day: '2026-10-22', upperBoundUsd: 0.004, model: 'fake/model', requestHash: id, now: now.toISOString() })

test('a first run that never reserved fails once the expiry has passed since the capture, and Retry is allowed', async () => {
  const s = await store()
  try {
    assert.equal(await expireStuckCaptures(s.repo, at(captureExpiryMs - 1000)), 0)
    assert.equal((await s.capture()).status, 'organizing')
    assert.equal(await expireStuckCaptures(s.repo, at(captureExpiryMs)), 1)
    const c = await s.capture()
    assert.equal(c.status, 'failed'); assert.equal(c.failure, 'failure'); assert.equal(c.text, 'call dentist')
    assert.equal(c.error, 'Model unavailable · text saved')
    await s.repo.executeOnLatest('retry', { type: 'retry-capture', captureId: s.id })
    assert.equal((await s.capture()).status, 'organizing')
  } finally { await s.cleanup() }
})

test('the run is timed from its model attempt; a late answer for the expired revision is refused', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.id, 1, at(4 * 60_000))
    assert.equal(await expireStuckCaptures(s.repo, at(captureExpiryMs + 60_000)), 0, 'reserved 2 min ago: still running')
    assert.equal(await expireStuckCaptures(s.repo, at(4 * 60_000 + captureExpiryMs)), 1)
    const late = await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0001, generationId: 'g', now: at(10 * 60_000).toISOString() },
      w => ({ operationId: 'late', expectedRevision: w.revision, action: { type: 'model-failed', captureId: s.id, revision: 1, failure: 'failure', error: 'late' } }))
    assert.ok(late.refused); assert.equal(late.attempt.state, 'settled')
    assert.equal((await s.capture()).error, 'Model unavailable · text saved')
  } finally { await s.cleanup() }
})

test('a Retry that never reserved has no known start and is left alone; a settled capture is never touched', async () => {
  const s = await store()
  try {
    await expireStuckCaptures(s.repo, at(captureExpiryMs))
    await s.repo.executeOnLatest('retry', { type: 'retry-capture', captureId: s.id })
    assert.equal(await expireStuckCaptures(s.repo, at(60 * 60_000)), 0)
    assert.equal((await s.capture()).status, 'organizing')
    await reserve(s.repo, 'a2', s.id, 2, at(60 * 60_000))
    assert.equal(await expireStuckCaptures(s.repo, at(60 * 60_000 + captureExpiryMs)), 1)
    assert.equal(await expireStuckCaptures(s.repo, at(120 * 60_000)), 0)
  } finally { await s.cleanup() }
})
