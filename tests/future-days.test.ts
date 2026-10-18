// Date navigation rules R5, R6, R9 (docs/design/date-navigation-rules.md on product/date-rules 24ab5d3):
// planning never creates a day page; creating one renders the placements already stored for that day.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace, getDayView } from '../src/domain/workspace.ts'
import type { Action } from '../src/domain/types.ts'

const today = '2026-10-17', future = '2026-10-21'

function setup() {
  let state = createEmptyWorkspace(), sequence = 0
  const run = (action: Action, operationId = `test-${++sequence}`) => {
    state = applyCommand(state, { operationId, expectedRevision: state.revision, action }).workspace
  }
  run({ type: 'ensure-day', date: today })
  const todayPage = () => state.pages.find(p => p.date === today)!
  const add = (title: string, section: 'top3' | 'other' = 'other') => {
    const page = todayPage()
    run({ type: 'add-task', pageId: page.id, sectionId: page.sections.find(s => s.kind === section)!.id, title })
    return state.tasks.at(-1)!
  }
  const dayPages = (date: string) => state.pages.filter(p => p.type === 'daily' && p.date === date)
  const rows = (date: string, kind: 'top3' | 'other') =>
    dayPages(date)[0].sections.find(s => s.kind === kind)!.blocks.filter(b => b.kind === 'task').map(b => b.taskId)
  return { run, add, dayPages, rows, get state() { return state } }
}

test('R9: planning a task for a future day stores the placement only', () => {
  const s = setup(), task = s.add('Book dentist')
  s.run({ type: 'plan-task', taskId: task.id, date: future })
  assert.equal(s.dayPages(future).length, 0)
  assert.equal(s.state.tasks[0].plannedOn, future)
  assert.ok(s.state.placements.some(p => p.taskId === task.id && p.date === future && p.state === 'included'))
  assert.deepEqual(getDayView(s.state, future).planned.map(t => t.id), [task.id])
})

test('R9: a task added with a future plan date does not create that page', () => {
  const s = setup(), page = s.state.pages[0]
  s.run({ type: 'add-task', pageId: page.id, sectionId: page.sections.find(x => x.kind === 'other')!.id, title: 'Pay rent', plannedOn: future })
  assert.equal(s.dayPages(future).length, 0)
  assert.equal(getDayView(s.state, future).planned.length, 1)
})

test('R5: creating a future page renders its placements in their sections and order', () => {
  const s = setup(), a = s.add('First'), b = s.add('Second'), c = s.add('Top one')
  s.run({ type: 'plan-task', taskId: a.id, date: future })
  s.run({ type: 'plan-task', taskId: b.id, date: future })
  s.run({ type: 'plan-task', taskId: c.id, date: future, section: 'top3' })
  s.run({ type: 'ensure-day', date: future })
  assert.equal(s.dayPages(future).length, 1)
  assert.deepEqual(s.rows(future, 'other'), [a.id, b.id])
  assert.deepEqual(s.rows(future, 'top3'), [c.id])
})

test('R5: placements moved away, excluded or finished are not rendered', () => {
  const s = setup(), moved = s.add('Moved'), excluded = s.add('Excluded'), done = s.add('Done'), kept = s.add('Kept')
  for (const t of [moved, excluded, done, kept]) s.run({ type: 'plan-task', taskId: t.id, date: future })
  s.run({ type: 'plan-task', taskId: moved.id, date: '2026-10-22' })
  s.run({ type: 'not-today', taskId: excluded.id, date: future })
  s.run({ type: 'task-status', taskId: done.id, status: 'done' })
  s.run({ type: 'ensure-day', date: future })
  assert.deepEqual(s.rows(future, 'other'), [kept.id])
})

test('R5: creating twice yields one page and no duplicate rows', () => {
  const s = setup(), task = s.add('Once')
  s.run({ type: 'plan-task', taskId: task.id, date: future })
  s.run({ type: 'ensure-day', date: future })
  const first = structuredClone(s.dayPages(future))
  s.run({ type: 'ensure-day', date: future })
  assert.deepEqual(s.dayPages(future), first)
})

test('R8: planning onto an existing future page still adds its row', () => {
  const s = setup(), task = s.add('Later')
  s.run({ type: 'ensure-day', date: future })
  s.run({ type: 'plan-task', taskId: task.id, date: future })
  assert.deepEqual(s.rows(future, 'other'), [task.id])
})

test('moving a task from today to a future day removes it from today without creating the future page', () => {
  const s = setup(), task = s.add('Shift me')
  s.run({ type: 'plan-task', taskId: task.id, date: today })
  s.run({ type: 'plan-task', taskId: task.id, date: future })
  assert.equal(s.dayPages(future).length, 0)
  assert.ok(!getDayView(s.state, today).planned.some(t => t.id === task.id))
})
