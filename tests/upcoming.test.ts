import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyWorkspace } from '../src/domain/workspace.ts'
import { getUpcomingByDate } from '../src/domain/upcoming.ts'
import type { Task } from '../src/domain/types.ts'
const today = '2026-10-16'
function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, title: id, status: 'open', version: 1, plannedOn: null, attentionOn: null,
    deadlineOn: null, paused: false, createdOn: today, lastPlannedOn: null, sourcePageId: 'source', ...patch }
}
test('Upcoming includes deadline-only, start-only and do dates beyond fourteen days', () => {
  const state = createEmptyWorkspace()
  state.tasks = [task('passport', { deadlineOn: '2026-10-22' }), task('start', { attentionOn: '2026-10-20' }),
    task('far-do', { plannedOn: '2027-01-01' })]
  const result = getUpcomingByDate(state, today)
  assert.deepEqual(result.map(g => [g.date, g.tasks[0].task.id, g.tasks[0].kinds]), [
    ['2026-10-20', 'start', ['start']], ['2026-10-22', 'passport', ['due']], ['2027-01-01', 'far-do', ['do']]])
})
test('Upcoming merges same-task same-date facts and retains distinct dates independently', () => {
  const state = createEmptyWorkspace()
  state.tasks = [task('coincident', { plannedOn: '2026-10-20', attentionOn: '2026-10-20', deadlineOn: '2026-10-20' }),
    task('separate', { plannedOn: '2026-10-19', attentionOn: '2026-10-18', deadlineOn: '2026-10-21' })]
  const result = getUpcomingByDate(state, today)
  assert.deepEqual(result.map(g => g.date), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'])
  assert.equal(result[2].tasks.length, 1)
  assert.deepEqual(result[2].tasks[0].kinds, ['do', 'start', 'due'])
})
test('Upcoming preserves paused date facts, excludes done/cancelled/undated tasks and honors inclusive bounds', () => {
  const state = createEmptyWorkspace()
  state.tasks = [task('paused', { paused: true, attentionOn: today, deadlineOn: '2026-10-22' }),
    task('done', { status: 'done', deadlineOn: today }), task('cancelled', { status: 'cancelled', deadlineOn: today }),
    task('undated'), task('past', { deadlineOn: '2026-10-15' })]
  assert.deepEqual(getUpcomingByDate(state, today, '2026-10-22').map(g => [g.date, g.tasks[0].task.id]),
    [[today, 'paused'], ['2026-10-22', 'paused']])
  assert.deepEqual(getUpcomingByDate(state, '2026-10-23'), [])
})
test('Upcoming is a pure read, deterministic for ties, and validates the date window', () => {
  const state = createEmptyWorkspace()
  state.tasks = [task('b', { deadlineOn: today }), task('a', { deadlineOn: today })]
  const before = JSON.stringify(state)
  Object.freeze(state.tasks); state.tasks.forEach(Object.freeze); Object.freeze(state)
  assert.deepEqual(getUpcomingByDate(state, today).map(g => g.tasks.map(r => r.task.id)), [['a', 'b']])
  assert.equal(JSON.stringify(state), before)
  assert.equal(state.pages.length, 0)
  assert.equal(state.placements.length, 0)
  assert.throws(() => getUpcomingByDate(state, '2026-02-30'), /Invalid calendar date/)
  assert.throws(() => getUpcomingByDate(state, today, '2026-10-15'), /end precedes start/)
})
