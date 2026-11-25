// The mend on opening the app (repeating-to-dos.md §6): one repeat whose next to-do can't be made must not refuse the
// whole command, which also makes repeating rows and runs scheduled rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueTodoRepeats, type TodoRepeatRule } from '../src/domain/todo-repeats.ts'
import { plannedOn } from '../src/domain/workspace.ts'
import { dayId, harness, todo } from './v2-helpers.ts'

// Nov 23, 2026 is a Monday.
const mon = '2026-11-23', sat = '2026-11-28', nextMon = '2026-11-30'
const at = '2026-11-23T10:00:00.000Z'
const rules: Record<string, TodoRepeatRule> = { 'Weekly review': { every: 'week', interval: 1, from: 'schedule' }, 'Water the plants': { every: 'day', interval: 1, from: 'schedule' } }

for (const order of [['Weekly review', 'Water the plants'], ['Water the plants', 'Weekly review']]) {
  test(`a repeat the mend can't make a next one for is left as it was, and the others are mended (${order.join(', ')})`, () => {
    const h = harness()
    h.day(mon)
    h.save(dayId(mon), d => [...d, todo('r-1', 'Weekly review', 'plan', mon), todo('r-2', 'Water the plants', 'plan', mon)], { today: mon })
    const weeklyId = h.task('Weekly review').id, dailyId = h.task('Water the plants').id
    for (const title of order) h.run({ type: 'set-todo-repeat', taskId: h.task(title).id, repeat: rules[title]!, today: mon, at })
    // Nov 30's page id is taken by a document, so making that day's page throws ("Page id already in use").
    h.run({ type: 'create-document', title: 'In the way', body: '', pageId: dayId(nextMon) })
    // The floor build's ticks: both done, and both repeats still name them.
    h.ws = { ...h.ws, tasks: h.ws.tasks.map(t => ({ ...t, status: 'done' as const, doneOn: mon, version: t.version + 1 })) }
    assert.deepEqual(Object.fromEntries(dueTodoRepeats(h.ws, sat).map(d => [d.repeat.taskId, d.on])), { [weeklyId]: nextMon, [dailyId]: sat })
    const before = h.ws
    const mend = h.run({ type: 'run-repeats', today: sat, time: '09:00', at })
    assert.equal(mend.receipt.message, 'Nothing due', 'the mend says nothing')
    const daily = h.ws.todoRepeats!.find(r => r.previous?.taskId === dailyId)
    assert.ok(daily, 'the daily one moved on to its next')
    assert.equal(plannedOn(h.ws, daily.taskId), sat)
    assert.equal(h.ws.tasks.length, before.tasks.length + 1, 'one next to-do, and nothing half made')
    assert.deepEqual(h.ws.todoRepeats!.find(r => r.taskId === weeklyId), before.todoRepeats!.find(r => r.taskId === weeklyId), 'the stuck one is as it was')
    assert.equal(h.ws.pages.find(p => p.id === dayId(nextMon))?.type, 'document')
    assert.deepEqual(dueTodoRepeats(h.ws, sat).map(d => d.repeat.taskId), [weeklyId], 'still due: the next open tries again')
  })
}
