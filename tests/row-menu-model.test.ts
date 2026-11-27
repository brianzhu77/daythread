// What a to-do's row offers on a day page, and the command each choice sends (docs/design/native-phase-1.md §11.3).
// Today is Thu 2026-11-26.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowAction, rowMenu } from '../src/components/row-menu-model.ts'
import type { Task } from '../src/domain/types.ts'

const today = '2026-11-26', fri = '2026-11-27'
const task = (status: Task['status'] = 'open'): Task =>
  ({ id: 't1', title: 'x', status, version: 1, paused: false, deadlineOn: null, attentionOn: null, createdOn: '2026-11-01', sourcePageId: 'p' })
const labels = (model: ReturnType<typeof rowMenu>) => model?.groups.map(g => ({ title: g.title, items: g.items.map(i => i.label) }))

test('a plan row on today\'s page: Tomorrow and Not today, Another day without Tomorrow, then Cancel task', () => {
  const model = rowMenu(task(), 'plan', today, today, today)
  assert.deepEqual(labels(model), [
    { title: undefined, items: ['Tomorrow · Fri, Nov 27', 'Not today'] },
    { title: 'Another day', items: ['This weekend · Sat 11/28', 'Next week · Mon 11/30', 'Pick date…'] },
    { title: undefined, items: ['Cancel task'] },
  ])
  assert.equal(model!.groups[2]!.items[0]!.danger, true)
  assert.deepEqual(model!.primary.map(p => p.label), ['Tomorrow', 'Not today'])
})

test('a stale row says Remove from, and one on a later day says Not on', () => {
  assert.equal(rowMenu(task(), 'plan', '2026-11-30', today, today)!.groups[0]!.items.at(-1)!.label, 'Remove from Thu')
  assert.equal(rowMenu(task(), 'plan', fri, fri, today)!.groups[0]!.items.at(-1)!.label, 'Not on Fri')
})

test('a reference row offers Plan for today unless it is planned today', () => {
  assert.equal(rowMenu(task(), 'reference', null, today, today)!.primary[0]!.label, 'Plan for today')
  assert.deepEqual(rowMenu(task(), 'reference', today, today, today)!.primary, [])
})

test('cancelled offers Restore, on a past day too; a past day offers Bring to today; done and a non-day page offer nothing', () => {
  assert.deepEqual(labels(rowMenu(task('cancelled'), 'plan', null, '2026-11-20', today)), [{ title: undefined, items: ['Restore'] }])
  assert.deepEqual(labels(rowMenu(task('cancelled'), 'plan', null, today, today)), [{ title: undefined, items: ['Restore'] }])
  assert.deepEqual(labels(rowMenu(task(), 'plan', null, '2026-11-20', today)), [{ title: undefined, items: ['Bring to today'] }])
  assert.equal(rowMenu(task('done'), 'plan', today, today, today), null)
  assert.equal(rowMenu(task(), 'plan', today, null, today), null)
})

test('each intent becomes the command the row has always sent', () => {
  assert.deepEqual(rowAction({ kind: 'move', date: fri }, 't1', today, today), { type: 'plan-task', taskId: 't1', date: fri, from: today, today })
  assert.deepEqual(rowAction({ kind: 'bring-today' }, 't1', '2026-11-20', today), { type: 'plan-task', taskId: 't1', date: today, today })
  assert.deepEqual(rowAction({ kind: 'not-today' }, 't1', fri, today), { type: 'not-today', taskId: 't1', date: fri, onlyThisDay: true })
  assert.deepEqual(rowAction({ kind: 'cancel' }, 't1', today, today), { type: 'task-status', taskId: 't1', status: 'cancelled', today })
  assert.deepEqual(rowAction({ kind: 'restore' }, 't1', today, today), { type: 'task-status', taskId: 't1', status: 'open', today })
})
