// B98's queue selection and drain (docs/design/outbox.md §6, §7; Lead 150bd86f, Ratchet 006210e1), checked by seeded
// random runs against a reference model written separately from `schedule()`: two or three tabs of one browser share a
// store and a lock; changes are added (also while a send is on its way), held, discarded, kept, acknowledged; tabs close;
// the server goes away, fails or is an older build; the device's storage fails. On a failure the seed and the steps are
// printed. Replay one with OUTBOX_SEED=<seed>; OUTBOX_RUNS sets how many.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drainQueue, memoryOutboxStore, outboxCounts, schedule, type OutboxEntry, type OutboxStore, type SendAnswer } from '../src/components/outbox.ts'
import type { Action, Receipt, Workspace } from '../src/domain/types.ts'

function prng(seed: number) {
  let a = seed >>> 0
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!, chance: (p: number) => next() < p }
}

// ---- The reference model: what must wait, from the contract's words, not from the code under test.
/** §6: a change depends on an earlier one when they write the same row, it names a row the earlier one wrote, or it reads beyond its own writes. */
/** The id in a row key: everything after the first colon, as ids may hold colons themselves (`page:day:2026-11-14`). */
const rowId = (key: string) => key.slice(key.indexOf(':') + 1)
function needs(later: OutboxEntry, earlier: OutboxEntry): boolean {
  if (later.readsBeyond) return true
  for (const key of later.writes) if (earlier.writes.includes(key)) return true
  for (const id of later.refs) if (earlier.writes.some(key => rowId(key) === id)) return true
  return false
}
/** The held changes of his a pending change waits on: directly, or through an earlier change that itself waits. */
function oracle(queue: readonly OutboxEntry[]): Map<number, Set<number>> {
  const bySeq = new Map(queue.map(e => [e.seq!, e]))
  const memo = new Map<number, Set<number>>()
  const roots = (e: OutboxEntry): Set<number> => {
    const known = memo.get(e.seq!)
    if (known) return known
    const out = new Set<number>()
    for (const f of bySeq.values()) {
      if (f.seq! >= e.seq! || !needs(e, f)) continue
      if (f.state === 'held') { if (!f.app) out.add(f.seq!) }
      else for (const r of roots(f)) out.add(r)
    }
    memo.set(e.seq!, out)
    return out
  }
  const waiting = new Map<number, Set<number>>()
  for (const e of bySeq.values()) if (e.state === 'pending') { const r = roots(e); if (r.size) waiting.set(e.seq!, r) }
  return waiting
}

function checkSplit(queue: OutboxEntry[]): void {
  const plan = schedule(queue), want = oracle(queue)
  const pending = queue.filter(e => e.state === 'pending').map(e => e.seq!).sort((a, b) => a - b)
  const sendable = plan.sendable.map(e => e.seq!)
  // A partition: every pending entry exactly once, sendable or waiting; sendable strictly by seq.
  assert.deepEqual([...sendable, ...plan.waiting.keys()].sort((a, b) => a - b), pending, 'pending = sendable + waiting, once each')
  for (let i = 1; i < sendable.length; i++) assert.ok(sendable[i]! > sendable[i - 1]!, 'sendable in strictly increasing seq')
  assert.deepEqual(plan.held.map(e => e.seq), queue.filter(e => e.state === 'held').map(e => e.seq).sort((a, b) => a! - b!), 'held = the held entries')
  // Waiting exactly as the model says, with the same held roots.
  assert.deepEqual([...plan.waiting.keys()].sort((a, b) => a - b), [...want.keys()].sort((a, b) => a - b), 'waiting = the model\'s waiting')
  for (const [seq, roots] of want) assert.deepEqual(plan.waiting.get(seq), [...roots].sort((a, b) => a - b), `roots of ${seq}`)
  // The banner's counts (Jazz b6c71626): what waits on the shown hold, and his changes to send, the app's own aside.
  const counts = outboxCounts(queue), shown = queue.filter(e => e.state === 'held' && !e.app).sort((a, b) => a.seq! - b.seq!)[0] ?? null
  assert.equal(counts.held?.seq ?? null, shown?.seq ?? null, 'the oldest held change of his is shown')
  assert.equal(counts.waiting, shown ? [...want].filter(([seq, roots]) => roots.has(shown.seq!) && !queue.find(e => e.seq === seq)!.app).length : 0, 'waiting count')
  assert.equal(counts.pending, queue.filter(e => e.state === 'pending' && !e.app).length, 'pending count')
}

test('schedule() splits a queue as the reference model does (random queues)', () => {
  const runs = Number(process.env.OUTBOX_RUNS ?? 3000)
  for (let seed = 1; seed <= runs; seed++) {
    const r = prng(seed), queue: OutboxEntry[] = []
    const n = 1 + r.int(12)
    for (let i = 0; i < n; i++) queue.push(made(r, i + 1, r.chance(0.25) ? 'held' : 'pending'))
    try { checkSplit(r.chance(0.5) ? queue.reverse() : queue) }
    catch (error) { throw new Error(`seed ${seed}: ${(error as Error).message}\n${JSON.stringify(queue.map(e => ({ seq: e.seq, state: e.state, writes: e.writes, refs: e.refs, rb: e.readsBeyond, app: e.app })))}`) }
  }
})

const rows = ['task:a', 'task:b', 'task:c', 'page:p1', 'page:p2', 'page:day:2026-11-14', 'page:day:2026-11-15']
function made(r: ReturnType<typeof prng>, seq: number | undefined, state: OutboxEntry['state'], base = 0, owner = 'me'): OutboxEntry {
  const write = r.pick(rows), id = rowId(write)
  const app = r.chance(0.12)
  const refs = r.chance(0.3) ? [id, rowId(r.pick(rows))] : [id]
  return {
    ...(seq !== undefined ? { seq } : {}), owner, operationId: `op-${r.next().toString(36).slice(2, 10)}`,
    action: { type: app ? 'ensure-day' : 'task-status' } as unknown as Action,
    baseRevision: base, ownRevisions: [], readsBeyond: !app && r.chance(0.1), writes: app ? ['page:day'] : [write], refs, label: write,
    createdAt: 0, state, ...(app ? { app: true } : {}),
  }
}

// ---- The drain, across tabs, against a model server.
type Mode = 'up' | 'offline' | 'failed' | 'missing'

test('the locked drain sends only what may go, in order, never holds on a passing failure, and leaves nothing once holds are resolved', async () => {
  const runs = Number(process.env.OUTBOX_RUNS ?? 3000), only = process.env.OUTBOX_SEED ? Number(process.env.OUTBOX_SEED) : null
  for (let seed = only ?? 1; seed <= (only ?? runs); seed++) {
    const trace: string[] = []
    try { await run(seed, trace) }
    catch (error) { throw new Error(`seed ${seed} failed: ${(error as Error).message}\nsteps:\n  ${trace.join('\n  ')}`) }
  }
})

async function run(seed: number, trace: string[]): Promise<void> {
  const r = prng(seed)
  const inner = memoryOutboxStore()
  let storageFails = false
  const failing = <T,>(fn: () => Promise<T>) => (storageFails && r.chance(0.5) ? Promise.reject(new Error('storage failed')) : fn())
  const store: OutboxStore = {
    add: e => inner.add(e), all: () => failing(() => inner.all()), acknowledge: (s, o, v) => failing(() => inner.acknowledge(s, o, v)),
    update: (s, p) => failing(() => inner.update(s, p)), remove: s => inner.remove(s), clearOwner: o => inner.clearOwner(o),
  }
  // The server: rows edited elsewhere at a revision; a change based before an edit to a row it writes is held.
  let revision = 10, mode: Mode = 'up'
  const editedAt = new Map<string, number>(), applied: OutboxEntry[] = [], receipts = new Set<string>()
  const discarded = new Set<string>(), dropped = new Set<string>(), all = new Map<string, OutboxEntry>()
  const tabs = Array.from({ length: 2 + r.int(2) }, (_, i) => ({ id: i, open: true }))
  let locked: Promise<unknown> = Promise.resolve()
  const lock = <T,>(fn: () => Promise<T>): Promise<T> => { const p = locked.then(fn); locked = p.catch(() => undefined); return p }

  const add = async (tab: number) => {
    const e = made(r, undefined, 'pending', revision)
    const seq = await store.add(e)
    all.set(e.operationId, { ...e, seq })
    trace.push(`tab ${tab} adds ${seq} (${e.app ? 'app ' : ''}${e.writes} refs ${e.refs}${e.readsBeyond ? ' readsBeyond' : ''}, base ${revision})`)
  }
  const oldestHeld = async () => (await inner.all()).filter(e => e.state === 'held' && !e.app).sort((a, b) => a.seq! - b.seq!)[0]
  const discard = async (tab: number) => { const h = await oldestHeld(); if (!h) return; await inner.remove(h.seq!); discarded.add(h.operationId); trace.push(`tab ${tab} discards ${h.seq}`) }
  const keep = async (tab: number) => { const h = await oldestHeld(); if (!h) return; await inner.update(h.seq!, { state: 'pending', baseRevision: revision, ownRevisions: [], held: undefined }); trace.push(`tab ${tab} keeps ${h.seq} on ${revision}`) }
  const elsewhere = () => { const row = r.pick(rows); revision++; editedAt.set(row, revision); trace.push(`elsewhere edits ${row} at ${revision}`) }

  const send = async (e: OutboxEntry): Promise<SendAnswer> => {
    // Under the lock, at the moment of sending: the model says it may go, and nothing earlier may.
    const queue = await inner.all(), want = oracle(queue)
    const may = queue.filter(x => x.state === 'pending' && !want.has(x.seq!)).map(x => x.seq!)
    assert.equal(e.state, 'pending', `${e.seq} sent while held`)
    assert.ok(!want.has(e.seq!), `${e.seq} sent while it waits on ${[...(want.get(e.seq!) ?? [])]}`)
    assert.equal(e.seq, Math.min(...may), `${e.seq} sent before ${Math.min(...may)}, which may go too`)
    // Meanwhile another tab adds, discards, or the world moves (Ratchet: add during send, discard from another tab).
    if (r.chance(0.3)) { const k = r.int(3); if (k === 0) await add(r.int(tabs.length)); else if (k === 1) await discard(r.int(tabs.length)); else elsewhere() }
    if (mode !== 'up') { trace.push(`  send ${e.seq}: ${mode}`); return mode === 'failed' ? { status: 'failed', message: '503' } : { status: mode } }
    if (receipts.has(e.operationId)) { trace.push(`  send ${e.seq}: already applied`); return { status: 'already-applied' } }
    if (e.writes.some(k => (editedAt.get(k) ?? 0) > e.baseRevision)) {
      if (e.app) dropped.add(e.operationId)
      trace.push(`  send ${e.seq}: held`); return { status: 'held', reason: 'conflict' }
    }
    revision++; receipts.add(e.operationId); applied.push(e)
    trace.push(`  send ${e.seq}: applied at ${revision}`)
    return { status: 'applied', workspace: { revision } as Workspace, receipt: { operationId: e.operationId, revision } as Receipt }
  }
  const drain = async (tab: number) => {
    trace.push(`tab ${tab} drains`)
    try {
      const result = await lock(() => drainQueue(store, 'me', send))
      if (result.stop) {
        // A passing failure is never a hold (Bumblebee 21ea27de): the entry stays pending, and nothing after it was sent.
        const left = (await inner.all()).find(e => e.seq === result.stop!.seq)
        if (result.stop.answer.status !== 'failed' || left) assert.equal(left?.state, 'pending', `${result.stop.seq} not left pending after ${result.stop.answer.status}`)
      } else if (!storageFails) assert.deepEqual(schedule(await inner.all()).sendable.map(e => e.seq), [], 'a finished drain leaves nothing sendable')
    } catch (error) {
      if (!/storage failed/.test((error as Error).message)) throw error
      trace.push('  storage failed')
    }
    checkSplit(await inner.all())
  }

  const steps = 10 + r.int(40)
  for (let i = 0; i < steps; i++) {
    const open = tabs.filter(t => t.open)
    const tab = open.length ? r.pick(open).id : -1
    const k = r.int(100)
    if (tab < 0) { tabs[0]!.open = true; trace.push('tab 0 opens'); continue }
    if (k < 30) { await add(tab); if (r.chance(0.5)) await drain(tab) }
    else if (k < 50) await drain(tab)
    else if (k < 58) elsewhere()
    else if (k < 66) { mode = r.pick(['up', 'up', 'offline', 'failed', 'missing'] as const); trace.push(`server ${mode}`) }
    else if (k < 71) { storageFails = !storageFails; trace.push(`storage ${storageFails ? 'fails' : 'works'}`) }
    else if (k < 79) await discard(tab)
    else if (k < 85) await keep(tab)
    else if (k < 92) { if (open.length > 1) { tabs[tab]!.open = false; trace.push(`tab ${tab} closes`) } }
    else { const closed = tabs.filter(t => !t.open); if (closed.length) { r.pick(closed).open = true; trace.push('a tab opens') } }
  }

  // Liveness (Ratchet 006210e1): server up, storage working, holds resolved, a trigger runs: the queue empties.
  mode = 'up'; storageFails = false
  const tab = tabs.find(t => t.open)?.id ?? 0
  for (let i = 0; i < 100; i++) {
    await drain(tab)
    if (!(await oldestHeld())) break
    await discard(tab)
  }
  await drain(tab)
  assert.deepEqual((await inner.all()).map(e => e.seq), [], 'nothing left once nothing is held')
  // Every change made reached the server once, unless he discarded it or the app's own write was dropped.
  const once = new Map<string, number>()
  for (const e of applied) once.set(e.operationId, (once.get(e.operationId) ?? 0) + 1)
  for (const [op, n] of once) assert.equal(n, 1, `${op} applied ${n} times`)
  for (const [op, e] of all) assert.ok(once.has(op) || discarded.has(op) || dropped.has(op), `${e.seq} neither applied, discarded nor dropped`)
  // Among dependants, the server saw them in seq order.
  for (let i = 0; i < applied.length; i++) for (let j = i + 1; j < applied.length; j++) {
    const [x, y] = [all.get(applied[i]!.operationId)!, all.get(applied[j]!.operationId)!]
    assert.ok(!(x.seq! > y.seq! && needs(x, y)), `${x.seq} applied before ${y.seq}, which it depends on`)
  }
}
