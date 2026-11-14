// B98's server rule (docs/design/outbox.md §5, §11), the same on both stores: a change from the browser's outbox is
// answered by its receipt when it was applied already, applied when nothing it writes was written by someone else after
// its base, and held otherwise, with nothing written.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerRepository } from '../src/server/repository.ts'
import { OutboxHeld, type OutboxBasis } from '../src/server/outbox-replay.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

export interface OutboxFixture {
  create(): ServerRepository
  /** As if a build without the outbox wrote once: the next commit finds a gap in what was stamped. */
  olderBuildWrote(): Promise<void>
  /** As if every operation so far was forgotten (compacted out on SQLite, pruned by age on Postgres). */
  forgetOperations(repo: ServerRepository): Promise<void>
  cleanup(): Promise<void>
}

const today = '2026-10-22'
const basis = (baseRevision: number, extra: Partial<OutboxBasis> = {}): OutboxBasis => ({ baseRevision, ownRevisions: [], readsBeyond: false, ...extra })
const held = (reason: string, rows?: string[]) => (error: unknown) => error instanceof OutboxHeld && error.reason === reason && (!rows || rows.every(r => error.rows.includes(r)))

async function seeded(repo: ServerRepository): Promise<{ ws: Workspace; day: string; water: string; bank: string }> {
  await repo.execute({ operationId: 'day', expectedRevision: 0, action: { type: 'ensure-day', date: today } })
  const day = (await repo.load()).pages[0]!.id
  await repo.execute({ operationId: 'water', expectedRevision: 1, action: { type: 'add-task', pageId: day, title: 'Water the plants' } })
  await repo.execute({ operationId: 'bank', expectedRevision: 2, action: { type: 'add-task', pageId: day, title: 'Call the bank' } })
  const ws = await repo.load()
  return { ws, day, water: ws.tasks.find(t => t.title === 'Water the plants')!.id, bank: ws.tasks.find(t => t.title === 'Call the bank')!.id }
}
const tick = (taskId: string, status: 'done' | 'open' = 'done'): Action => ({ type: 'task-status', taskId, status, today } as Action)
const rename = (taskId: string, title: string): Action => ({ type: 'rename-task', taskId, title } as Action)
const statusOf = async (repo: ServerRepository, id: string) => (await repo.load()).tasks.find(t => t.id === id)!.status

export function outboxContract(name: string, fixture: () => Promise<OutboxFixture>) {
  test(`${name} outbox: an unrelated write since the base doesn't stop a change; a write to its row does, and nothing is written`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { ws, water, bank } = await seeded(repo)
      const base = ws.revision
      // The desktop renames the other to-do; the phone's tick, made at `base`, still applies.
      await repo.execute({ operationId: 'desk-1', expectedRevision: base, action: rename(bank, 'Call the bank today') })
      const applied = await repo.executeOutbox({ operationId: 'phone-1', expectedRevision: base, action: tick(water) }, basis(base))
      assert.equal(applied.receipt.revision, base + 2, 'the receipt carries the revision it produced')
      assert.equal(await statusOf(repo, water), 'done')
      // The desktop reopens it; an older queued "done" made before that is held, and the store is unchanged.
      await repo.execute({ operationId: 'desk-2', expectedRevision: base + 2, action: tick(water, 'open') })
      const before = await repo.load()
      await assert.rejects(repo.executeOutbox({ operationId: 'phone-2', expectedRevision: base, action: tick(water) }, basis(base)), held('conflict', [`task:${water}`]))
      assert.deepEqual(await repo.load(), before)
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: open → done → open elsewhere holds an old "done" even though the value looks unchanged`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { ws, water } = await seeded(repo), base = ws.revision
      await repo.execute({ operationId: 'd1', expectedRevision: base, action: tick(water) })
      await repo.execute({ operationId: 'd2', expectedRevision: base + 1, action: tick(water, 'open') })
      assert.equal(await statusOf(repo, water), 'open')
      await assert.rejects(repo.executeOutbox({ operationId: 'old-done', expectedRevision: base, action: tick(water) }, basis(base)), held('conflict'))
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: a lost reply is answered by its receipt, applied once; its revision passes on to the next change`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { ws, water } = await seeded(repo), base = ws.revision
      const first = await repo.executeOutbox({ operationId: 'tick', expectedRevision: base, action: tick(water) }, basis(base))
      const again = await repo.executeOutbox({ operationId: 'tick', expectedRevision: base, action: tick(water) }, basis(base))
      assert.equal(again.receipt.revision, first.receipt.revision)
      assert.equal((await repo.load()).revision, base + 1, 'applied once')
      // The rename was made before the tick landed, at the same base: its own predecessor's write isn't a conflict.
      await repo.executeOutbox({ operationId: 'rename', expectedRevision: base, action: rename(water, 'Water the ferns') }, basis(base, { ownRevisions: [first.receipt.revision!] }))
      assert.equal((await repo.load()).tasks.find(t => t.id === water)!.title, 'Water the ferns')
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: a change that reads beyond its writes is applied only if nothing moved since its base`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { ws, water, bank } = await seeded(repo), base = ws.revision
      await repo.executeOutbox({ operationId: 'rb-1', expectedRevision: base, action: tick(water) }, basis(base, { readsBeyond: true }))
      await repo.execute({ operationId: 'other', expectedRevision: base + 1, action: rename(water, 'Water them') })
      await assert.rejects(repo.executeOutbox({ operationId: 'rb-2', expectedRevision: base + 1, action: tick(bank) }, basis(base + 1, { readsBeyond: true })), held('changed-since'))
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: a change older than a stretch an older build wrote unstamped is held, not row-checked`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { ws, water, bank } = await seeded(repo), base = ws.revision
      await f.olderBuildWrote()
      await repo.execute({ operationId: 'after-rollback', expectedRevision: (await repo.load()).revision, action: rename(bank, 'Call the bank today') })
      await assert.rejects(repo.executeOutbox({ operationId: 'before-rollback', expectedRevision: base, action: tick(water) }, basis(base)), held('changed-since'))
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: an unknown change older than the forgotten mark is held, never run again`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { ws, day } = await seeded(repo), base = ws.revision
      await repo.execute({ operationId: 'later', expectedRevision: base, action: { type: 'add-task', pageId: day, title: 'Later' } })
      // A newer one too: the store always keeps its newest operation, so 'later' is among those forgotten.
      await repo.execute({ operationId: 'newest', expectedRevision: base + 1, action: { type: 'add-task', pageId: day, title: 'Newest' } })
      await f.forgetOperations(repo)
      const before = await repo.load()
      await assert.rejects(repo.executeOutbox({ operationId: 'never-seen', expectedRevision: base, action: { type: 'add-task', pageId: day, title: 'Made long ago' } }, basis(base)), held('maybe-applied'))
      assert.deepEqual((await repo.load()).tasks.length, before.tasks.length)
    } finally { await f.cleanup() }
  })
}
