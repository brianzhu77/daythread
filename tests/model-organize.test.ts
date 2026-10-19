import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { organizeCapture } from '../src/server/model/organize.ts'
import { resetPriceCache } from '../src/server/model/pricing.ts'
import { commandSchema } from '../src/domain/command-schema.ts'

// feat/model step 1 (b): organizing a capture against a fake OpenRouter. No network, no cost.
const config = { apiKey: 'test-key', model: 'fake/model', baseUrl: 'https://fake.invalid/api/v1' }
const now = () => new Date('2026-10-19T16:00:00Z') // Mon 2026-10-19 09:00 Vancouver
type Item = Record<string, unknown>
const flat = (i: Item) => ({ kind: 'task', title: null, text: null, detail: null, date: null, dateRole: null, time: null, partOfDay: null, url: null, note: null, followUpDate: null, taskId: null, markDone: null, newDate: null, ...i })
function fakeProvider(answer: (body: { messages: { content: string }[] }) => Item[] | 'timeout' | number | Response, opts: { cost?: number | null; calls?: { n: number } } = {}): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fake/model', pricing: { prompt: '0.0000003', completion: '0.0000012' } }] })
    if (opts.calls) opts.calls.n++
    const body = JSON.parse(String(init!.body))
    const a = answer(body)
    if (a === 'timeout') { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e }
    if (typeof a === 'number') return new Response('{}', { status: a })
    if (a instanceof Response) return a
    return Response.json({ id: 'gen-1', choices: [{ message: { content: JSON.stringify({ items: a.map(flat) }) }, finish_reason: 'stop' }], usage: { cost: opts.cost === undefined ? 0.0002 : opts.cost, prompt_tokens: 600, completion_tokens: 200 } })
  }) as typeof fetch
}
async function store(text: string, extraTask?: string) {
  resetPriceCache()
  const dir = await mkdtemp(join(tmpdir(), 'daythread-organize-')), repo = new SqliteWorkspaceRepository(join(dir, 'w.sqlite'))
  let ws = await repo.load()
  ws = (await repo.execute({ operationId: 'day', expectedRevision: ws.revision, action: { type: 'ensure-day', date: '2026-10-19' } })).workspace
  if (extraTask) ws = (await repo.execute({ operationId: 'task', expectedRevision: ws.revision, action: { type: 'add-task', pageId: ws.pages[0]!.id, sectionId: ws.pages[0]!.sections[0]!.id, title: extraTask } })).workspace
  const r = await repo.execute({ operationId: 'cap', expectedRevision: ws.revision, action: { type: 'capture-for-model', pageId: ws.pages[0]!.id, text, model: 'fake/model' } })
  return { repo, captureId: r.receipt.entityId!, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
const capture = async (repo: SqliteWorkspaceRepository, id: string) => (await repo.load()).captures.find(c => c.id === id)!

test('auto: grounded new items save at once with their dates; held and update items wait; the cost is settled', async () => {
  const s = await store('Lunch with Kevin next Mon 12:30, 周五前把 TFLOW PR 提了, Tax return 搞定了', 'Tax Return')
  try {
    const taxId = (await s.repo.load()).tasks[0]!.id
    const fetchImpl = fakeProvider(() => [
      { kind: 'event', title: 'Lunch with Kevin', date: '2026-10-26', time: '12:30' },
      { kind: 'task', title: 'TFLOW PR', date: '2026-10-23', dateRole: 'due' },
      { kind: 'event', title: 'Rewind', date: '2026-10-19', time: '14:30' }, // invented: held
      { kind: 'update', taskId: taxId, markDone: true },
    ])
    assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl, now }, s.captureId), 'organized')
    const ws = await s.repo.load(), c = ws.captures.find(c => c.id === s.captureId)!
    assert.equal(c.status, 'needs_confirmation')
    const byTitle = Object.fromEntries(c.proposals!.map(p => [p.title, p]))
    assert.equal(byTitle['Lunch with Kevin']!.state, 'applied'); assert.equal(byTitle['TFLOW PR']!.state, 'applied')
    assert.equal(byTitle['Rewind']!.state, undefined); assert.deepEqual(byTitle['Rewind']!.flags, ['title-not-grounded', 'time-not-in-text'])
    assert.equal(byTitle['Tax Return']!.state, undefined) // updates always wait
    assert.equal(ws.events.find(e => e.title === 'Lunch with Kevin')!.time, '12:30')
    assert.equal(ws.tasks.find(t => t.title === 'TFLOW PR')!.deadlineOn, '2026-10-23')
    assert.equal(ws.tasks.find(t => t.title === 'Tax Return')!.status, 'open')
    const [attempt] = await s.repo.modelAttempts()
    assert.equal(attempt!.state, 'settled'); assert.equal(attempt!.actualUsd, 0.0002)
  } finally { await s.cleanup() }
})

test('a do date places the task on that day; Apply later applies the waiting update with its version check', async () => {
  const s = await store('APPX PR 改成明天再弄', 'Rewind - APPX PR - Provider')
  try {
    const appx = (await s.repo.load()).tasks[0]!
    await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => [{ kind: 'update', taskId: appx.id, markDone: false, newDate: '2026-10-20', dateRole: null }]), now }, s.captureId)
    let ws = await s.repo.load(); const c = ws.captures.find(c => c.id === s.captureId)!
    assert.equal(c.status, 'needs_confirmation'); assert.deepEqual(c.proposals![0]!.flags, [])
    ws = (await s.repo.execute({ operationId: 'apply', expectedRevision: ws.revision, action: { type: 'apply-capture', captureId: c.id, proposalRevision: c.proposalRevision } })).workspace
    assert.equal(ws.tasks.find(t => t.id === appx.id)!.plannedOn, '2026-10-20') // no role on an update = do date
  } finally { await s.cleanup() }
})

test('confirm mode: nothing saves until Apply', async () => {
  const s = await store('call dentist')
  try {
    await organizeCapture({ repository: s.repo, config, mode: 'confirm', fetchImpl: fakeProvider(() => [{ kind: 'task', title: 'call dentist' }]), now }, s.captureId)
    const ws = await s.repo.load()
    assert.equal(ws.captures[0]!.status, 'needs_confirmation'); assert.equal(ws.tasks.length, 0)
  } finally { await s.cleanup() }
})

test('parts that can\'t be read are counted and shown, never applied', async () => {
  const s = await store('call dentist')
  try {
    await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => [{ kind: 'task', title: 'call dentist' }, { kind: 'update', taskId: 'no-such-task', markDone: true }, { kind: 'task', title: 'x', date: '2026-02-31' }]), now }, s.captureId)
    const c = await capture(s.repo, s.captureId)
    assert.equal(c.error, "2 parts weren't saved as items"); assert.equal(c.status, 'applied')
    assert.equal((await s.repo.load()).tasks.length, 1)
  } finally { await s.cleanup() }
})

test('timeout: text kept, capture failed, the charge stays unknown and the model pauses', async () => {
  const s = await store('call dentist')
  try {
    assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => 'timeout'), now }, s.captureId), 'failed')
    const c = await capture(s.repo, s.captureId)
    assert.equal(c.status, 'failed'); assert.equal(c.text, 'call dentist'); assert.match(c.error!, /took too long/)
    assert.equal((await s.repo.modelAttempts())[0]!.state, 'unknown')
    const next = await s.repo.execute({ operationId: 'cap2', expectedRevision: (await s.repo.load()).revision, action: { type: 'capture-for-model', pageId: c.pageId, text: 'buy milk', model: 'fake/model' } })
    assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => [{ kind: 'task', title: 'buy milk' }]), now }, next.receipt.entityId!), 'paused')
    assert.match((await capture(s.repo, next.receipt.entityId!)).error!, /a charge needs checking/)
  } finally { await s.cleanup() }
})

test('a 401 with no generation or cost is refused before routing: settled at 0 with the reason, the model isn\'t paused', async () => {
  const s = await store('call dentist')
  try {
    await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => 401), now }, s.captureId)
    assert.equal((await capture(s.repo, s.captureId)).error, 'Model key rejected · text saved')
    const [a] = await s.repo.modelAttempts()
    assert.equal(a!.state, 'settled'); assert.equal(a!.actualUsd, 0); assert.match(a!.note!, /refused before routing \(HTTP 401\)/)
    assert.equal((await capture(s.repo, s.captureId)).contextLine, 'Not organized · your text is kept')
  } finally { await s.cleanup() }
})

// Ratchet #69: strict mode is a request to the provider, not a guarantee; every field is checked at run time.
const answerWith = (items: unknown, extra: Record<string, unknown> = {}) => Response.json({ id: 'gen-x', choices: [{ message: { content: JSON.stringify({ items }) }, finish_reason: 'stop' }], usage: { cost: 0.002 }, ...extra })

test('an item with a field of the wrong type is counted as unreadable; the rest saves and the cost is settled', async () => {
  const s = await store('call dentist')
  try {
    assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => answerWith([flat({ title: 'call dentist' }), flat({ title: 23 }), flat({ kind: 'event', title: 'call dentist', partOfDay: 'noon' }), 'not an item'])), now }, s.captureId), 'organized')
    const c = await capture(s.repo, s.captureId)
    assert.equal(c.error, "3 parts weren't saved as items")
    assert.deepEqual((await s.repo.load()).tasks.map(t => t.title), ['call dentist'])
    const [a] = await s.repo.modelAttempts()
    assert.equal(a!.state, 'settled'); assert.equal(a!.actualUsd, 0.002)
  } finally { await s.cleanup() }
})

test('every item unreadable: failed with "Model unavailable", no empty receipt, the reported cost is settled', async () => {
  for (const answer of [answerWith([flat({ title: 23 })]), answerWith('not a list'), answerWith([{ kind: 'task', title: 'call dentist', markDone: 'yes', taskId: 1 }].map(i => ({ ...i, kind: 'update' })))]) {
    const s = await store('call dentist')
    try {
      assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => answer.clone()), now }, s.captureId), 'failed')
      const c = await capture(s.repo, s.captureId)
      assert.equal(c.status, 'failed'); assert.equal(c.error, 'Model unavailable · text saved'); assert.equal(c.text, 'call dentist')
      assert.equal((await s.repo.load()).tasks.length, 0)
      const [a] = await s.repo.modelAttempts()
      assert.equal(a!.state, 'settled'); assert.equal(a!.actualUsd, 0.002); assert.equal(a!.generationId, 'gen-x')
    } finally { await s.cleanup() }
  }
})

test('a date role outside do/due is dropped, so the task waits as "Date unclear"', async () => {
  const s = await store('call dentist tomorrow')
  try {
    await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => answerWith([flat({ title: 'call dentist', date: '2026-10-20', dateRole: 'banana' })])), now }, s.captureId)
    const [p] = (await capture(s.repo, s.captureId)).proposals
    assert.equal(p!.kind, 'create-task'); assert.equal((p as { dateRole: unknown }).dateRole, null); assert.deepEqual(p!.flags, ['date-role-missing'])
    assert.equal((await s.repo.load()).tasks.length, 0)
  } finally { await s.cleanup() }
})

test('an HTTP error never proves nothing was charged: a reported cost is kept, a generation without one stays unknown', async () => {
  const cases: [Response, 'settled' | 'unknown', number | null][] = [
    [Response.json({ id: 'gen-err', error: { message: 'upstream failed' }, usage: { cost: 0.002 } }, { status: 500 }), 'settled', 0.002],
    [Response.json({ id: 'gen-err', error: { message: 'upstream failed' } }, { status: 502 }), 'unknown', null],
    [Response.json({ error: { message: 'provider error' } }, { status: 500 }), 'unknown', null],
    [Response.json({ id: 'gen-err', error: { message: 'bad key' }, usage: { cost: 0.001 } }, { status: 401 }), 'settled', 0.001],
  ]
  for (const [response, state, cost] of cases) {
    const s = await store('call dentist')
    try {
      assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => response.clone()), now }, s.captureId), 'failed')
      const c = await capture(s.repo, s.captureId)
      assert.equal(c.error, response.status === 401 ? 'Model key rejected · text saved' : 'Model unavailable · text saved')
      const [a] = await s.repo.modelAttempts()
      assert.equal(a!.state, state); assert.equal(a!.actualUsd, cost)
      assert.doesNotMatch(a!.note ?? '', /nothing charged/)
      if (state === 'unknown') {
        const next = await s.repo.execute({ operationId: 'cap2', expectedRevision: (await s.repo.load()).revision, action: { type: 'capture-for-model', pageId: c.pageId, text: 'buy milk', model: 'fake/model' } })
        assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => [{ kind: 'task', title: 'buy milk' }]), now }, next.receipt.entityId!), 'paused')
      }
    } finally { await s.cleanup() }
  }
})

test('no price: nothing is reserved or sent', async () => {
  const s = await store('call dentist'), calls = { n: 0 }
  try {
    const noModels = (async (url: string | URL) => String(url).endsWith('/models') ? Response.json({ data: [] }) : (calls.n++, new Response('{}'))) as typeof fetch
    assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: noModels, now }, s.captureId), 'no-price')
    assert.equal(calls.n, 0); assert.equal((await s.repo.modelAttempts()).length, 0)
    assert.match((await capture(s.repo, s.captureId)).error!, /price unavailable/)
  } finally { await s.cleanup() }
})

test('a capture discarded while the call runs: the cost is settled, the result is not applied', async () => {
  const s = await store('call dentist')
  try {
    const fetchImpl = fakeProvider(() => [{ kind: 'task', title: 'call dentist' }])
    const discarding = (async (url: string | URL, init?: RequestInit) => {
      if (!String(url).endsWith('/models')) { const ws = await s.repo.load(); await s.repo.execute({ operationId: 'discard', expectedRevision: ws.revision, action: { type: 'discard-capture', captureId: s.captureId } }) }
      return fetchImpl(url, init)
    }) as typeof fetch
    assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: discarding, now }, s.captureId), 'stale')
    assert.equal((await capture(s.repo, s.captureId)).status, 'discarded')
    assert.equal((await s.repo.load()).tasks.length, 0)
    assert.equal((await s.repo.modelAttempts())[0]!.state, 'settled')
  } finally { await s.cleanup() }
})

test('two runs for the same capture: one call, one result', async () => {
  const s = await store('call dentist'), calls = { n: 0 }
  try {
    const fetchImpl = fakeProvider(() => [{ kind: 'task', title: 'call dentist' }], { calls })
    const results = await Promise.all([1, 2].map(() => organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl, now }, s.captureId)))
    assert.deepEqual(results.sort(), ['organized', 'stale'])
    assert.equal(calls.n, 1); assert.equal((await s.repo.load()).tasks.length, 1)
  } finally { await s.cleanup() }
})

test('budget used up: text kept, nothing sent', async () => {
  const s = await store('call dentist'), calls = { n: 0 }
  try {
    await s.repo.reserveModelAttempt({ id: 'big', captureId: s.captureId, revision: 0, day: '2026-10-19', upperBoundUsd: 9.999, model: 'fake/model', requestHash: 'h', now: 'x' })
    await s.repo.recordModelResult({ attemptId: 'big', actualUsd: 9.999, generationId: null, now: 'x' })
    assert.equal(await organizeCapture({ repository: s.repo, config, mode: 'auto', fetchImpl: fakeProvider(() => [], { calls }), now }, s.captureId), 'paused')
    assert.equal(calls.n, 0); assert.match((await capture(s.repo, s.captureId)).error!, /budget is used up/)
  } finally { await s.cleanup() }
})

test('the browser cannot send the server-only capture actions', () => {
  const command = (action: object) => ({ operationId: 'op', expectedRevision: 0, action })
  assert.equal(commandSchema.safeParse(command({ type: 'capture', pageId: 'p', text: 'x' })).success, true) // the check can pass
  assert.equal(commandSchema.safeParse(command({ type: 'capture-for-model', pageId: 'p', text: 'x', model: 'm' })).success, false)
  assert.equal(commandSchema.safeParse(command({ type: 'organized-capture', captureId: 'c', revision: 1, model: 'm', mode: 'auto', proposals: [], unreadable: 0, contextLine: '' })).success, false)
  assert.equal(commandSchema.safeParse(command({ type: 'model-failed', captureId: 'c', revision: 1, failure: 'failure', error: 'x' })).success, false)
})
