// To-dos as a source (design §11, R2-8, R2-9, R2-11): his tasks read as a database's rows, and an edit is the task's own command.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, databaseRows, newRowValues, viewRows } from '../src/domain/database.ts'
import { buildSearchIndex, search } from '../src/domain/search.ts'
import { exportFiles } from '../src/domain/export.ts'
import { listedPages } from '../src/domain/page-tree.ts'
import { newTodo, todoChange, todoLine, todoRowId, todosDatabase, todosSourceId, withTodos } from '../src/domain/todos-source.ts'
import type { Page } from '../src/domain/types.ts'
import { draftView } from '../src/domain/day-draft.ts'
import { dayId, harness, heading, nodesOf, todo, today, tomorrow } from './v2-helpers.ts'

const context = { today, pageDate: null }
function tasks() {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => [...d, todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed'), todo('r3', 'Call the vet'), todo('r4', 'Fix the gate'), todo('blank', 'Soon blank')])
  // A line emptied after it had words: the task stays, with no title (B69).
  h.save(dayId(today), d => d.map(n => n.id === 'blank' ? { ...n, content: [] } : n))
  const id = (title: string) => h.task(title).id
  h.run({ type: 'task-status', taskId: id('Buy a dog bed'), status: 'done', today })
  h.run({ type: 'task-status', taskId: id('Call the vet'), status: 'cancelled' })
  h.run({ type: 'not-today', taskId: id('Fix the gate'), date: today })
  return { h, id }
}
const row = (h: ReturnType<typeof harness>, taskId: string) => withTodos(h.ws).pages.find(p => p.id === todoRowId(taskId)) as Page
const read = (h: ReturnType<typeof harness>, taskId: string, column: string) => cellValue(todosDatabase, row(h, taskId), column)

test('R2-8: each task with words is one row; a blank line and a deleted task are not; the first view is what is open', () => {
  const { h, id } = tasks()
  const projected = withTodos(h.ws)
  assert.ok(h.ws.tasks.some(t => !t.title.trim()), 'the blank line is a task')
  assert.equal(databaseRows(projected, todosSourceId).length, 4)
  assert.deepEqual(viewRows(projected, todosSourceId, todosDatabase.views[0]!, context).map(r => r.title), ['Book the flights'])
  assert.equal(read(h, id('Book the flights'), 'status'), 'open')
  assert.equal(read(h, id('Buy a dog bed'), 'status'), 'done')
  assert.equal(read(h, id('Call the vet'), 'status'), 'cancelled')
  assert.equal(read(h, id('Fix the gate'), 'status'), 'paused')
  assert.deepEqual(read(h, id('Book the flights'), 'planned'), { start: today })
  assert.equal(read(h, id('Book the flights'), 'page'), 'Oct 22')
})

test('R2-15: the source is only in what the layouts read: Pages, search and the export never see it', () => {
  const { h } = tasks()
  const ws = h.ws
  withTodos(ws)
  assert.ok(!ws.pages.some(p => p.id === todosSourceId))
  assert.ok(!listedPages(ws).some(p => p.id === todosSourceId))
  assert.ok(!search(buildSearchIndex(ws), 'To-dos').pages.some(x => x.page.id === todosSourceId))
  h.run({ type: 'create-document', title: 'Holder', body: '', pageId: 'holder' })
  h.save('holder', d => [...d, { id: 'v', type: 'database', props: { pageId: todosSourceId, view: '' }, children: [] }])
  assert.equal(h.page('holder').document.includes(todosSourceId), true, 'a block that shows it saves whole')
  assert.ok(!exportFiles(h.ws, new Date()).some(f => f.path.includes('To-dos')))
})

test('R2-9: an edit is the task command, with its notice', () => {
  const { h, id } = tasks()
  const open = id('Book the flights'), done = id('Buy a dog bed'), cancelled = id('Call the vet'), paused = id('Fix the gate')
  const change = (taskId: string, column: string, raw: unknown) => todoChange(h.ws, taskId, column, raw as never, today)
  assert.deepEqual(change(open, 'status', 'done'), { action: { type: 'task-status', taskId: open, status: 'done', today }, notice: 'Done' })
  assert.deepEqual(change(done, 'status', 'open'), { action: { type: 'task-status', taskId: done, status: 'open' }, notice: 'Reopened' })
  assert.deepEqual(change(cancelled, 'status', 'open'), { action: { type: 'task-status', taskId: cancelled, status: 'open' }, notice: 'Restored' })
  assert.deepEqual(change(open, 'status', 'cancelled'), { action: { type: 'task-status', taskId: open, status: 'cancelled' }, notice: 'Cancelled' })
  // Moving a card to Paused means Not today; out of it, back on today.
  assert.deepEqual(change(open, 'status', 'paused'), { action: { type: 'not-today', taskId: open, date: today }, notice: 'Not today' })
  assert.deepEqual(change(paused, 'status', 'open'), { action: { type: 'plan-task', taskId: paused, date: today, today }, notice: 'On today' })
  assert.deepEqual(change(done, 'status', 'paused'), { refused: 'Reopen it first' })
  assert.deepEqual(change(open, 'planned', { start: tomorrow }), { action: { type: 'plan-task', taskId: open, date: tomorrow, today, from: today }, notice: `Planned for ${tomorrow}` })
  assert.deepEqual(change(open, 'deadline', { start: tomorrow }), { action: { type: 'set-task-dates', taskId: open, deadlineOn: tomorrow }, notice: 'Deadline set' })
  assert.deepEqual(change(open, 'start', { start: tomorrow }), { action: { type: 'set-task-dates', taskId: open, attentionOn: tomorrow }, notice: 'Start set' })
  assert.deepEqual(change(open, 'title', 'New words'), { action: { type: 'rename-task', taskId: open, title: 'New words' }, notice: 'Renamed' })
})

test('R2-9: renaming to nothing keeps the words; a line with a chip stays as it is', () => {
  const { h, id } = tasks()
  const open = id('Book the flights')
  assert.equal(todoChange(h.ws, open, 'title', '   ', today), null)
  h.save(dayId(today), d => d.map(n => n.id === 'r1' ? { ...n, content: [{ type: 'text', text: 'Book the flights ', styles: {} }, { type: 'dateChip', props: {} }] } : n))
  assert.deepEqual(todoChange(h.ws, open, 'title', 'New words', today), { refused: 'Open its line to change it' })
})

test('R2-10: opening goes to its line; with no line left there is nowhere to go', () => {
  const { h, id } = tasks()
  const open = id('Book the flights')
  assert.deepEqual(todoLine(h.ws, open), { pageId: dayId(today), lineId: 'r1', taskId: open })
  h.save(dayId(today), d => d.filter(n => n.id !== 'r1'))
  assert.equal(todoLine(h.ws, open), null)
})

test('R2-11: a to-do added to a day with an unapplied draft leaves the draft valid', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => [...d, todo('r1', 'Book the flights')])
  const book = h.task('Book the flights').id
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => [heading('t', 'Top 3'), todo('s1', '', 'reference', ''), todo('s2', '', 'reference', '')])
  const day = h.day(tomorrow), slot = nodesOf(day)[1]!.id
  h.run({ type: 'set-draft', pageId: dayId(tomorrow), status: 'ready', moreOpen: [], allowedTaskIds: [book], items: [{ id: 'i0', anchor: slot, place: 'fill', taskId: book, source: 'model', state: 'open' }] })
  h.run({ type: 'add-task', pageId: dayId(tomorrow), title: 'From To-dos', plannedOn: tomorrow })
  assert.equal(draftView(h.ws, h.page(dayId(tomorrow)))!.items.length, 1)
  const r = h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ['i0'], today: tomorrow })
  assert.equal(r.receipt.message, 'Applied')
  assert.ok(nodesOf(h.page(dayId(tomorrow))).some(n => n.props?.taskId === book))
})

test('R2-11: + New is today, or the day a view is pinned to', () => {
  const view = todosDatabase.views[0]!
  assert.deepEqual(newTodo(view, context), { date: today, visible: true })
  const pinned = { ...view, filter: [{ by: 'planned', op: 'is' as const, value: { relative: 'pageDate' as const } }] }
  assert.equal(newRowValues(todosDatabase, pinned, { today, pageDate: tomorrow }).visible, true)
  assert.deepEqual(newTodo(pinned, { today, pageDate: tomorrow }), { date: tomorrow, visible: true })
  // Off a day page the rule is ignored (R2-4): today.
  assert.deepEqual(newTodo(pinned, context), { date: today, visible: true })
})
