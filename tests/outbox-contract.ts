// B98's server rule (docs/design/outbox.md §5, §11), the same on both stores: a change from the browser's outbox is
// answered by its receipt when it was applied already, applied when nothing it writes was written by someone else after
// its base, and held otherwise, with nothing written.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerRepository } from '../src/server/repository.ts'
import { OutboxHeld, type OutboxBasis } from '../src/server/outbox-replay.ts'
import type { Action, Command, Workspace } from '../src/domain/types.ts'
import { runOutbox } from '../src/server/outbox-command.ts'
import { writeSteps, type ButtonStep } from '../src/domain/buttons.ts'
import { firstWidgetView } from '../src/domain/dashboard.ts'
import type { Automation } from '../src/domain/automations.ts'

export interface OutboxFixture {
  create(): ServerRepository
  /** As if a build without the outbox wrote once: the next commit finds a gap in what was stamped. */
  olderBuildWrote(): Promise<void>
  /** As if his data were restored from a backup taken `back` revisions ago (the workspace's revision goes back). */
  restoredFromBackup(back: number): Promise<void>
  /** As if a build that stamps rows but not the parts inside pages wrote once (Lead 62f4818c). */
  partsBehind(): Promise<void>
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

  test(`${name} outbox: a change behind only its own acknowledged writes applies as made, a rule firing included (gate e1a21c80)`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), at = '2026-11-05T10:00:00.000Z'
      let n = 0
      const exec = async (action: unknown) => { const r = (await repo.load()).revision; return repo.execute({ operationId: `s${++n}`, expectedRevision: r, action: action as Action }) }
      await exec({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
      await exec({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'st', name: 'Status', type: 'select', options: [{ id: 'todo', name: 'Todo', color: 'gray' }, { id: 'done', name: 'Done', color: 'gray' }] } } })
      await exec({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { st: 'todo' }, at })
      await exec({ type: 'add-row', databaseId: 'runs', pageId: 'r2', title: 'Two', values: { st: 'todo' }, at })
      // A rule whose step points at a property that isn't there: it pauses when it fires, and his edit stands.
      const step = { id: 's-gone', kind: 'edit-property', set: [{ id: 'gone', name: 'Gone', type: 'number', value: { kind: 'fixed', raw: 5 } }] } as unknown as ButtonStep
      const rule = { id: 'r', name: 'Log finish', active: true, triggers: [{ kind: 'property-edited', propertyId: 'st', name: 'Status', condition: { by: 'st', op: 'isAnyOf', value: ['done'] } }], steps: writeSteps([step]) } as unknown as Automation
      await exec({ type: 'change-database', pageId: 'runs', change: { kind: 'addAutomation', automation: rule } })
      const base = (await repo.load()).revision
      const edit = (id: string, page: string) => ({ operationId: id, expectedRevision: base, action: { type: 'set-values', pageId: page, values: { st: 'done' }, expected: { st: 'todo' }, at } as unknown as Action })
      // His earlier change from the same queue lands first; this one was made on top of it, and reads beyond (it fires the rule).
      const first = await repo.executeOutbox({ operationId: 'own-1', expectedRevision: base, action: { type: 'rename-page', pageId: 'r2', title: 'Two!' } as Action }, basis(base))
      const own = first.workspace.revision
      const second = await repo.executeOutbox(edit('own-2', 'r1'), basis(base, { ownRevisions: [own], readsBeyond: true }))
      const ws = await repo.load()
      assert.equal(ws.pages.find(p => p.id === 'r1')!.values!.st, 'done', 'his edit lands')
      assert.equal(second.receipt.automations?.paused.length, 1, 'the rule pauses, and says so')
      // The same, but the write in between was someone else's: held, as before.
      const b2 = ws.revision
      await exec({ type: 'rename-page', pageId: 'r1', title: 'One!' })
      await assert.rejects(repo.executeOutbox({ ...edit('other-2', 'r2'), expectedRevision: b2 }, basis(b2, { readsBeyond: true })), held('changed-since'))
    } finally { await f.cleanup() }
  })

  /** A dashboard on Home with two widgets in one row, of Runs (with a Stage), and the workspace's revision after. */
  async function dashboard(repo: ServerRepository) {
    let n = 0
    const exec = async (action: unknown) => { const r = (await repo.load()).revision; return repo.execute({ operationId: `d${++n}`, expectedRevision: r, action: action as Action }) }
    await exec({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
    await exec({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'st', name: 'Stage', type: 'select', options: [{ id: 'a', name: 'Idea', color: 'gray' }] } } })
    await exec({ type: 'create-database', pageId: 'home', homeBlockId: null, title: 'Home' })
    const runs = (await repo.load()).pages.find(p => p.id === 'runs')!.database!
    await exec({ type: 'change-database', pageId: 'home', change: { kind: 'addDashboard', view: { id: 'dash', name: 'Dashboard' }, rows: [{ id: 'row1', widgets: [{ id: 'w1', source: 'runs', view: firstWidgetView(runs, 'v1') }, { id: 'w2', source: 'runs', view: firstWidgetView(runs, 'v2') }] }] } })
    const D = (change: Record<string, unknown>): Action => ({ type: 'change-database', pageId: 'home', change: { viewId: 'dash', ...change } } as unknown as Action)
    const dash = async () => (await repo.load()).pages.find(p => p.id === 'home')!.database!.views.find(v => v.id === 'dash')!.dashboard!
    const rule = (id: string) => ({ id, name: 'Stage', type: 'select', op: 'isAnyOf', value: ['Idea'] })
    return { exec, D, dash, rule, base: (await repo.load()).revision }
  }

  test(`${name} outbox: inside a database page, a widget moved and the dashboard's filter edited from behind both land (G6-5)`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { exec, D, dash, rule, base } = await dashboard(repo)
      await exec(D({ kind: 'swapWidget', widgetId: 'w1', withId: 'w2' }))
      await repo.executeOutbox({ operationId: 'filter', expectedRevision: base, action: D({ kind: 'setDashboardFilter', rules: [rule('k1')] }) }, basis(base))
      const d = await dash()
      assert.deepEqual(d.rows[0]!.widgets.map(w => w.id), ['w2', 'w1'], 'the move survives')
      assert.deepEqual(d.filter?.map(r => r.id), ['k1'], 'the filter edit survives')
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: two edits to one filter meet; the later, made from behind, is held as stale, nothing written`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { exec, D, rule, base } = await dashboard(repo)
      await exec(D({ kind: 'setDashboardFilter', rules: [rule('k1')] }))
      const before = await repo.load()
      await assert.rejects(repo.executeOutbox({ operationId: 'filter-2', expectedRevision: base, action: D({ kind: 'setDashboardFilter', rules: [rule('k2')] }) }, basis(base)), (e: unknown) => held('conflict')(e) && (e as OutboxHeld).stale)
      assert.deepEqual(await repo.load(), before)
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: an edit made before its widget was removed, or removed and made again with its id, never lands in it`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { exec, D, base } = await dashboard(repo)
      const runs = (await repo.load()).pages.find(p => p.id === 'runs')!.database!
      await exec(D({ kind: 'removeWidget', widgetId: 'w2' }))
      // A field the widget's view didn't have (its groups): only the widget's own lifecycle can say it's gone.
      const sortIt = (id: string): Command => ({ operationId: id, expectedRevision: base, action: D({ kind: 'updateWidget', widgetId: 'w2', fields: { groupBy: 'st' } }) })
      await assert.rejects(repo.executeOutbox(sortIt('sort-gone'), basis(base)), (e: unknown) => e instanceof OutboxHeld || (e instanceof Error && /gone/i.test(e.message)))
      // Made again with the same id: a different widget to him, so the old edit is still held, not applied into it.
      await exec(D({ kind: 'addWidget', widget: { id: 'w2', source: 'runs', view: firstWidgetView(runs, 'v2b') }, rowId: 'row1', beforeId: null }))
      await assert.rejects(repo.executeOutbox(sortIt('sort-again'), basis(base)), held('conflict'))
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: a build that stamped rows but not parts leaves a gap: what's based before it is held, not part-checked`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { D, rule, base } = await dashboard(repo)
      await f.partsBehind()
      await assert.rejects(repo.executeOutbox({ operationId: 'filter', expectedRevision: base, action: D({ kind: 'setDashboardFilter', rules: [rule('k1')] }) }, basis(base)), (e: unknown) => held('changed-since')(e) && !(e as OutboxHeld).stale)
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: a change older than a stretch an older build wrote unstamped is held, not row-checked`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { ws, water, bank } = await seeded(repo), base = ws.revision
      await f.olderBuildWrote()
      // At once, before any command of this build has seen the gap (Ratchet: the first replay after rollback and forward).
      await assert.rejects(repo.executeOutbox({ operationId: 'first-replay', expectedRevision: base, action: tick(water) }, basis(base)), held('changed-since'))
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

  test(`${name} outbox: a change made against a newer state than a restored backup is held, not applied over it`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { ws, water } = await seeded(repo), base = ws.revision
      await f.restoredFromBackup(2)
      const before = await repo.load()
      await assert.rejects(repo.executeOutbox({ operationId: 'after-restore', expectedRevision: base, action: tick(water) }, basis(base)), held('changed-since'))
      assert.deepEqual(await repo.load(), before)
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: another account's change gets owner-mismatch before anything runs, and nothing is written`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), { ws, water } = await seeded(repo), before = await repo.load()
      const answer = await runOutbox(repo, 'account-b', { operationId: 'a-tick', expectedRevision: ws.revision, action: tick(water), expectedOwner: 'account-a', basis: basis(ws.revision) })
      assert.deepEqual(answer, { status: 'owner-mismatch', owner: 'account-b' })
      assert.deepEqual(await repo.load(), before)
    } finally { await f.cleanup() }
  })

  test(`${name} outbox: a plain change that fires a rule on the latest state is held when anything moved since its base`, async () => {
    const f = await fixture()
    try {
      const repo = f.create(), at = '2026-11-05T10:00:00.000Z'
      let n = 0
      const exec = async (action: unknown) => { const r = (await repo.load()).revision; return repo.execute({ operationId: `s${++n}`, expectedRevision: r, action: action as Action }) }
      await exec({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
      await exec({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } } })
      await exec({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'st', name: 'Status', type: 'select', options: [{ id: 'todo', name: 'Todo', color: 'gray' }, { id: 'done', name: 'Done', color: 'gray' }] } } })
      await exec({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { n: 1, st: 'todo' }, at })
      await exec({ type: 'add-row', databaseId: 'runs', pageId: 'r2', title: 'Two', values: { n: 2, st: 'todo' }, at })
      const step = { id: 's-n', kind: 'edit-property', set: [{ id: 'n', name: 'N', type: 'number', value: { kind: 'fixed', raw: 5 } }] } as unknown as ButtonStep
      const rule = { id: 'r', name: 'Log finish', active: true, triggers: [{ kind: 'property-edited', propertyId: 'st', name: 'Status', condition: { by: 'st', op: 'isAnyOf', value: ['done'] } }], steps: writeSteps([step]) } as unknown as Automation
      await exec({ type: 'change-database', pageId: 'runs', change: { kind: 'addAutomation', automation: rule } })
      const base = (await repo.load()).revision
      // Something unrelated moves: the other row's number.
      await exec({ type: 'set-values', pageId: 'r2', values: { n: 3 }, expected: { n: 2 }, at })
      const before = await repo.load()
      // Captured as a plain edit (readsBeyond false); on the latest state it fires the rule, so it's held.
      await assert.rejects(repo.executeOutbox({ operationId: 'fires', expectedRevision: base, action: { type: 'set-values', pageId: 'r1', values: { st: 'done' }, expected: { st: 'todo' }, at } as unknown as Action }, basis(base)), held('changed-since'))
      assert.deepEqual(await repo.load(), before)
    } finally { await f.cleanup() }
  })
}
