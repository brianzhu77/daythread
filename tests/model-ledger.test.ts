import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { modelStatus } from '../src/server/model-ledger.ts'
import { commandSchema } from '../src/domain/command-schema.ts'

// feat/model step 1 (a): the budget ledger lives beside the workspace, never inside its snapshots.
async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-ledger-')), path = join(dir, 'workspace.sqlite')
  const repo = new SqliteWorkspaceRepository(path)
  let ws = await repo.load()
  ws = (await repo.execute({ operationId: 'day', expectedRevision: ws.revision, action: { type: 'ensure-day', date: '2026-10-19' } })).workspace
  ws = (await repo.execute({ operationId: 'cap', expectedRevision: ws.revision, action: { type: 'capture', pageId: ws.pages[0]!.id, text: 'call dentist' } })).workspace
  return { dir, path, repo, captureId: ws.captures[0]!.id, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
const now = '2026-10-19T17:00:00.000Z'
const reserve = (repo: SqliteWorkspaceRepository, id: string, captureId: string, upperBoundUsd = 0.005, day = '2026-10-19') =>
  repo.reserveModelAttempt({ id, captureId, revision: 1, day, upperBoundUsd, model: 'deepseek/deepseek-v4.1-flash-1017', now })
const run = (path: string, script: string) => new Promise<string>((ok, fail) => { const c = spawn(process.execPath, [script, path]); let s = ''; c.stdout.on('data', d => s += d); c.stderr.on('data', d => s += d); c.on('exit', code => code === 0 ? ok(s) : fail(new Error(s))) })

test('one paid call in flight; settling frees the next; a replayed reservation is no new charge', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.captureId)
    await assert.rejects(reserve(s.repo, 'a2', s.captureId), /in-flight or unknown/)
    assert.equal((await reserve(s.repo, 'a1', s.captureId)).id, 'a1')
    await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0002, generationId: 'gen-1', now })
    await reserve(s.repo, 'a2', s.captureId)
    assert.equal((await s.repo.modelAttempts()).length, 2)
  } finally { await s.cleanup() }
})

test('10 USD per Vancouver day: spent + this call\'s worst case may not pass the cap', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'big', s.captureId, 9.8)
    await s.repo.recordModelResult({ attemptId: 'big', actualUsd: 9.8, generationId: null, now })
    await assert.rejects(reserve(s.repo, 'next', s.captureId, 0.3), /Daily budget reached/)
    await reserve(s.repo, 'tomorrow', s.captureId, 0.3, '2026-10-20')
  } finally { await s.cleanup() }
})

test('a missing cost stays unknown and blocks; reconcile takes an amount or the worst case, never zero by default', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.captureId, 0.004)
    await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: null, generationId: null, now })
    assert.equal((await s.repo.modelAttempts())[0]!.state, 'unknown')
    assert.equal(modelStatus(await s.repo.modelAttempts(), '2026-10-19').state, 'paused')
    await assert.rejects(reserve(s.repo, 'a2', s.captureId), /in-flight or unknown/)
    const settled = await s.repo.reconcileModelAttempt('a1', 'worst-case', now)
    assert.equal(settled.actualUsd, 0.004); assert.equal(settled.state, 'settled')
    await reserve(s.repo, 'a2', s.captureId)
  } finally { await s.cleanup() }
})

test('the first record wins: the same values again are a no-op, different values are refused', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.captureId)
    await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0002, generationId: 'gen-1', now })
    await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0002, generationId: 'gen-1', now })
    await assert.rejects(s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0009, generationId: 'gen-1', now }), /already settled with different values/)
    assert.equal((await s.repo.modelAttempts())[0]!.actualUsd, 0.0002)
  } finally { await s.cleanup() }
})

test('a charge above its reservation pauses further calls', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.captureId, 0.001)
    await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.002, generationId: null, now })
    assert.equal(modelStatus(await s.repo.modelAttempts(), '2026-10-19').state, 'paused')
    await assert.rejects(reserve(s.repo, 'a2', s.captureId), /in-flight or unknown/)
  } finally { await s.cleanup() }
})

test('Lead (a) check 1: Undo, which restores a whole before-snapshot, leaves every ledger row as it was', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.captureId)
    await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0002, generationId: 'gen-1', now })
    const before = await s.repo.modelAttempts()
    let ws = await s.repo.load()
    ws = (await s.repo.execute({ operationId: 'edit', expectedRevision: ws.revision, action: { type: 'add-task', pageId: ws.pages[0]!.id, sectionId: ws.pages[0]!.sections[0]!.id, title: 'x' } })).workspace
    await s.repo.execute({ operationId: 'undo', expectedRevision: ws.revision, action: { type: 'undo', targetOperationId: 'edit' } })
    assert.deepEqual(await s.repo.modelAttempts(), before)
  } finally { await s.cleanup() }
})

test('Lead (a) check 2: a failure after both writes rolls back the settlement and the workspace change together', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.captureId)
    const ws = await s.repo.load()
    const command = { operationId: 'apply', expectedRevision: ws.revision, action: { type: 'add-task' as const, pageId: ws.pages[0]!.id, sectionId: ws.pages[0]!.sections[0]!.id, title: 'from model' } }
    await assert.rejects(s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0002, generationId: 'gen-1', now }, command, { failAfterWrite: true }), /injected failure/)
    assert.equal((await s.repo.modelAttempts())[0]!.state, 'reserved')
    assert.equal((await s.repo.load()).revision, ws.revision)
    // Without the failure both land in one go.
    const done = await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0002, generationId: 'gen-1', now }, command)
    assert.equal(done.attempt.state, 'settled'); assert.equal(done.result!.workspace.revision, ws.revision + 1)
  } finally { await s.cleanup() }
})

test('a result the domain refuses (the capture moved on) is still paid for, and applies nothing', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.captureId)
    const ws = await s.repo.load()
    // The simulated capture is already applied, so discarding it now is refused by the domain.
    const stale = { operationId: 'apply', expectedRevision: ws.revision, action: { type: 'discard-capture' as const, captureId: s.captureId } }
    const r = await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0002, generationId: 'gen-1', now }, stale)
    assert.equal(r.attempt.state, 'settled'); assert.ok(r.refused); assert.equal(r.result, undefined)
    assert.equal((await s.repo.load()).revision, ws.revision)
  } finally { await s.cleanup() }
})

test('after a restart, an attempt still marked in flight becomes unknown and keeps blocking', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.captureId)
    assert.equal(await new SqliteWorkspaceRepository(s.path).markInterruptedModelAttempts(now), 1)
    assert.equal((await s.repo.modelAttempts())[0]!.state, 'unknown')
  } finally { await s.cleanup() }
})

test('the browser cannot send ledger operations: they are not commands', () => {
  for (const type of ['reserve-model-attempt', 'record-model-result', 'reconcile-model-attempt'])
    assert.equal(commandSchema.safeParse({ type }).success, false)
})

test('rollback 3 → 2 keeps the ledger (and a JSON copy); rolling forward again finds the same spend', async () => {
  const s = await store()
  try {
    await reserve(s.repo, 'a1', s.captureId, 0.004)
    await s.repo.recordModelResult({ attemptId: 'a1', actualUsd: 0.0003, generationId: 'gen-1', now })
    await reserve(s.repo, 'a2', s.captureId, 0.004)
    await s.repo.recordModelResult({ attemptId: 'a2', actualUsd: null, generationId: null, now })
    const before = await s.repo.modelAttempts()
    // Step (b) creates "organizing" captures; here one is set directly to stand for a call cut off by the rollback.
    const setup = new DatabaseSync(s.path); setup.prepare("UPDATE captures SET status='organizing'").run(); setup.close()
    const out = await run(s.path, 'scripts/sqlite-rollback-model.ts')
    assert.match(out, /Layout 3 → 2\. 1 capture marked failed \(text kept\); ledger kept \(2 attempts\)/)
    const db = new DatabaseSync(s.path)
    assert.equal(Number(db.prepare('PRAGMA user_version').get()!.user_version), 2)
    assert.equal(db.prepare('PRAGMA table_info(captures)').all().some(c => c.name === 'model' || c.name === 'mode'), false)
    assert.equal(Number(db.prepare('SELECT count(*) n FROM model_attempts').get()!.n), 2)
    for (const row of db.prepare('SELECT * FROM captures').all()) assert.equal(JSON.stringify(row).includes('"model"') || JSON.stringify(row).includes('"mode"'), false)
    assert.equal(db.prepare("SELECT status, text FROM captures WHERE snapshot='current'").get()!.text, 'call dentist')
    db.close()
    const again = new SqliteWorkspaceRepository(s.path)
    assert.equal((await again.load()).captures[0]!.status, 'failed')
    assert.deepEqual(await again.modelAttempts(), before)
    assert.equal(modelStatus(before, '2026-10-19').state, 'paused')
  } finally { await s.cleanup() }
})
