// B98 (docs/design/outbox.md §4, §6): the browser side's pure parts. What a change is predicted to write and name, which
// later changes wait on a held one, and how acknowledging one passes its revision on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, today, todo, dayId, bullet, text } from './v2-helpers.ts'
import { capture, dependsOn, labelFor, memoryOutboxStore, referencedIds, schedule, type OutboxEntry } from '../src/components/outbox.ts'
import type { Action, Workspace } from '../src/domain/types.ts'
import { applyCommand } from '../src/domain/workspace.ts'

const setup = () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => [...d, todo('t1', 'Water the plants'), todo('t2', 'Call the bank'), bullet('b1', text('a line'))])
  return { h, water: h.task('Water the plants').id, bank: h.task('Call the bank').id }
}
const entry = (over: Partial<OutboxEntry>): OutboxEntry => ({ owner: 'me', operationId: 'op', action: { type: 'undo' } as Action, baseRevision: 1, ownRevisions: [], readsBeyond: false, writes: [], refs: [], label: '', createdAt: 0, state: 'pending', ...over })

test('a tick is predicted to write only its to-do, names its id, and reads nothing beyond', () => {
  const { h, water } = setup()
  const { entry: e, predicted } = capture(h.ws, { type: 'task-status', taskId: water, status: 'done', today } as Action, 'tick', false)
  assert.deepEqual(e.writes, [`task:${water}`])
  assert.ok(e.refs.includes(water))
  assert.equal(e.readsBeyond, false)
  assert.equal(e.label, 'ticked "Water the plants"')
  assert.equal(predicted!.tasks.find(t => t.id === water)!.status, 'done')
})

test('Undo is stored, not predicted, and reads beyond; so does anything made while one is pending', () => {
  const { h, bank } = setup()
  assert.deepEqual(capture(h.ws, { type: 'undo', targetOperationId: 'x' } as Action, 'u', false), { entry: { operationId: 'u', action: { type: 'undo', targetOperationId: 'x' }, refs: ['x'], label: 'an Undo', readsBeyond: true, writes: [] }, predicted: null })
  assert.equal(capture(h.ws, { type: 'rename-task', taskId: bank, title: 'Call them' } as Action, 'r', true).entry.readsBeyond, true)
})

test('only changes sharing a row with a held one, naming what it made, or reading beyond, wait on it', () => {
  const held = entry({ writes: ['life:db1', 'page:db1', 'task:a'] })
  assert.equal(dependsOn(entry({ writes: ['task:a'] }), held), true, 'the same row')
  assert.equal(dependsOn(entry({ writes: ['page:row9'], refs: ['db1'] }), held), true, 'a row added to the database it created')
  assert.equal(dependsOn(entry({ writes: ['task:b'], refs: ['b'] }), held), false, 'an unrelated tick goes ahead')
  assert.equal(dependsOn(entry({ writes: ['task:b'], readsBeyond: true }), held), true)
})

test('inside one page, sibling parts don\'t wait on each other; a removed view or widget holds what names it (Ratchet 58a63858)', () => {
  const filter = entry({ writes: ['dash/v1/filter'], refs: ['home', 'v1'] })
  assert.equal(dependsOn(entry({ writes: ['dash/v1/layout'], refs: ['home', 'v1', 'w1'] }), filter), false, 'a move beside a held filter edit')
  assert.equal(dependsOn(entry({ writes: ['dash/v1/filter'], refs: ['home', 'v1'] }), filter), true, 'the same filter')
  assert.equal(dependsOn(entry({ writes: ['page:home'], refs: ['home'] }), filter), false, 'a rename of the page')
  const removed = entry({ writes: ['life:widget:w1', 'widget/w1/filter', 'dash/v1/layout'] })
  assert.equal(dependsOn(entry({ writes: ['widget/w1/sort'], refs: ['home', 'v1', 'w1'] }), removed), true, 'an edit to the removed widget, even a field it never had')
})

test('acknowledging passes the revision to later entries of the same owner only', async () => {
  const store = memoryOutboxStore()
  const a = await store.add(entry({ operationId: 'a' })), b = await store.add(entry({ operationId: 'b' })), other = await store.add(entry({ operationId: 'c', owner: 'someone' }))
  await store.acknowledge(a, 'me', 7)
  const left = await store.all()
  assert.deepEqual(left.map(e => e.seq), [b, other])
  assert.deepEqual(left.find(e => e.seq === b)!.ownRevisions, [7])
  assert.deepEqual(left.find(e => e.seq === other)!.ownRevisions, [])
  await store.clearOwner('me')
  assert.deepEqual((await store.all()).map(e => e.owner), ['someone'])
})

test('references are every string the action names, not its type', () => {
  assert.deepEqual(referencedIds({ type: 'add-row', databaseId: 'db1', pageId: 'r1', title: 'Dune', values: { st: 'a' }, at: '2026-11-14T00:00:00.000Z' } as unknown as Action).sort(), ['Dune', 'a', 'db1', 'r1', '2026-11-14T00:00:00.000Z'].sort())
  assert.equal(labelFor({ type: 'run-button', pageId: 'nowhere' } as Action, setup().h.ws), 'ran a button')
})

test('a new to-do gets the same id in the prediction and on the server, so a later change naming it means it (Ratchet c8c0f6f9)', () => {
  const { h } = setup()
  const action = { type: 'add-task', pageId: dayId(today), title: 'Buy milk' } as Action
  const { predicted } = capture(h.ws, action, 'op-add', false)
  const server = applyCommand(structuredClone(h.ws), { operationId: 'op-add', expectedRevision: h.ws.revision, action }).workspace
  const id = (ws: typeof server) => ws.tasks.find(t => t.title === 'Buy milk')!.id
  assert.equal(id(predicted!), id(server))
  const other = applyCommand(structuredClone(h.ws), { operationId: 'op-other', expectedRevision: h.ws.revision, action }).workspace
  assert.notEqual(id(other), id(server), 'another operation makes another id')
})

test('waiting is transitive: a change on a row whose add waits on a held database waits too (Ratchet 12c9599b)', () => {
  const a = entry({ seq: 1, state: 'held', writes: ['life:newdb', 'page:newdb'] })
  const b = entry({ seq: 2, writes: ['life:newrow', 'page:newrow'], refs: ['newdb'] })
  const c = entry({ seq: 3, writes: ['page:newrow'], refs: ['newrow'] })
  const d = entry({ seq: 4, writes: ['task:other'], refs: ['other'] })
  const plan = schedule([d, c, b, a])
  assert.deepEqual(plan.waiting.get(2), [1])
  assert.deepEqual(plan.waiting.get(3), [1], 'through b')
  assert.deepEqual(plan.sendable.map(e => e.seq), [4], 'an unrelated change goes')
})

test('a database change is named by what he sees: a dashboard by its view, a widget by its heading (Jazz 0409ac87)', () => {
  const view = { id: 'v-w1', name: 'Table', layout: 'table', columns: [], sort: [], filter: [] }
  const ws = { pages: [
    { id: 'runs', title: 'Runs', database: { views: [] } },
    { id: 'home', title: 'Home', database: { views: [{ id: 'dash', name: 'Overview', layout: 'dashboard', columns: [], sort: [], filter: [], dashboard: { rows: [{ id: 'row1', height: 320, widgets: [{ id: 'w1', width: 12, source: 'runs', view }] }] } }] } },
  ], tasks: [] } as unknown as Workspace
  const D = (change: object) => ({ type: 'change-database', pageId: 'home', change: { viewId: 'dash', ...change } }) as unknown as Action
  assert.equal(labelFor(D({ kind: 'setDashboardFilter', rules: [] }), ws), 'filtered "Overview"')
  assert.equal(labelFor(D({ kind: 'updateWidget', widgetId: 'w1', fields: { filter: [] } }), ws), 'filtered "Runs · Table"')
  assert.equal(labelFor(D({ kind: 'removeWidget', widgetId: 'w1' }), ws), 'deleted "Runs · Table"')
  assert.equal(labelFor(D({ kind: 'swapWidget', widgetId: 'w1', withId: 'w2' }), ws), 'moved "Runs · Table"')
})

test('a hand-off, in one step: the original goes, its replacement is stored, and whatever waits on it, from any tab, is held (Ratchet 6804fae5, 13832939)', async () => {
  const store = memoryOutboxStore()
  const original = await store.add(entry({ operationId: 'orig', writes: ['page:r1'], state: 'held' }))
  const before = await store.add(entry({ operationId: 'on-top', writes: ['page:r1'] }))
  const unrelated = await store.add(entry({ operationId: 'other', writes: ['task:b'], refs: ['b'] }))
  const otherTab = await store.add(entry({ operationId: 'other-tab', writes: ['page:r1'] }))
  const replacement = await store.handOff(original, 'me', entry({ operationId: 'rebuilt', writes: ['page:r1'] }))
  const all = await store.all()
  const state = (op: string) => all.find(e => e.operationId === op)?.state ?? 'gone'
  assert.equal(state('orig'), 'gone')
  assert.equal(state('rebuilt'), 'pending', 'the replacement goes')
  assert.equal(all.find(e => e.operationId === 'rebuilt')!.seq, replacement)
  assert.equal(state('on-top'), 'held', 'made on top of it')
  assert.equal(state('other-tab'), 'held', 'added by another tab during the hand-off, whatever its seq')
  assert.equal(state('other'), 'pending', 'unrelated')
  assert.ok(before < unrelated && unrelated < otherTab)
  // Done with, nothing replacing it.
  const lone = await store.add(entry({ operationId: 'lone', writes: ['task:z'], state: 'held' }))
  assert.equal(await store.handOff(lone, 'me', null), null)
  assert.equal((await store.all()).some(e => e.operationId === 'lone'), false)
})

test('a hand-off changes nothing when the original isn\'t held for its caller any more: another tab kept it, discarded it, or it isn\'t this owner\'s (Ratchet 23351123)', async () => {
  const store = memoryOutboxStore()
  const kept = await store.add(entry({ operationId: 'kept', writes: ['page:r1'], state: 'pending' }))
  assert.equal(await store.handOff(kept, 'me', entry({ operationId: 'rebuilt', writes: ['page:r1'] })), 'not-held', 'Keep mine in another tab')
  assert.equal(await store.handOff(999, 'me', entry({ operationId: 'rebuilt-2', writes: ['page:r1'] })), 'not-held', 'discarded in another tab')
  const theirs = await store.add(entry({ operationId: 'theirs', owner: 'someone', writes: ['page:r1'], state: 'held' }))
  assert.equal(await store.handOff(theirs, 'me', null), 'not-held', 'another account\'s')
  assert.deepEqual((await store.all()).map(e => e.operationId), ['kept', 'theirs'], 'nothing stored, nothing removed')
  // The app's own write was dropped when it was held: its rebuild is stored.
  assert.equal(typeof await store.handOff(998, 'me', entry({ operationId: 'app-rebuilt', writes: ['page:n1'], app: true })), 'number')
})
