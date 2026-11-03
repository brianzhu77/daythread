// B22: a pasted to-do is a reference row to the same task: no new task, and a tick or a rename reaches every row. Make a copy
// turns the row back into its own task, and a row's stale words don't rename the task.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDayView, plannedOn, taskRows } from '../src/domain/workspace.ts'
import type { EditorNode } from '../src/domain/editor-document.ts'
import { harness, text, today, tomorrow, dayId } from './v2-helpers.ts'

const row = (id: string, taskId: string, title: string, role = 'reference'): EditorNode => ({ id, type: 'task', props: { taskId, role, planDate: '' }, content: [text(title)], children: [] })

function pasted() {
  const h = harness()
  h.day(today)
  const { entityId: task } = h.run({ type: 'add-task', pageId: dayId(today), title: 'TRV', plannedOn: today }).receipt
  h.run({ type: 'create-document', title: 'Trips', body: '', pageId: 'trips' })
  h.save('trips', d => [...d, row('r1', task!, 'TRV')])
  return Object.assign(h, { task: task! })
}

test('pasted on another page: the same task, a reference row, still planned where it was', () => {
  const h = pasted()
  assert.equal(h.ws.tasks.length, 1)
  assert.deepEqual(taskRows(h.ws, h.task).map(r => [r.page.id, r.role]).sort(), [[dayId(today), 'plan'], ['trips', 'reference']])
  assert.equal(plannedOn(h.ws, h.task), today)
})

test('pasted on a day page it stays a reference row, and plans nothing there', () => {
  const h = pasted()
  h.day(tomorrow)
  h.save(dayId(tomorrow), d => [...d, row('r2', h.task, 'TRV')], { today })
  assert.equal(h.ws.tasks.length, 1)
  assert.equal(plannedOn(h.ws, h.task), today)
})

test('a tick and a rename reach every row', () => {
  const h = pasted()
  h.run({ type: 'task-status', taskId: h.task, status: 'done', today })
  assert.equal(h.ws.tasks[0]!.status, 'done')
  assert.equal(taskRows(h.ws, h.task).length, 2)
  h.save('trips', d => d.map(n => (n.id === 'r1' ? { ...n, content: [text('TRV visa')] } : n)))
  assert.equal(h.ws.tasks[0]!.title, 'TRV visa')
})

test('Make a copy: its own task, and the first keeps its row and plan', () => {
  const h = pasted()
  h.save('trips', d => d.map(n => (n.id === 'r1' ? row('r1', 'editor-task:r1', 'TRV') : n)))
  assert.equal(h.ws.tasks.length, 2)
  assert.equal(taskRows(h.ws, h.task).length, 1)
  assert.equal(plannedOn(h.ws, h.task), today)
  assert.deepEqual(taskRows(h.ws, 'editor-task:r1').map(r => r.page.id), ['trips'])
})

test('deleting the pasted row leaves the task; deleting the original leaves it on the other', () => {
  const h = pasted()
  h.save('trips', d => d.filter(n => n.id !== 'r1'))
  assert.equal(h.ws.tasks.length, 1)
  assert.equal(plannedOn(h.ws, h.task), today)
  const again = pasted()
  again.save(dayId(today), d => d.filter(n => n.props?.taskId !== again.task))
  assert.equal(again.ws.tasks.length, 1)
  assert.deepEqual(taskRows(again.ws, again.task).map(r => r.page.id), ['trips'])
})

test('counted once: a day holds it once, and tomorrow neither plans nor carries a reference row', () => {
  const h = pasted()
  h.day(tomorrow)
  h.save(dayId(tomorrow), d => [...d, row('r2', h.task, 'TRV')], { today })
  assert.deepEqual(getDayView(h.ws, today).planned.map(t => t.id), [h.task])
  assert.deepEqual(getDayView(h.ws, tomorrow).planned, [])
  assert.equal(getDayView(h.ws, today).openPool.filter(t => t.id === h.task).length, 1)
})
