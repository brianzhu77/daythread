import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { draftDayRun, expireStuckDrafts } from '../src/server/model/draft-run.ts'
import { buildDraftRequest } from '../src/server/model/draft-prompt.ts'
import { resetPriceCache } from '../src/server/model/pricing.ts'
import { costUnknownCaptureIds } from '../src/server/model-ledger.ts'
import { editorSeed, inlineText, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, ServerAction, Workspace } from '../src/domain/types.ts'

// A6b step 1 §9: Draft my day against a fake OpenRouter, with a controllable clock. No network, no cost.
const config = { apiKey: 'test-key', model: 'fake/model', baseUrl: 'https://fake.invalid/api/v1' }
const t0 = new Date('2026-10-19T16:00:00Z') // Mon 09:00 Vancouver
const now = () => t0
type Answer = { taskIds?: unknown[]; materialIds?: unknown[]; proposals?: unknown[] } | 'timeout' | number | string
function fake(answer: (lines: string[]) => Answer, opts: { cost?: number | null; calls?: { n: number }; gate?: Promise<void> } = {}): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fake/model', pricing: { prompt: '0.0000003', completion: '0.0000012' } }] })
    if (String(url).includes('/generation?id=')) return new Response('{}', { status: 404 })
    if (opts.calls) opts.calls.n++
    if (opts.gate) await opts.gate
    const body = JSON.parse(String(init!.body)) as { messages: { content: string }[] }
    const lines = [...body.messages[1]!.content.matchAll(/^\[([^\]]+)\] \(/gm)].map(m => m[1]!).filter(id => id.includes('/'))
    const a = answer(lines)
    if (a === 'timeout') { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e }
    if (typeof a === 'number') return new Response('{}', { status: a })
    return Response.json({ id: 'gen-1', choices: [{ message: { content: typeof a === 'string' ? a : JSON.stringify({ taskIds: [], materialIds: [], proposals: [], ...a }) }, finish_reason: 'stop' }], usage: { cost: opts.cost === undefined ? 0.0003 : opts.cost } })
  }) as typeof fetch
}
async function store() {
  resetPriceCache()
  const dir = await mkdtemp(join(tmpdir(), 'daythread-draft-')), repo = new SqliteWorkspaceRepository(join(dir, 'w.sqlite'))
  const exec = async (action: Action | ServerAction, operationId: string = crypto.randomUUID()) => { const ws = await repo.load(); return (await repo.execute({ operationId, expectedRevision: ws.revision, action })).workspace }
  let ws = await exec({ type: 'ensure-day', date: '2026-10-18' })
  const sun = ws.pages[0]!
  const doc = editorSeed(sun, ws), at = doc.findIndex(n => n.type === 'heading' && inlineText(n.content) === 'Notes')
  const lines: EditorNode[] = [{ id: 'n1', type: 'paragraph', content: '周一给 Kevin 回电话' }, { id: 'n2', type: 'paragraph', content: '肉酱意面 #recipe' }]
  ws = await exec({ type: 'save-editor', pageId: sun.id, expectedContent: pageContentKey(sun), document: JSON.stringify([...doc.slice(0, at + 1), ...lines, ...doc.slice(at + 1)]) })
  ws = await exec({ type: 'add-task', pageId: sun.id, sectionId: sun.sections[0]!.id, title: 'Fix export bug' } as Action)
  ws = await exec({ type: 'ensure-day', date: '2026-10-19' })
  const start = (runId: string) => exec({ type: 'start-draft-run', date: '2026-10-19', model: 'fake/model', startedAt: t0.toISOString() }, runId)
  return { repo, exec, start, sun: sun.id, taskId: ws.tasks[0]!.id, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
const draftOf = async (repo: SqliteWorkspaceRepository) => (await repo.load()).pages.find(p => p.date === '2026-10-19')!
const deps = (s: { repo: SqliteWorkspaceRepository }, fetchImpl: typeof fetch, extra: object = {}) => ({ repository: s.repo, config, fetchImpl, now, lookupDelaysMs: [], ...extra })

test('a run: picks only from what was sent, dates checked by the app, manifest and cost recorded on the draft subject', async () => {
  const s = await store()
  try {
    await s.start('r1')
    const fetchImpl = fake(lines => ({
      taskIds: [s.taskId, 'invented-task'],
      proposals: lines.map(id => ({ lineId: id, propose: id.endsWith('/n1'), date: id.endsWith('/n1') ? '2026-10-19' : null })).concat([{ lineId: 'not-sent/x', propose: true, date: null }]),
    }))
    assert.equal(await draftDayRun(deps(s, fetchImpl), '2026-10-19', 'r1'), 'drafted')
    const p = await draftOf(s.repo), d = p.draft!
    assert.equal(d.run!.status, 'ready')
    assert.deepEqual(d.taskIds, [s.taskId])
    assert.deepEqual(d.proposals!.map(x => [x.lineId, x.date]), [[`${s.sun}/n1`, '2026-10-19']])
    assert.deepEqual(d.run!.manifest.lines.map(l => l.lineId), [`${s.sun}/n1`, `${s.sun}/n2`])
    assert.equal(d.run!.requestHash.length, 64)
    const attempts = await s.repo.modelAttempts()
    assert.deepEqual(attempts.map(a => [a.captureId, a.revision, a.state, a.actualUsd]), [['draft:2026-10-19', 1, 'settled', 0.0003]])
    assert.deepEqual(costUnknownCaptureIds(attempts), [])
  } finally { await s.cleanup() }
})

test('empty is a normal answer; every entry invalid or bad JSON is "Model unavailable"', async () => {
  for (const [answer, status, failure] of [
    [{}, 'ready', undefined],
    [{ taskIds: ['x'], proposals: [{ lineId: 'x/y', propose: true, date: null }] }, 'failed', 'unavailable'],
    ['not json at all', 'failed', 'unavailable'],
  ] as const) {
    const s = await store()
    try {
      await s.start('r1')
      await draftDayRun(deps(s, fake(() => answer as Answer)), '2026-10-19', 'r1')
      const p = await draftOf(s.repo)
      assert.equal(p.draft!.run!.status, status)
      assert.equal(p.draft!.run!.failure, failure)
    } finally { await s.cleanup() }
  }
})

test('failures: 401 key rejected (no charge), 500 / timeout unavailable with the cost estimated', async () => {
  for (const [answer, failure, state] of [[401, 'key-rejected', 'settled'], [500, 'unavailable', 'estimated'], ['timeout', 'unavailable', 'estimated']] as const) {
    const s = await store()
    try {
      await s.start('r1')
      await draftDayRun(deps(s, fake(() => answer)), '2026-10-19', 'r1')
      const p = await draftOf(s.repo)
      assert.equal(p.draft!.run!.failure, failure)
      assert.equal(p.draftError, failure === 'key-rejected' ? 'Model key rejected · nothing was added' : 'Model unavailable · nothing was added')
      assert.equal((await s.repo.modelAttempts())[0]!.state, state)
    } finally { await s.cleanup() }
  }
})

test('busy: a capture call in flight ends the run as "Model busy" with nothing reserved; budget used up says so', async () => {
  const s = await store()
  try {
    await s.repo.reserveModelAttempt({ id: 'cap-1', subject: { kind: 'capture', id: 'c', revision: 1 }, day: '2026-10-19', upperBoundUsd: 0.004, model: 'fake/model', requestHash: 'h', now: t0.toISOString() })
    await s.start('r1')
    const calls = { n: 0 }
    await draftDayRun(deps(s, fake(() => ({}), { calls })), '2026-10-19', 'r1')
    assert.equal((await draftOf(s.repo)).draft!.run!.failure, 'busy')
    assert.equal(calls.n, 0)
    assert.deepEqual((await s.repo.modelAttempts()).map(a => a.id), ['cap-1'])
  } finally { await s.cleanup() }
  const b = await store()
  try {
    process.env.DAYTHREAD_MODEL_CAP_USD = '0'
    await b.start('r1')
    await draftDayRun(deps(b, fake(() => ({}))), '2026-10-19', 'r1')
    assert.equal((await draftOf(b.repo)).draft!.run!.failure, 'budget')
  } finally { delete process.env.DAYTHREAD_MODEL_CAP_USD; await b.cleanup() }
})

test('double run of the same runId: one call, one charge', async () => {
  const s = await store()
  try {
    await s.start('r1')
    const calls = { n: 0 }
    const f = fake(() => ({}), { calls })
    assert.equal(await draftDayRun(deps(s, f), '2026-10-19', 'r1'), 'drafted')
    assert.equal(await draftDayRun(deps(s, f), '2026-10-19', 'r1'), 'stale')
    assert.equal(calls.n, 1)
    assert.equal((await s.repo.modelAttempts()).length, 1)
  } finally { await s.cleanup() }
})

test('expiry at 90 s: a persisted failure with Retry; the old answer arriving later settles its cost and publishes nothing', async () => {
  const s = await store()
  try {
    await s.start('r1')
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const pending = draftDayRun(deps(s, fake(lines => ({ proposals: lines.map(id => ({ lineId: id, propose: true, date: null })) }), { gate })), '2026-10-19', 'r1')
    while ((await s.repo.modelAttempts()).length === 0) await new Promise(r => setTimeout(r, 5))
    assert.equal(await expireStuckDrafts(s.repo, new Date(t0.getTime() + 60_000)), 0, 'not yet')
    assert.equal(await expireStuckDrafts(s.repo, new Date(t0.getTime() + 90_000)), 1)
    let p = await draftOf(s.repo)
    assert.deepEqual([p.draft!.run!.status, p.draft!.run!.failure, p.draftError], ['expired', 'unavailable', 'Model unavailable · nothing was added'])
    assert.equal((await s.repo.modelAttempts())[0]!.state, 'estimated', 'freed: Retry can reserve')
    // Retry is a new run; then the old answer arrives.
    await s.start('r2')
    release()
    assert.equal(await pending, 'stale')
    p = await draftOf(s.repo)
    assert.equal(p.draft!.run!.runId, 'r2')
    assert.equal(p.draft!.run!.status, 'drafting')
    assert.equal((await s.repo.modelAttempts()).find(a => a.id.includes('r1'))!.state, 'settled', 'its cost still settles')
    assert.equal(await draftDayRun(deps(s, fake(() => ({}))), '2026-10-19', 'r2'), 'drafted')
  } finally { await s.cleanup() }
})

test('expiry racing a result: only one changes the draft', async () => {
  const s = await store()
  try {
    await s.start('r1')
    assert.equal(await draftDayRun(deps(s, fake(() => ({}))), '2026-10-19', 'r1'), 'drafted')
    assert.equal(await expireStuckDrafts(s.repo, new Date(t0.getTime() + 120_000)), 0)
    assert.equal((await draftOf(s.repo)).draft!.run!.status, 'ready')
  } finally { await s.cleanup() }
})

test('restart: a run left drafting by an earlier process expires at once; an unknown cost shows "Model paused" without Retry', async () => {
  const s = await store()
  try {
    await s.start('r1')
    assert.equal(await expireStuckDrafts(s.repo, t0, { all: true }), 1)
    assert.equal((await draftOf(s.repo)).draft!.run!.failure, 'unavailable')
  } finally { await s.cleanup() }
  const u = await store()
  try {
    await u.start('r1')
    const run = (await draftOf(u.repo)).draft!.run!
    await u.repo.reserveModelAttempt({ id: run.attemptId, subject: { kind: 'draft', date: '2026-10-19', run: 1 }, day: '2026-10-19', upperBoundUsd: 0.004, model: 'fake/model', requestHash: 'h', now: t0.toISOString() })
    await u.repo.recordModelResult({ attemptId: run.attemptId, actualUsd: null, generationId: 'gen-9', now: t0.toISOString() })
    await expireStuckDrafts(u.repo, new Date(t0.getTime() + 95_000))
    const p = await draftOf(u.repo)
    assert.deepEqual([p.draft!.run!.failure, p.draftError], ['paused', "Model paused · a cost couldn't be confirmed · nothing was added"])
  } finally { await u.cleanup() }
})

test('context: the previous day always; linked pages whole until the budget; over budget alone refuses with nothing sent', async () => {
  const s = await store()
  try {
    // Two linked pages on Sun: the first fits, the second doesn't.
    let ws = await s.exec({ type: 'create-document', title: 'Short', body: '', pageId: 'short', parentId: s.sun })
    ws = await s.exec({ type: 'create-document', title: 'Long', body: '', pageId: 'long', parentId: s.sun })
    for (const [id, text] of [['short', 'a short line'], ['long', 'x'.repeat(4000)]]) {
      const p = ws.pages.find(x => x.id === id)!
      ws = await s.exec({ type: 'save-editor', pageId: id, expectedContent: pageContentKey(p), document: JSON.stringify([...editorSeed(p, ws), { id: `${id}-1`, type: 'paragraph', content: text }]) })
    }
    const sun = ws.pages.find(p => p.id === s.sun)!
    ws = await s.exec({ type: 'save-editor', pageId: s.sun, expectedContent: pageContentKey(sun), document: JSON.stringify([...editorSeed(sun, ws), { id: 'c1', type: 'pageLink', props: { pageId: 'short' } }, { id: 'c2', type: 'pageLink', props: { pageId: 'long' } }]) })
    const full = buildDraftRequest(ws, '2026-10-19', config)
    const r = buildDraftRequest(ws, '2026-10-19', config, Buffer.byteLength(full.body) - 1000)
    assert.deepEqual([r.manifest.sentPages, r.manifest.omittedPages], [[s.sun, 'short'], ['long']])
    assert.equal(r.contextLine, "Read yesterday's page and 1 of 2 linked pages")
    assert.equal(r.tooLarge, false)
    assert.equal(full.contextLine, null)
    await s.start('r1')
    const calls = { n: 0 }
    await draftDayRun(deps(s, fake(() => ({}), { calls }), { budgetBytes: 500 }), '2026-10-19', 'r1')
    const p = await draftOf(s.repo)
    assert.deepEqual([p.draft!.run!.failure, p.draftError, calls.n], ['too-large', 'Too much to read in one go · nothing was added', 0])
  } finally { await s.cleanup() }
})

test('Ratchet #80: a replay of the same run while its call is still out follows it; the run keeps its result', async () => {
  const s = await store()
  try {
    await s.start('r1')
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const calls = { n: 0 }
    const f = fake(lines => ({ proposals: lines.map(id => ({ lineId: id, propose: id.endsWith('/n1'), date: null })) }), { gate, calls })
    const first = draftDayRun(deps(s, f), '2026-10-19', 'r1')
    while ((await s.repo.modelAttempts()).length === 0) await new Promise(r => setTimeout(r, 5))
    assert.equal(await draftDayRun(deps(s, f), '2026-10-19', 'r1'), 'stale')
    assert.equal((await draftOf(s.repo)).draft!.run!.status, 'drafting', 'not marked busy')
    release()
    assert.equal(await first, 'drafted')
    assert.equal((await draftOf(s.repo)).draft!.proposals!.length, 1)
    assert.equal(calls.n, 1)
  } finally { await s.cleanup() }
})

test('Ratchet #80: a paid answer about a line with an impossible date is read, not thrown', async () => {
  const s = await store()
  try {
    const ws = await s.repo.load(), sun = ws.pages.find(p => p.id === s.sun)!
    await s.exec({ type: 'save-editor', pageId: s.sun, expectedContent: pageContentKey(sun), document: JSON.stringify([...editorSeed(sun, ws), { id: 'bad', type: 'paragraph', content: 'pay rent 2026-13-40' }]) })
    await s.start('r1')
    assert.equal(await draftDayRun(deps(s, fake(lines => ({ proposals: lines.map(id => ({ lineId: id, propose: id.endsWith('/bad'), date: id.endsWith('/bad') ? '2026-10-23' : null })) }))), '2026-10-19', 'r1'), 'drafted')
    const d = (await draftOf(s.repo)).draft!
    assert.deepEqual(d.proposals!.map(p => [p.blockId, p.date]), [['bad', null]])
  } finally { await s.cleanup() }
})
