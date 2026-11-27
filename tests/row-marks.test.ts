// What is drawn beside a to-do's words on a day page (docs/design/native-phase-1.md §11.2). Today is Thu 2026-11-26.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowMarks, sinceLabel } from '../src/components/row-marks.ts'
import { pageNodes } from '../src/domain/editor-document.ts'
import { addDays, plannedOn } from '../src/domain/workspace.ts'
import type { Task, Workspace } from '../src/domain/types.ts'
import { dayId, harness } from './v2-helpers.ts'

const today = '2026-11-26'
const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', title: 'x', status: 'open', version: 1, paused: false, deadlineOn: null, attentionOn: null, createdOn: '2026-11-01', sourcePageId: 'p', ...over })
const none = { cancelled: null, reference: null, movedTo: null, dateTag: null, since: null, repeat: null, blockedBy: null, planForToday: null }
const empty = harness().ws
const marks = (t: Task, over: Partial<Parameters<typeof rowMarks>[2]> = {}, ws: Workspace = empty) =>
  rowMarks(ws, t, { role: 'plan', planDate: today, today, planned: today, ...over })

/** A to-do carried to today by each day's draft since `start`, as carried.test.ts does it. */
function carriedWorld(start: string, days: number) {
  const h = harness()
  h.day(start)
  h.run({ type: 'add-task', pageId: dayId(start), title: 'Carried', plannedOn: start })
  const id = h.ws.tasks[0]!.id
  for (let n = 1; n <= days; n++) {
    const date = addDays(start, n)
    h.day(date)
    const anchor = pageNodes(h.page(dayId(date)))[0]!.id
    h.run({ type: 'set-draft', pageId: dayId(date), status: 'ready', moreOpen: [], allowedTaskIds: [id], items: [{ id: 'i0', anchor, place: 'after', taskId: id, source: 'model', state: 'open' }] } as never)
    h.run({ type: 'apply-draft', pageId: dayId(date), itemIds: ['i0'], today: date } as never)
  }
  return { h, id }
}

test('a carried, repeating, blocked, dated open plan row shows them all', () => {
  const { h, id } = carriedWorld('2026-11-19', 7)
  h.run({ type: 'add-task', pageId: dayId(today), title: 'Blocker', plannedOn: today })
  const blocker = h.ws.tasks.find(t => t.title === 'Blocker')!.id
  h.run({ type: 'set-todo-repeat', taskId: id, repeat: { every: 'week', interval: 1, from: 'schedule' }, today, at: '2026-11-26T09:00:00.000Z' })
  h.run({ type: 'link-tasks', taskId: id, add: [blocker], remove: [], at: '2026-11-26T09:00:00.000Z' })
  h.run({ type: 'set-task-dates', taskId: id, deadlineOn: '2026-11-27' })
  const t = h.ws.tasks.find(x => x.id === id)!
  assert.deepEqual(marks(t, { planned: plannedOn(h.ws, id) }, h.ws), {
    ...none, dateTag: { text: 'Due tomorrow', warn: false }, since: 'Since Nov 19', repeat: 'Repeats every week', blockedBy: 'Blocked by Blocker',
  })
})

test('a passed Due date is a warning', () => {
  assert.deepEqual(marks(task({ deadlineOn: '2026-11-23' })).dateTag, { text: 'Was due Mon', warn: true })
})

test('a done row shows only Reference, and only on a reference row', () => {
  assert.deepEqual(marks(task({ status: 'done', deadlineOn: '2026-11-27' })), none)
  assert.deepEqual(marks(task({ status: 'done' }), { role: 'reference' }), { ...none, reference: 'Reference', planForToday: 'hidden' })
})

test('a cancelled row says Cancelled; a cancelled reference row keeps Reference too', () => {
  assert.deepEqual(marks(task({ status: 'cancelled' })), { ...none, cancelled: 'Cancelled' })
  assert.deepEqual(marks(task({ status: 'cancelled' }), { role: 'reference' }), { ...none, cancelled: 'Cancelled', reference: 'Reference', planForToday: 'hidden' })
})

test('an open reference row offers Plan for today', () => {
  assert.deepEqual(marks(task(), { role: 'reference', planned: null }), { ...none, reference: 'Reference', planForToday: 'active' })
})

test('a history row says where the plan went', () => {
  assert.equal(marks(task(), { planned: '2026-11-27' }).movedTo, 'Moved to Fri 11/27')
  assert.equal(marks(task(), { planned: today }).movedTo, null)
})

test('a row whose to-do the workspace does not hold draws no to-do marks', () => {
  assert.deepEqual(rowMarks(empty, undefined, { role: 'reference', planDate: today, today, planned: null }), { ...none, reference: 'Reference' })
})

test('Since carries the year only when it is not this one', () => {
  assert.equal(sinceLabel('2026-11-03', today), 'Nov 3')
  assert.equal(sinceLabel('2025-11-03', today), 'Nov 3, 2025')
})
