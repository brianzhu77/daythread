// The words of the notice a row action leaves, and of the ones around Undo (docs/design/native-phase-1.md §11.5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notTodayText, rowNotices, rowNoticeText } from '../src/components/row-notices.ts'
import type { Task } from '../src/domain/types.ts'

const today = '2026-11-26'
const task = (deadlineOn: string | null = null): Task =>
  ({ id: 't1', title: 'x', status: 'open', version: 1, paused: false, deadlineOn, attentionOn: null, createdOn: '2026-11-01', sourcePageId: 'p' })
const text = (intent: Parameters<typeof rowNoticeText>[0], over: Partial<Parameters<typeof rowNoticeText>[1]> = {}) =>
  rowNoticeText(intent, { task: task(), day: today, today, receipt: { message: 'Task moved' }, plannedAfter: null, ...over })

test('a move names the day; bring to today says On today', () => {
  assert.equal(text({ kind: 'move', date: '2026-11-27' }), 'Moved to Fri, Nov 27')
  assert.equal(text({ kind: 'bring-today' }), 'On today')
})

test('not today says it will not carry over; on another day, that the Due date is still tracked', () => {
  assert.equal(text({ kind: 'not-today' }), 'Not today — won’t carry over')
  assert.equal(text({ kind: 'not-today' }, { day: '2026-11-27', task: task('2026-11-27') }), 'Not on Fri 11/27 · due Fri still tracked')
  assert.equal(notTodayText(task('2026-11-29'), today, today), 'Not today — won’t carry over · due Sun still tracked')
})

test('a stale row says where it is planned now', () => {
  const stale = { day: '2026-11-27', receipt: { message: 'Removed from the day' } }
  assert.equal(text({ kind: 'not-today' }, { ...stale, plannedAfter: '2026-11-30' }), 'Removed from Fri · still planned for Mon')
  assert.equal(text({ kind: 'not-today' }, { ...stale, plannedAfter: null }), 'Removed from Fri · still planned for Fri')
})

test('cancel adds the next to-do\'s day when exactly one was made; restore says Restored', () => {
  assert.equal(text({ kind: 'cancel' }, { receipt: { message: 'ok', nextTodos: [{ taskId: 'n', on: '2026-12-07' }] } }), 'Cancelled · Next Mon, Dec 7')
  assert.equal(text({ kind: 'cancel' }), 'Cancelled')
  assert.equal(text({ kind: 'restore' }), 'Restored')
})

test('the fixed words of the row', () => {
  assert.deepEqual(rowNotices, {
    plannedForToday: 'Planned for today', notDone: 'Not done · your text is kept', undone: 'Undone',
    cantUndo: "Can't undo · changed since", couldntUndo: "Couldn't undo · your text is kept",
  })
})
