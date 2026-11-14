// B98 (docs/design/outbox.md §5): which rows common changes write, the keys the row check compares, and the rule's
// small decisions. A tick writes only its to-do; a line typed on the same day page writes only that page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, today, todo, dayId, bullet, text } from './v2-helpers.ts'
import { rowsOf, planWrites } from '../src/server/workspace-rows.ts'
import { readsBeyondAction, replayRule, rowConflicts, trackedAfter, writeKeys, noTracking } from '../src/server/outbox-replay.ts'
import type { Action } from '../src/domain/types.ts'

test('a tick writes only its task row; a line on the same day page only the page; a rename both', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => [...d, todo('t1', 'Water the plants'), todo('t2', 'Call the bank'), bullet('b1', text('a line'))])
  const keysOf = (f: () => unknown) => { const before = rowsOf(h.ws); f(); return writeKeys(planWrites(before, h.ws).write) }
  const water = h.task('Water the plants').id, bank = h.task('Call the bank').id
  assert.deepEqual(keysOf(() => h.run({ type: 'task-status', taskId: water, status: 'done', today } as Action)), [`task:${water}`])
  assert.deepEqual(keysOf(() => h.save(dayId(today), d => [...d, bullet('b2', text('another line'))])), [`page:${dayId(today)}`])
  assert.deepEqual(keysOf(() => h.run({ type: 'rename-task', taskId: bank, title: 'Call the bank today' } as Action)).sort(), [`page:${dayId(today)}`, `task:${bank}`].sort())
})

test('the rule: as-is when nothing moved; whole when it reads beyond, predates a gap or a forgotten receipt; else rows', () => {
  const basis = { baseRevision: 10, ownRevisions: [], readsBeyond: false }
  assert.deepEqual(replayRule(basis, 10, noTracking), { rule: 'as-is' })
  const tracked = { trackedThrough: 12, untrackedUntil: 0, forgottenThrough: 0 }
  assert.deepEqual(replayRule(basis, 12, tracked), { rule: 'rows' })
  assert.deepEqual(replayRule(basis, 12, { ...tracked, trackedThrough: 11 }), { rule: 'whole', reason: 'changed-since' }, 'an older build wrote revision 12 unstamped')
  assert.deepEqual(replayRule({ ...basis, readsBeyond: true }, 12, tracked), { rule: 'whole', reason: 'changed-since' })
  assert.deepEqual(replayRule(basis, 12, { ...tracked, untrackedUntil: 11 }), { rule: 'whole', reason: 'changed-since' })
  assert.deepEqual(replayRule(basis, 12, { ...tracked, forgottenThrough: 11 }), { rule: 'whole', reason: 'maybe-applied' })
  assert.deepEqual(replayRule(basis, 12, { ...tracked, forgottenThrough: 10 }), { rule: 'rows' }, 'an operation pruned at or before its base was made before it')
})

test('row conflicts skip unstamped rows, rows at or before the base, and the queue\'s own revisions', () => {
  const at: Record<string, number | null> = { 'task:a': null, 'task:b': 10, 'task:c': 11, 'task:d': 12 }
  assert.deepEqual(rowConflicts(Object.keys(at), k => at[k], { baseRevision: 10, ownRevisions: [11], readsBeyond: false }), ['task:d'])
})

test('tracking: a commit right after the last stamped one keeps the gap; one after an older build\'s write opens it', () => {
  assert.equal(trackedAfter({ trackedThrough: 5, untrackedUntil: 0, forgottenThrough: 0 }, 5, 6).untrackedUntil, 0)
  assert.equal(trackedAfter({ trackedThrough: 5, untrackedUntil: 0, forgottenThrough: 0 }, 7, 8).untrackedUntil, 7)
  assert.equal(trackedAfter(noTracking, 40, 41).untrackedUntil, 40, 'the first stamp after the migration: everything before it is untracked')
})

test('buttons, template or copy adds and Undo read beyond what they write', () => {
  assert.equal(readsBeyondAction({ type: 'run-button' } as Action), true)
  assert.equal(readsBeyondAction({ type: 'add-row', template: 't' } as Action), true)
  assert.equal(readsBeyondAction({ type: 'add-row', copyOf: 'r' } as Action), true)
  assert.equal(readsBeyondAction({ type: 'undo' } as Action), true)
  assert.equal(readsBeyondAction({ type: 'task-status' } as Action), false)
})
