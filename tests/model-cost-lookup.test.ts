import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { lookupGenerationCost, recoverUnknownCosts } from '../src/server/model/cost-lookup.ts'

// The /generation lookup (Ratchet's review points): only a finite, non-negative total_cost counts (0 included); a
// failure, a 404 or a timeout is never zero; parallel or repeated lookups settle once and touch only the ledger.
const config = { apiKey: 'k', model: 'fake/model', baseUrl: 'https://fake.invalid/api/v1' }
const now = '2026-10-19T17:00:00.000Z'
const answer = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as typeof fetch

test('only a finite, non-negative total_cost counts; 0 is a real cost; errors and timeouts are not', async () => {
  assert.equal(await lookupGenerationCost(config, 'g', answer({ data: { total_cost: 0.0004 } })), 0.0004)
  assert.equal(await lookupGenerationCost(config, 'g', answer({ data: { total_cost: 0 } })), 0)
  for (const bad of [{ data: { total_cost: -1 } }, { data: { total_cost: '0.1' } }, { data: { total_cost: null } }, { data: {} }, {}, []])
    assert.equal(await lookupGenerationCost(config, 'g', answer(bad)), null)
  assert.equal(await lookupGenerationCost(config, 'g', answer({ data: { total_cost: 0.0004 } }, 404)), null)
  assert.equal(await lookupGenerationCost(config, 'g', (async () => new Response('not json')) as typeof fetch), null)
  const hangs = ((_: unknown, init?: RequestInit) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))) as typeof fetch
  const started = Date.now()
  assert.equal(await lookupGenerationCost(config, 'g', hangs, 50), null)
  assert.ok(Date.now() - started < 1000)
})

test('the request asks for that generation with the key, and nothing else', async () => {
  let seen: [string, string | null] | null = null
  await lookupGenerationCost(config, 'gen 1/2', (async (url: string | URL, init?: RequestInit) => { seen = [String(url), new Headers(init!.headers).get('authorization')]; return Response.json({ data: { total_cost: 0 } }) }) as typeof fetch)
  assert.deepEqual(seen, ['https://fake.invalid/api/v1/generation?id=gen%201%2F2', 'Bearer k'])
})

async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-lookup-')), repo = new SqliteWorkspaceRepository(join(dir, 'w.sqlite'))
  let ws = await repo.load()
  ws = (await repo.execute({ operationId: 'day', expectedRevision: ws.revision, action: { type: 'ensure-day', date: '2026-10-19' } })).workspace
  const add = async (id: string, generationId: string | null) => {
    await repo.reserveModelAttempt({ id, subject: { kind: 'capture', id, revision: 1 }, day: '2026-10-19', upperBoundUsd: 0.004, model: 'fake/model', requestHash: id, now })
    await repo.recordModelResult({ attemptId: id, actualUsd: null, generationId, now })
  }
  return { repo, add, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('parallel and repeated lookups settle an unknown attempt once; the workspace is untouched', async () => {
  const s = await store()
  try {
    await s.add('a1', 'gen-1')
    const before = await s.repo.load()
    const results = await Promise.all([1, 2, 3].map(() => recoverUnknownCosts(s.repo, config, { fetchImpl: answer({ data: { total_cost: 0.0004 } }) })))
    assert.equal(results.reduce((x, y) => x + y, 0), 1)
    assert.equal(await recoverUnknownCosts(s.repo, config, { fetchImpl: answer({ data: { total_cost: 0.0009 } }) }), 0)
    const [a] = await s.repo.modelAttempts()
    assert.equal(a!.state, 'settled'); assert.equal(a!.actualUsd, 0.0004); assert.equal(a!.note, 'settled from OpenRouter /generation')
    assert.deepEqual(await s.repo.load(), before)
  } finally { await s.cleanup() }
})

test('estimated attempts (no generation id) are never looked up or settled by it', async () => {
  const s = await store()
  try {
    await s.add('a1', null)
    let calls = 0
    assert.equal(await recoverUnknownCosts(s.repo, config, { fetchImpl: (async () => (calls++, Response.json({ data: { total_cost: 0 } }))) as typeof fetch }), 0)
    assert.equal(calls, 0); assert.equal((await s.repo.modelAttempts())[0]!.state, 'estimated')
  } finally { await s.cleanup() }
})

test('a cost above the reservation still settles, and pauses calls as any over-reservation does', async () => {
  const s = await store()
  try {
    await s.add('a1', 'gen-1')
    assert.equal(await recoverUnknownCosts(s.repo, config, { fetchImpl: answer({ data: { total_cost: 0.05 } }) }), 1)
    const { modelStatus } = await import('../src/server/model-ledger.ts')
    assert.equal(modelStatus(await s.repo.modelAttempts(), '2026-10-19').state, 'paused')
  } finally { await s.cleanup() }
})
