// B98 (docs/design/outbox.md §4, §6): the browser side's pure parts. What a change is predicted to write and name, which
// later changes wait on a held one, and how acknowledging one passes its revision on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, today, todo, dayId, bullet, text } from './v2-helpers.ts'
import { blockedBy, capture, dependsOn, labelFor, memoryOutboxStore, referencedIds, type OutboxEntry } from '../src/components/outbox.ts'
import type { Action } from '../src/domain/types.ts'
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
  const held = entry({ writes: ['page:db1', 'task:a'] })
  assert.equal(dependsOn(entry({ writes: ['task:a'] }), held), true, 'the same row')
  assert.equal(dependsOn(entry({ writes: ['page:row9'], refs: ['db1'] }), held), true, 'a row added to the database it created')
  assert.equal(dependsOn(entry({ writes: ['task:b'], refs: ['b'] }), held), false, 'an unrelated tick goes ahead')
  assert.equal(dependsOn(entry({ writes: ['task:b'], readsBeyond: true }), held), true)
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
  const a = entry({ seq: 1, state: 'held', writes: ['page:newdb'] })
  const b = entry({ seq: 2, writes: ['page:newrow'], refs: ['newdb'] })
  const c = entry({ seq: 3, writes: ['page:newrow'], refs: ['newrow'] })
  const d = entry({ seq: 4, writes: ['task:other'], refs: ['other'] })
  const all = [a, b, c, d]
  assert.equal(blockedBy(all, b), true)
  assert.equal(blockedBy(all, c), true, 'through b')
  assert.equal(blockedBy(all, d), false, 'an unrelated change goes')
})
