import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heldWorkspace, settleTick, shownStatus, tapTarget, withTick, type Tick, type Ticks } from '../src/components/task-ticks.ts'
import { getDayView } from '../src/domain/workspace.ts'
import type { Workspace } from '../src/domain/types.ts'
import { dayId, harness, today, todo, under } from './v2-helpers.ts'

const none: Ticks = new Map()
const open = { id: 'a', status: 'open' } as const
const done = { id: 'a', status: 'done' } as const
const saving: Tick = { to: 'done', phase: 'saving', token: 1 }

test('ticks: a tap ticks at once; a second tap while it saves is ignored', () => {
  assert.equal(tapTarget(none, open), 'done')
  const ticks = withTick(none, 'a', saving)
  assert.equal(shownStatus(ticks, open), 'done')
  assert.equal(tapTarget(ticks, open), null)
  // The answer can arrive before React re-renders: the stored to-do is done, the tick still saving. Still ignored,
  // which is the tap that used to reopen it.
  assert.equal(tapTarget(ticks, done), null)
})

test('ticks: after the answer the row holds; a tap then toggles as normal, so unticking on purpose works', () => {
  const holding = settleTick(withTick(none, 'a', saving), 'a', 1, { to: 'done', phase: 'holding', token: 1 })
  assert.equal(shownStatus(holding, done), 'done')
  assert.equal(tapTarget(holding, done), 'open')
})

test('ticks: a failed save drops the tick, and the box shows the stored state again', () => {
  const ticks = withTick(none, 'a', saving)
  const failed = settleTick(ticks, 'a', 1, null)
  assert.equal(failed.size, 0)
  assert.equal(shownStatus(failed, open), 'open')
})

test("ticks: an old tap's answer or hold timer never touches a later tap's tick", () => {
  const later = withTick(none, 'a', { to: 'open', phase: 'saving', token: 2 })
  assert.equal(settleTick(later, 'a', 1, null), later)
  assert.equal(settleTick(later, 'a', 1, { to: 'done', phase: 'holding', token: 1 }), later)
})

test('ticks: a cancelled to-do cannot be ticked', () => {
  assert.equal(tapTarget(none, { id: 'a', status: 'cancelled' }), null)
})

test('ticks: an Undo during the hold shows at once, because the box reads the stored to-do', () => {
  const holding = withTick(none, 'a', { to: 'done', phase: 'holding', token: 1 })
  assert.equal(shownStatus(holding, open), 'open')
})

test('ticks: a ticked to-do keeps its place in the open lists until its hold ends, then leaves', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Call the bank'), todo('r2', 'Water plants')))
  const a = h.task('Call the bank').id, b = h.task('Water plants').id
  const planned = (w: Workspace) => getDayView(w, today).planned.map(t => t.id)
  assert.deepEqual(planned(h.ws), [a, b])
  h.run({ type: 'task-status', taskId: a, status: 'done', today })
  assert.deepEqual(planned(h.ws), [b])
  const holding = withTick(none, a, { to: 'done', phase: 'holding', token: 1 })
  assert.deepEqual(planned(heldWorkspace(h.ws, holding)), [a, b])
  assert.equal(heldWorkspace(h.ws, none), h.ws)
  // A to-do cancelled meanwhile is not held back.
  h.run({ type: 'task-status', taskId: a, status: 'cancelled' })
  assert.equal(heldWorkspace(h.ws, holding), h.ws)
})
