// What is drawn before the server answers (repeating-to-dos.md §3): the tick, at once; never the next to-do or its line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawnWorkspace } from '../src/components/draw-ahead.ts'
import { capture } from '../src/components/outbox.ts'
import { repeatsIn } from '../src/components/todo-repeat-view.ts'
import { repeatTaskId, type TodoRepeatRule } from '../src/domain/todo-repeats.ts'
import type { Action, Command, Workspace } from '../src/domain/types.ts'
import { applyCommand } from '../src/domain/workspace.ts'
import { dayId, harness, todo } from './v2-helpers.ts'

// Nov 23, 2026 is a Monday.
const mon = '2026-11-23', sat = '2026-11-28', nextMon = '2026-11-30'
const at = '2026-11-23T10:00:00.000Z'
const weekly: TodoRepeatRule = { every: 'week', interval: 1, from: 'schedule' }
/** A weekly to-do and a plain one on Monday's page; next Monday's page is there too. */
function setup(repeating = true) {
  const h = harness()
  h.day(mon)
  h.save(dayId(mon), d => [...d, todo('r-1', 'Weekly review', 'plan', mon), todo('r-2', 'Alpha', 'plan', mon)], { today: mon })
  const id = h.task('Weekly review').id
  if (repeating) h.run({ type: 'set-todo-repeat', taskId: id, repeat: weekly, today: mon, at })
  h.day(nextMon)
  return { h, id, alpha: h.task('Alpha').id }
}
const command = (ws: Workspace, action: Action, operationId = 'drawn-1'): Command => ({ operationId, expectedRevision: ws.revision, action })
const status = (taskId: string, to: 'done' | 'cancelled' | 'open' = 'done') => ({ type: 'task-status', taskId, status: to, today: mon }) as Action
const lines = (ws: Workspace) => ws.pages.map(p => [p.id, p.document])
const stateOf = (ws: Workspace, id: string) => { const t = ws.tasks.find(x => x.id === id)!; return { status: t.status, doneOn: t.doneOn } }

test('a tick not yet answered is drawn as the tick alone: no next to-do, no line, no page touched', () => {
  const { h, id } = setup(), before = h.ws
  for (const action of [status(id), status(id, 'cancelled'), { type: 'edit-todos', items: [{ taskId: id, changes: [{ columnId: 'status', value: 'done' }] }], today: mon } as Action]) {
    const drawn = drawnWorkspace(before, command(before, action))
    assert.notEqual(stateOf(drawn, id).status, 'open', action.type)
    assert.equal(drawn.tasks.length, before.tasks.length, 'no next to-do')
    assert.deepEqual(lines(drawn), lines(before), 'no page document changes')
    assert.deepEqual(drawn.todoRepeats, before.todoRepeats)
    assert.equal(drawn.revision, before.revision + 1)
    assert.equal(repeatsIn(drawn).size, 0, 'the finished one carries no icon')
  }
  assert.deepEqual(stateOf(drawnWorkspace(before, command(before, status(id))), id), { status: 'done', doneOn: mon })
})

test('a reopen not yet answered leaves the next one on screen, and the mend draws nothing', () => {
  const { h, id } = setup()
  h.run(status(id))
  const ticked = h.ws
  const reopened = drawnWorkspace(ticked, command(ticked, status(id, 'open')))
  assert.equal(stateOf(reopened, id).status, 'open')
  assert.equal(reopened.tasks.length, ticked.tasks.length)
  assert.deepEqual(lines(reopened), lines(ticked))
  const floor = setup()
  floor.h.ws = { ...floor.h.ws, tasks: floor.h.ws.tasks.map(t => (t.id === floor.id ? { ...t, status: 'done' as const, doneOn: mon, version: t.version + 1 } : t)) }
  const mended = drawnWorkspace(floor.h.ws, command(floor.h.ws, { type: 'run-repeats', today: sat, time: '09:00', at }))
  assert.equal(mended.tasks.length, floor.h.ws.tasks.length)
  assert.deepEqual(lines(mended), lines(floor.h.ws))
})

test('setting a repeat and turning it off are drawn at once; set and ticked while both are unsent, it is a finished to-do with no next one', () => {
  const { h, id } = setup(false)
  let ws = h.ws
  const n = ws.tasks.length
  ws = drawnWorkspace(ws, command(ws, { type: 'set-todo-repeat', taskId: id, repeat: weekly, today: mon, at }, 'a'))
  assert.equal(repeatsIn(ws).get(id)?.every, 'week')
  const ticked = drawnWorkspace(ws, command(ws, status(id), 'b'))
  assert.equal(ticked.tasks.length, n)
  assert.equal(ticked.todoRepeats?.length, 1)
  assert.equal(repeatsIn(ticked).size, 0)
  const off = drawnWorkspace(ws, command(ws, { type: 'set-todo-repeat', taskId: id, repeat: null, today: mon, at }, 'c'))
  assert.equal(off.todoRepeats, undefined)
})

test('with no repeat in the workspace, what is drawn is the command, nothing less', () => {
  const { h, alpha } = setup(false)
  const c = command(h.ws, status(alpha))
  assert.deepEqual(drawnWorkspace(h.ws, c), applyCommand(h.ws, c).workspace)
})

test('what is stored for sending still names the next to-do, its repeat and its page, so the row check knows', () => {
  const { h, id } = setup()
  const repeatId = h.ws.todoRepeats![0]!.id
  const { writes } = capture(h.ws, status(id), 'tick', false).entry
  for (const key of [`task:${id}`, `task:${repeatTaskId(repeatId, nextMon)}`, `repeat:${repeatId}`, `page:${dayId(nextMon)}`]) assert.ok(writes.includes(key), key)
})
