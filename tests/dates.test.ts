// The date words of a to-do (docs/design/native-phase-1.md §11.3): `taskDateTag` and `near`, with the examples the native
// app is held to. Today is Thu 2026-11-26.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deadlinePassed, near, taskDateTag } from '../src/components/dates.ts'
import type { Task } from '../src/domain/types.ts'

const today = '2026-11-26'
const task = (deadlineOn: string | null, attentionOn: string | null = null): Task =>
  ({ id: 't', title: 'x', status: 'open', version: 1, paused: false, deadlineOn, attentionOn, createdOn: '2026-11-01', sourcePageId: 'p' })

test('taskDateTag on today\'s page, for each shape of a to-do\'s dates', () => {
  const on = (t: Task, planned: string | null = today) => taskDateTag(t, today, today, planned)
  assert.equal(on(task('2026-11-26')), 'Due today')
  assert.equal(on(task('2026-11-27')), 'Due tomorrow')
  assert.equal(on(task('2026-11-29')), 'Due Sun')
  assert.equal(on(task('2026-12-01')), 'Due Tue')
  assert.equal(on(task('2026-12-02')), 'Due Wed 12/2')
  assert.equal(on(task('2026-11-23')), 'Was due Mon')
  assert.equal(on(task(null, '2026-11-27')), 'Start tomorrow')
  assert.equal(on(task(null, '2026-11-20')), '')
  assert.equal(on(task(null, '2026-11-20'), null), 'Unscheduled')
  assert.equal(on(task('2026-12-05', '2026-12-05')), 'Start Sat 12/5 · Due Sat 12/5')
  assert.equal(on(task('2026-11-27', '2026-11-27')), 'Due tomorrow · Start tomorrow')
  assert.equal(on(task('2026-12-06', '2026-11-30')), 'Start Mon · Due Sun 12/6')
  assert.equal(on(task('2026-11-28', '2026-11-27')), 'Due Sat · Start tomorrow')
  assert.equal(on(task('2026-11-29', '2026-11-26')), 'Start today · Due Sun')
  assert.equal(on(task('2026-11-23', '2026-11-27')), 'Was due Mon')
})

test('taskDateTag on a past and on a future page', () => {
  assert.equal(taskDateTag(task('2026-11-23'), today, '2026-11-20', today), 'Due Mon 11/23')
  assert.equal(taskDateTag(task('2026-12-03'), today, '2026-12-03', today), 'Due that day')
})

test('a Due date before today is passed; a Start date never is', () => {
  assert.equal(deadlinePassed(task('2026-11-25'), today), true)
  assert.equal(deadlinePassed(task('2026-11-26'), today), false)
  assert.equal(deadlinePassed(task(null, '2026-11-01'), today), false)
})

test('near names the weekday for two to five days and stops there', () => {
  assert.equal(near('2026-11-26', today), 'today')
  assert.equal(near('2026-11-27', today), 'tomorrow')
  assert.equal(near('2026-11-28', today), 'Sat')
  assert.equal(near('2026-12-01', today), 'Tue')
  assert.equal(near('2026-12-02', today), 'Wed 12/2', 'six days ahead would share Thu with yesterday')
})
