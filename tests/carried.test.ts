// B92: how long carry-over has brought a to-do, derived from its plan rows and the days' drafts (carried.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carriedSince } from '../src/domain/carried.ts'
import { pageNodes } from '../src/domain/editor-document.ts'
import { addDays } from '../src/domain/workspace.ts'
import { dayId, harness } from './v2-helpers.ts'

const start = '2026-11-03', day = (n: number) => addDays(start, n)
/** A to-do typed on Nov 3, then brought to each next day by that day's draft, as Brian's TRV was (Bumblebee 66544b2c). */
function carried(days: number) {
  const h = harness()
  h.day(start)
  h.run({ type: 'add-task', pageId: dayId(start), title: 'TRV', plannedOn: start })
  const id = h.ws.tasks[0]!.id
  for (let n = 1; n <= days; n++) carryIn(h, day(n), id)
  return { h, id, task: () => h.ws.tasks.find(t => t.id === id)! }
}
function carryIn(h: ReturnType<typeof harness>, date: string, taskId: string) {
  h.day(date)
  const anchor = pageNodes(h.page(dayId(date)))[0]!.id
  h.run({ type: 'set-draft', pageId: dayId(date), status: 'ready', moreOpen: [], allowedTaskIds: [taskId], items: [{ id: 'i0', anchor, place: 'after', taskId, source: 'model', state: 'open' }] } as never)
  h.run({ type: 'apply-draft', pageId: dayId(date), itemIds: ['i0'], today: date } as never)
}

test('carried by the draft for 7 days it reads since the day it was typed; 6 days, nothing', () => {
  const seven = carried(7)
  assert.equal(carriedSince(seven.h.ws, seven.task(), day(7)), start)
  const six = carried(6)
  assert.equal(carriedSince(six.h.ws, six.task(), day(6)), null)
})

test('choosing a day starts the clock again: planned to today, or moved to another day and carried from there', () => {
  const { h, id, task } = carried(7)
  // Moved from today to tomorrow, then carried for 6 more days: 6 days since that choice, so nothing.
  h.run({ type: 'plan-task', taskId: id, date: day(8), from: day(7), today: day(7) })
  for (let n = 9; n <= 14; n++) carryIn(h, day(n), id)
  assert.equal(carriedSince(h.ws, task(), day(14)), null)
  carryIn(h, day(15), id)
  assert.equal(carriedSince(h.ws, task(), day(15)), day(8))
})

test('not shown on a done, paused or future-planned to-do, nor on another day than its plan', () => {
  const done = carried(8)
  done.h.run({ type: 'task-status', taskId: done.id, status: 'done', today: day(8) })
  assert.equal(carriedSince(done.h.ws, done.task(), day(8)), null)
  const paused = carried(8)
  paused.h.run({ type: 'not-today', taskId: paused.id, date: day(8) })
  assert.equal(carriedSince(paused.h.ws, paused.task(), day(8)), null)
  const later = carried(8)
  later.h.run({ type: 'plan-task', taskId: later.id, date: day(12), from: day(8), today: day(8) })
  assert.equal(carriedSince(later.h.ws, later.task(), day(8)), null, 'planned for a later day')
  const old = carried(8)
  assert.equal(carriedSince(old.h.ws, old.task(), day(9)), null, 'not on that day\'s plan (it is on Nov 11\'s)')
})

test('resumed after Not today counts from the day it was planned again', () => {
  const { h, id, task } = carried(3)
  h.run({ type: 'not-today', taskId: id, date: day(3) })
  h.run({ type: 'plan-task', taskId: id, date: day(5), today: day(5) })
  for (let n = 6; n <= 12; n++) carryIn(h, day(n), id)
  assert.equal(carriedSince(h.ws, task(), day(12)), day(5))
})
