// Repeating to-dos (docs/design/repeating-to-dos.md): a repeat names one current to-do; finishing it makes the next,
// a new to-do planned on its day. These are the behaviours of §4 as commands, with no screen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Automation } from '../src/domain/automations.ts'
import { writeSteps, type ButtonStep } from '../src/domain/buttons.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { todosSourceId } from '../src/domain/database.ts'
import { flatNodes, inlineText, pageNodes } from '../src/domain/editor-document.ts'
import { dueTodoRepeats, repeatOf, repeatTaskId, standingRepeats, todoRepeatLimits, type TodoRepeatRule } from '../src/domain/todo-repeats.ts'
import { liveTaskIds, plannedOn } from '../src/domain/workspace.ts'
import { bullet, chip, dayId, harness, pageRef, text, todo } from './v2-helpers.ts'

type H = ReturnType<typeof harness>
// Nov 23, 2026 is a Monday.
const sat21 = '2026-11-21', mon = '2026-11-23', tue = '2026-11-24', wed = '2026-11-25', thu = '2026-11-26', sat = '2026-11-28', nextMon = '2026-11-30', dec1 = '2026-12-01', dec7 = '2026-12-07'
const at = '2026-11-23T10:00:00.000Z'
const weekly: TodoRepeatRule = { every: 'week', interval: 1, from: 'schedule' }

/** One to-do planned on `day`'s page. */
function setup(day = mon, title = 'Weekly review') {
  const h = harness()
  h.day(day)
  h.save(dayId(day), d => [...d, todo('r-1', title, 'plan', day)], { today: day })
  return { h, id: h.task(title).id }
}
const setRepeat = (h: H, taskId: string, repeat: TodoRepeatRule | null, today = mon) => h.run({ type: 'set-todo-repeat', taskId, repeat, today, at })
const finish = (h: H, taskId: string, today: string, status: 'done' | 'cancelled' = 'done') => h.run({ type: 'task-status', taskId, status, today })
const reopen = (h: H, taskId: string, today = mon) => h.run({ type: 'task-status', taskId, status: 'open', today })
const the = (h: H) => { const r = h.ws.todoRepeats?.[0]; assert.ok(r, 'a repeat is stored'); return r }
const task = (h: H, id: string) => { const t = h.ws.tasks.find(x => x.id === id); assert.ok(t, `task ${id}`); return t }
const rows = (h: H, taskId: string) => h.ws.pages.flatMap(p => flatNodes(pageNodes(p)).filter(n => n.props?.taskId === taskId).map(node => ({ page: p.id, node })))
/** Finishes the repeat's current to-do on `today`; the one next it made. */
function next(h: H, today: string, status: 'done' | 'cancelled' = 'done') {
  const made = finish(h, the(h).taskId, today, status).receipt.nextTodos
  assert.equal(made?.length, 1, 'one next to-do')
  return made![0]!
}
const snapshot = (h: H) => JSON.stringify({ tasks: h.ws.tasks, docs: h.ws.pages.map(p => [p.id, p.document]) })

test('setting a repeat changes nothing but the repeat, says the rule, and one Undo takes it off', () => {
  const { h, id } = setup()
  const before = snapshot(h)
  const set = setRepeat(h, id, weekly)
  assert.equal(set.receipt.message, 'Repeats every week')
  assert.equal(set.receipt.entityId, id)
  const { id: repeatId, createdAt, ...stored } = the(h)
  assert.ok(repeatId && createdAt)
  assert.deepEqual(stored, { taskId: id, slot: mon, start: mon, every: 'week', interval: 1, from: 'schedule' })
  assert.equal(repeatOf(h.ws, id)?.id, repeatId)
  assert.equal(snapshot(h), before, 'no to-do, date or line moved')
  h.run({ type: 'undo', targetOperationId: set.receipt.operationId })
  assert.equal(h.ws.todoRepeats, undefined)
})

test('ticking the current one makes the next, planned on its day, and Undo takes back both', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  const repeatId = the(h).id
  const tick = finish(h, id, mon)
  assert.equal(tick.receipt.message, 'Done', 'an older tab reads only this')
  assert.deepEqual(tick.receipt.nextTodos, [{ taskId: repeatTaskId(repeatId, nextMon), on: nextMon }])
  const made = task(h, repeatTaskId(repeatId, nextMon))
  assert.deepEqual({ title: made.title, status: made.status, paused: made.paused, version: made.version, createdOn: made.createdOn, sourcePageId: made.sourcePageId },
    { title: 'Weekly review', status: 'open', paused: false, version: 1, createdOn: mon, sourcePageId: dayId(nextMon) })
  assert.equal(plannedOn(h.ws, made.id), nextMon)
  assert.deepEqual(rows(h, made.id).map(r => [r.page, r.node.props?.role, r.node.props?.planDate, inlineText(r.node.content)]), [[dayId(nextMon), 'plan', nextMon, 'Weekly review']])
  assert.deepEqual({ status: task(h, id).status, doneOn: task(h, id).doneOn }, { status: 'done', doneOn: mon })
  assert.equal(plannedOn(h.ws, id), mon, 'the finished one stays on its day')
  const { createdAt: _at, ...stored } = the(h)
  assert.deepEqual(stored, { id: repeatId, taskId: made.id, slot: nextMon, previous: { taskId: id, slot: mon }, start: mon, every: 'week', interval: 1, from: 'schedule' })
  h.run({ type: 'undo', targetOperationId: tick.receipt.operationId })
  assert.equal(task(h, id).status, 'open')
  assert.equal(h.ws.tasks.length, 1)
  assert.ok(!h.ws.pages.some(p => p.id === dayId(nextMon)), "the next one's day page is as it was: not there")
  assert.equal(the(h).taskId, id)
  assert.equal(the(h).previous, undefined)
})

test('done late skips what was missed, done early is the one after its own, and a carried daily lands tomorrow', () => {
  const late = setup()
  setRepeat(late.h, late.id, weekly)
  assert.equal(next(late.h, wed).on, nextMon)
  const early = setup()
  setRepeat(early.h, early.id, weekly, sat21)
  assert.equal(next(early.h, sat21).on, nextMon, 'the Monday after its own, not its own')
  const daily = setup()
  setRepeat(daily.h, daily.id, { every: 'day', interval: 1, from: 'schedule' })
  assert.equal(next(daily.h, wed).on, thu)
})

test('no second one while it is open: moved or set aside, the repeat waits and its schedule stays', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  h.run({ type: 'plan-task', taskId: id, date: wed, from: mon, today: mon })
  assert.equal(the(h).slot, mon, 'Another day moves the to-do, not the schedule')
  h.run({ type: 'not-today', taskId: id, date: wed })
  assert.equal(task(h, id).paused, true)
  assert.deepEqual(dueTodoRepeats(h.ws, thu), [])
  assert.equal(h.ws.tasks.length, 1)
  h.run({ type: 'plan-task', taskId: id, date: thu, today: thu })
  assert.equal(next(h, thu).on, nextMon, 'by the schedule from its own day, not from where it was moved to')
  assert.equal(h.ws.tasks.length, 2)
})

test('"When it\'s done" counts from the day it was finished, and keeps no weekdays', () => {
  const { h, id } = setup(tue, 'Water the plants')
  setRepeat(h, id, { every: 'day', interval: 5, from: 'done', weekdays: [1, 4] }, tue)
  assert.equal(the(h).weekdays, undefined)
  assert.equal(setRepeat(h, id, { every: 'day', interval: 5, from: 'done', until: '2027-01-01' }, tue).receipt.message, "Repeats every 5 days, from when it's done")
  const made = next(h, '2026-11-27')
  assert.equal(made.on, '2026-12-02')
  assert.equal(the(h).slot, '2026-12-02')
})

test('monthly from the 31st keeps the 31st after a February', () => {
  const { h, id } = setup('2026-01-31', 'Pay rent')
  setRepeat(h, id, { every: 'month', interval: 1, from: 'schedule' }, '2026-01-31')
  assert.equal(next(h, '2026-01-31').on, '2026-02-28')
  assert.equal(next(h, '2026-02-28').on, '2026-03-31')
  assert.equal(the(h).start, '2026-01-31')
})

test('weekdays: two a week every 2 weeks, and ones that leave its own day out', () => {
  const two = setup()
  setRepeat(two.h, two.id, { every: 'week', interval: 2, from: 'schedule', weekdays: [4, 1] })
  assert.deepEqual(the(two.h).weekdays, [1, 4])
  assert.equal(next(two.h, mon).on, thu)
  assert.equal(next(two.h, thu).on, dec7, 'the week between is skipped')
  const out = setup()
  assert.equal(setRepeat(out.h, out.id, { every: 'week', interval: 1, from: 'schedule', weekdays: [3] }).receipt.message, 'Repeats every week on Wed')
  assert.equal(plannedOn(out.h.ws, out.id), mon, 'the current one stays where it is')
  assert.equal(the(out.h).slot, mon)
  assert.equal(next(out.h, mon).on, wed)
  // Its own weekday alone is the default, so it isn't kept.
  const own = setup()
  setRepeat(own.h, own.id, { every: 'week', interval: 1, from: 'schedule', weekdays: [1] })
  assert.equal(the(own.h).weekdays, undefined)
})

test('changing Repeat, Every or the weekdays starts the schedule again from its own day; From and Ends alone do not, and no date moves', () => {
  const { h, id } = setup('2026-01-31', 'Pay rent')
  const monthly: TodoRepeatRule = { every: 'month', interval: 1, from: 'schedule' }
  setRepeat(h, id, monthly, '2026-01-31')
  const feb = next(h, '2026-01-31')
  // Ends alone: the schedule still starts on the 31st.
  setRepeat(h, feb.taskId, { ...monthly, until: '2027-01-01' }, '2026-02-01')
  assert.equal(the(h).start, '2026-01-31')
  // Every: it starts again from the current one's own day, and that day doesn't move.
  const changed = setRepeat(h, feb.taskId, { ...monthly, interval: 2, until: '2027-01-01' }, '2026-02-01')
  assert.equal(changed.receipt.message, 'Repeats every 2 months')
  assert.equal(the(h).start, '2026-02-28')
  assert.equal(the(h).slot, '2026-02-28')
  assert.equal(plannedOn(h.ws, feb.taskId), '2026-02-28')
  assert.equal(next(h, '2026-02-28').on, '2026-04-28')
  assert.throws(() => setRepeat(h, the(h).taskId, { ...monthly, interval: 2, until: '2027-01-01' }, '2026-03-01'), /Nothing to change/)
})

test('Ends on a date: the last one makes no next and stays the current one', () => {
  const { h, id } = setup()
  setRepeat(h, id, { ...weekly, until: '2026-11-29' })
  const tick = finish(h, id, mon)
  assert.equal(tick.receipt.nextTodos, undefined)
  assert.equal(h.ws.tasks.length, 1)
  assert.equal(the(h).taskId, id)
  assert.deepEqual(dueTodoRepeats(h.ws, wed), [], 'nothing for the mend to do, on every open')
  const last = setup()
  setRepeat(last.h, last.id, { ...weekly, until: nextMon })
  assert.equal(next(last.h, mon).on, nextMon, 'the end day itself is made')
})

test('Cancel skips this one and makes the next; sent without a day, the mend makes it on opening the app', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  const skipped = finish(h, id, mon, 'cancelled')
  assert.equal(skipped.receipt.message, 'Cancelled')
  assert.equal(skipped.receipt.nextTodos?.[0]?.on, nextMon)
  assert.equal(task(h, id).status, 'cancelled')
  // An older tab's Cancel carries no day.
  const old = setup()
  setRepeat(old.h, old.id, weekly)
  const bare = old.h.run({ type: 'task-status', taskId: old.id, status: 'cancelled' })
  assert.equal(bare.receipt.nextTodos, undefined)
  assert.equal(old.h.ws.tasks.length, 1)
  assert.deepEqual(dueTodoRepeats(old.h.ws, wed).map(d => d.on), [nextMon])
  const mend = old.h.run({ type: 'run-repeats', today: wed, time: '09:00', at })
  assert.equal(mend.receipt.nextTodos, undefined, 'the mend says nothing')
  assert.equal(plannedOn(old.h.ws, the(old.h).taskId), nextMon)
  assert.deepEqual(dueTodoRepeats(old.h.ws, wed), [])
  old.h.run({ type: 'run-repeats', today: thu, time: '09:00', at })
  assert.equal(old.h.ws.tasks.length, 2, 'once')
})

test('reopening the one just finished takes the next one back while it is as it was made', () => {
  for (const status of ['done', 'cancelled'] as const) {
    const { h, id } = setup()
    setRepeat(h, id, weekly)
    const made = next(h, mon, status)
    // Restore after Cancel carries no day in an older tab; the box's second tap does.
    if (status === 'done') reopen(h, id); else h.run({ type: 'task-status', taskId: id, status: 'open' })
    assert.deepEqual(h.ws.tasks.map(t => [t.id, t.status]), [[id, 'open']], status)
    assert.ok(!h.ws.deletedTasks.some(t => t.id === made.taskId), 'gone, not in the bin of deleted to-dos')
    assert.deepEqual(rows(h, made.taskId), [], 'its line is gone from its day')
    assert.equal(the(h).taskId, id)
    assert.equal(the(h).slot, mon)
    assert.equal(the(h).previous, undefined)
    // And it can be ticked again.
    assert.equal(next(h, mon).on, nextMon)
  }
})

test('a next one he has touched stays, and so does the reopened one; only one step back is remembered', () => {
  const moved = setup()
  setRepeat(moved.h, moved.id, weekly)
  const a = next(moved.h, mon)
  moved.h.run({ type: 'plan-task', taskId: a.taskId, date: dec1, from: nextMon, today: mon })
  reopen(moved.h, moved.id)
  assert.deepEqual(moved.h.ws.tasks.map(t => t.status), ['open', 'open'])
  assert.equal(the(moved.h).taskId, a.taskId, 'the repeat stays with the next one; the reopened one is an ordinary to-do')
  assert.equal(finish(moved.h, moved.id, mon).receipt.nextTodos, undefined)

  const renamed = setup()
  setRepeat(renamed.h, renamed.id, weekly)
  const b = next(renamed.h, mon)
  renamed.h.run({ type: 'rename-task', taskId: b.taskId, title: 'Weekly review, short' })
  reopen(renamed.h, renamed.id)
  assert.equal(renamed.h.ws.tasks.length, 2)

  const ticked = setup()
  setRepeat(ticked.h, ticked.id, weekly)
  const c = next(ticked.h, mon)
  const d = next(ticked.h, nextMon)
  assert.equal(d.on, dec7)
  reopen(ticked.h, ticked.id, nextMon)
  assert.equal(ticked.h.ws.tasks.length, 3, 'two steps back: an ordinary open to-do, nothing taken back')
  assert.deepEqual(the(ticked.h).previous, { taskId: c.taskId, slot: nextMon })
})

test("deleting the current one's last line takes the repeat out of force and keeps it; Undo brings it back", () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  const cut = h.save(dayId(mon), d => d.filter(n => n.id !== 'r-1'), { today: mon })
  assert.equal(h.ws.tasks.length, 0)
  assert.equal(h.ws.todoRepeats?.length, 1, 'kept, as links are')
  assert.deepEqual(standingRepeats(h.ws), [])
  assert.equal(repeatOf(h.ws, id), undefined)
  assert.deepEqual(dueTodoRepeats(h.ws, wed), [])
  h.run({ type: 'undo', targetOperationId: cut.receipt.operationId })
  assert.equal(standingRepeats(h.ws).length, 1)
  assert.equal(repeatOf(h.ws, id)?.taskId, id)
})

test('the next one copies the words with their chip moved, Start and Deadline keep their distance, and nested lines stay behind', () => {
  const h = harness()
  h.day(mon)
  h.run({ type: 'create-document', title: 'Trip', body: '', pageId: 'trip' })
  h.save(dayId(mon), d => [...d, { ...todo('r-1', '', 'plan', mon, [bullet('b-1', text('step one'))]), content: [text('Send the report '), chip('ev-1', mon, '09:30'), text(' see '), pageRef('trip', 'ref-1')] }], { today: mon })
  const id = h.ws.tasks[0]!.id
  h.run({ type: 'set-task-dates', taskId: id, attentionOn: '2026-11-22', deadlineOn: wed })
  setRepeat(h, id, weekly)
  const was = rows(h, id)[0]!.node.content as Array<{ type: string; text?: string; props?: Record<string, string> }>
  const made = next(h, mon)
  assert.deepEqual({ attentionOn: task(h, made.taskId).attentionOn, deadlineOn: task(h, made.taskId).deadlineOn }, { attentionOn: '2026-11-29', deadlineOn: '2026-12-02' })
  const row = rows(h, made.taskId)[0]!.node
  const now = row.content as typeof was
  assert.deepEqual(now.map(c => c.type), was.map(c => c.type))
  assert.deepEqual(now.filter(c => c.type === 'text'), was.filter(c => c.type === 'text'))
  const chipWas = was.find(c => c.type === 'dateMention')!, chipNow = now.find(c => c.type === 'dateMention')!
  assert.equal(chipNow.props!.date, nextMon, 'moved by the same number of days')
  assert.equal(chipNow.props!.time, chipWas.props!.time, 'its time kept')
  assert.notEqual(chipNow.props!.eventId, chipWas.props!.eventId, 'its own event, so its own reminder')
  const refWas = was.find(c => c.type === 'pageRef')!, refNow = now.find(c => c.type === 'pageRef')!
  assert.equal(refNow.props!.pageId, 'trip')
  assert.notEqual(refNow.props!.refId, refWas.props!.refId)
  assert.deepEqual(row.children ?? [], [], 'nested lines stay with the finished one')
  assert.equal(task(h, made.taskId).title, inlineText(row.content, nextMon), 'its title is its line read on its own day')
})

test('a to-do with no Planned day, or set aside, starts its schedule today; its next one gets a day page', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Trip', body: '', pageId: 'trip' })
  h.save('trip', d => [...d, todo('r-9', 'Check the bookings', 'reference', '')], { today: tue })
  const id = h.task('Check the bookings').id
  assert.equal(plannedOn(h.ws, id), null)
  setRepeat(h, id, weekly, tue)
  assert.deepEqual([the(h).start, the(h).slot], [tue, tue])
  const made = next(h, thu)
  assert.equal(made.on, dec1, 'the first Tuesday after its own day and the day it was done')
  assert.deepEqual(rows(h, made.taskId).map(r => r.page), [dayId(dec1)])
  const paused = setup()
  paused.h.run({ type: 'not-today', taskId: paused.id, date: mon })
  setRepeat(paused.h, paused.id, weekly, wed)
  assert.deepEqual([the(paused.h).start, the(paused.h).slot], [wed, wed])
})

test('what is refused: a finished or missing to-do, a rule that says nothing new, a bad rule', () => {
  const { h, id } = setup()
  assert.throws(() => setRepeat(h, id, null), /Nothing to change/)
  assert.throws(() => setRepeat(h, 'nope', weekly), /That to-do was deleted/)
  assert.throws(() => setRepeat(h, id, { ...weekly, interval: 0 }), /Invalid repeat/)
  assert.throws(() => setRepeat(h, id, { ...weekly, interval: 1.5 }), /Invalid repeat/)
  assert.throws(() => setRepeat(h, id, { ...weekly, weekdays: [7] }), /Invalid repeat/)
  assert.throws(() => setRepeat(h, id, { ...weekly, weekdays: [] }), /Invalid repeat/)
  assert.throws(() => setRepeat(h, id, { ...weekly, until: '2026-02-30' }), /Invalid calendar date/)
  setRepeat(h, id, weekly)
  assert.throws(() => setRepeat(h, id, weekly), /Nothing to change/)
  finish(h, id, mon)
  assert.throws(() => setRepeat(h, id, { ...weekly, interval: 2 }), /Reopen it first/)
  assert.equal(h.ws.todoRepeats?.length, 1)
})

test('Off keeps every to-do it made, as ordinary to-dos, and only the current one turns it off', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  const made = next(h, mon)
  assert.throws(() => setRepeat(h, id, null), /Nothing to change/, 'the finished one is no longer the current one')
  const off = setRepeat(h, made.taskId, null)
  assert.equal(off.receipt.message, 'Repeat off')
  assert.equal(h.ws.todoRepeats, undefined)
  assert.deepEqual(h.ws.tasks.map(t => t.status), ['done', 'open'])
  h.run({ type: 'undo', targetOperationId: off.receipt.operationId })
  assert.equal(the(h).taskId, made.taskId, 'one Undo brings the repeat back')
  setRepeat(h, made.taskId, null)
  assert.equal(finish(h, made.taskId, nextMon).receipt.nextTodos, undefined)
  assert.equal(h.ws.tasks.length, 2)
})

test('the mend after a tick that made no next one never writes to a past day, and runs once', () => {
  // The floor build's server ticks it and knows nothing of repeats: the to-do is done, the repeat still names it.
  const floorTick = (h: H, id: string, doneOn: string | null) => { h.ws = { ...h.ws, tasks: h.ws.tasks.map(t => (t.id === id ? { ...t, status: 'done' as const, doneOn, version: t.version + 1 } : t)) } }
  const run = (h: H, today: string) => h.run({ type: 'run-repeats', today, time: '09:00', at })
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  floorTick(h, id, mon)
  assert.deepEqual(dueTodoRepeats(h.ws, sat).map(d => [d.repeat.taskId, d.on]), [[id, nextMon]])
  run(h, sat)
  assert.equal(plannedOn(h.ws, the(h).taskId), nextMon)
  assert.deepEqual(the(h).previous, { taskId: id, slot: mon })
  run(h, nextMon)
  assert.equal(h.ws.tasks.length, 2, 'once')
  assert.equal(h.ws.undo, undefined, 'the app made it, so there is nothing of his to undo')

  const daily = setup()
  setRepeat(daily.h, daily.id, { every: 'day', interval: 1, from: 'schedule' })
  floorTick(daily.h, daily.id, mon)
  run(daily.h, sat)
  assert.equal(plannedOn(daily.h.ws, the(daily.h).taskId), sat, 'five days late: today, not Tuesday')

  const fromDone = setup()
  setRepeat(fromDone.h, fromDone.id, { every: 'day', interval: 5, from: 'done' })
  floorTick(fromDone.h, fromDone.id, mon)
  run(fromDone.h, '2026-12-05')
  assert.equal(plannedOn(fromDone.h.ws, the(fromDone.h).taskId), '2026-12-05', 'its day has passed: today')
})

test('a tick from a To-dos view makes the next one too, and its Cancel carries the day', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  const done = h.run({ type: 'edit-todos', items: [{ taskId: id, changes: [{ columnId: 'status', value: 'done' }] }], today: mon })
  assert.deepEqual(done.receipt.nextTodos?.map(n => n.on), [nextMon])
  const cancelled = h.run({ type: 'edit-todos', items: [{ taskId: the(h).taskId, changes: [{ columnId: 'status', value: 'cancelled' }] }], today: nextMon })
  assert.deepEqual(cancelled.receipt.nextTodos?.map(n => n.on), [dec7])
  assert.equal(h.ws.tasks.length, 3)
})

test('two ticks of the same one make one next', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  finish(h, id, mon)
  const again = finish(h, id, tue)
  assert.equal(again.receipt.nextTodos, undefined)
  assert.equal(h.ws.tasks.length, 2)
  assert.equal(the(h).slot, nextMon)
})

test('a rule on To-dos set off by a to-do added runs once for the next one, and not again on what that sets off', () => {
  const log: ButtonStep = { id: 's-log', kind: 'add-row', databaseId: 'log', databaseName: 'Log', title: '', titleFormula: '"Added: " + prop("title")', set: [] }
  const rule: Automation = { id: 'r-added', name: 'Log added', active: true, triggers: [{ kind: 'row-added' } as never], steps: writeSteps([log]) }
  const h = harness()
  h.run({ type: 'create-database', pageId: 'log', homeBlockId: null, title: 'Log' })
  h.run({ type: 'change-database', pageId: todosSourceId, change: { kind: 'addAutomation', automation: rule } } as never)
  h.day(mon)
  h.save(dayId(mon), d => [...d, todo('r-1', 'Weekly review', 'plan', mon)], { today: mon })
  const logged = () => h.ws.pages.filter(p => p.parentId === 'log' && !p.trashedAt).map(p => p.title)
  assert.deepEqual(logged(), ['Added: Weekly review'])
  setRepeat(h, h.task('Weekly review').id, weekly)
  assert.equal(next(h, mon).on, nextMon)
  assert.deepEqual(logged(), ['Added: Weekly review', 'Added: Weekly review'])
})

// Edges the design implies but doesn't spell out.
test("the next one's day page is in Trash: it lands on a new page for that day", () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  h.day(nextMon)
  h.run({ type: 'delete-page', pageId: dayId(nextMon), at })
  const made = next(h, mon)
  assert.equal(plannedOn(h.ws, made.taskId), nextMon)
  const on = rows(h, made.taskId).map(r => h.page(r.page))
  assert.deepEqual(on.map(p => [p.date, Boolean(p.trashedAt)]), [[nextMon, false]])
})

test('a finished current one whose page is in Trash is not mended, so opening the app writes nothing', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  h.ws = { ...h.ws, tasks: h.ws.tasks.map(t => ({ ...t, status: 'done' as const, doneOn: mon, version: t.version + 1 })) }
  h.run({ type: 'delete-page', pageId: dayId(mon), at })
  assert.deepEqual(dueTodoRepeats(h.ws, sat, liveTaskIds(h.ws)), [])
  h.run({ type: 'run-repeats', today: sat, time: '09:00', at })
  assert.equal(h.ws.tasks.length, 1)
  assert.equal(the(h).taskId, id)
  assert.throws(() => setRepeat(h, id, { ...weekly, interval: 2 }), /Reopen it first|in Trash/)
  // Back from Trash, it is mended: the page being in Trash was what held it.
  h.run({ type: 'restore-page', pageId: dayId(mon) })
  h.run({ type: 'run-repeats', today: sat, time: '09:00', at })
  assert.equal(h.ws.tasks.length, 2)
  assert.equal(plannedOn(h.ws, the(h).taskId), nextMon)
})

test('a to-do two repeats remember: reopening it takes back only the next one that is as made', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  const a = next(h, mon)
  h.run({ type: 'plan-task', taskId: a.taskId, date: dec1, from: nextMon, today: mon })
  reopen(h, id)
  // Now an ordinary to-do, given a repeat of its own.
  setRepeat(h, id, { every: 'day', interval: 1, from: 'schedule' })
  assert.equal(h.ws.todoRepeats?.length, 2)
  const second = finish(h, id, mon).receipt.nextTodos
  assert.deepEqual(second?.map(n => n.on), [tue])
  reopen(h, id)
  assert.deepEqual(h.ws.tasks.map(t => t.id).sort(), [id, a.taskId].sort(), 'the daily next one went; the moved weekly one stayed')
  assert.equal(repeatOf(h.ws, id)?.every, 'day')
  assert.equal(repeatOf(h.ws, a.taskId)?.every, 'week')
})

test('a next one that already exists is adopted, not made twice', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  const taken = repeatTaskId(the(h).id, nextMon)
  h.day(nextMon)
  h.save(dayId(nextMon), d => [...d, { ...todo('r-x', 'Weekly review', 'plan', nextMon), props: { taskId: taken, role: 'plan', planDate: nextMon } }], { today: mon })
  assert.equal(h.ws.tasks.length, 2)
  const tick = finish(h, id, mon)
  assert.deepEqual(tick.receipt.nextTodos, [{ taskId: taken, on: nextMon }])
  assert.equal(h.ws.tasks.length, 2)
  assert.equal(rows(h, taken).length, 1, 'no second line')
  assert.equal(the(h).taskId, taken)
})

// Found by the whole-branch review: the day rules where a tick and the mend have to agree.
test('"When it\'s done", two finished on one day: the next is after its own day, never itself', () => {
  const { h, id } = setup()
  setRepeat(h, id, { every: 'day', interval: 1, from: 'done' })
  const first = next(h, mon)
  assert.equal(first.on, tue)
  const second = next(h, mon)
  assert.equal(second.on, wed, 'finished plus the interval is its own day, so its own day plus the interval')
  assert.notEqual(second.taskId, first.taskId)
  assert.equal(h.ws.tasks.length, 3)
  assert.deepEqual(the(h).previous, { taskId: first.taskId, slot: tue })
  assert.deepEqual(dueTodoRepeats(h.ws, mon), [])
})

test('the last one finished late on a schedule day ends the repeat, and the mend makes no other that day', () => {
  for (const status of ['done', 'cancelled'] as const) {
    const { h, id } = setup()
    setRepeat(h, id, { ...weekly, until: nextMon })
    const last = finish(h, id, nextMon, status)
    assert.equal(last.receipt.nextTodos, undefined, status)
    assert.equal(the(h).finishedOn, nextMon, 'the day a build that knows repeats saw it finished and made none')
    assert.deepEqual(dueTodoRepeats(h.ws, nextMon), [], status)
    h.run({ type: 'run-repeats', today: nextMon, time: '09:00', at })
    assert.equal(h.ws.tasks.length, 1, status)
    reopen(h, id, nextMon)
    assert.equal(the(h).finishedOn, undefined, 'open again: nothing is finished')
  }
})

test('after the mend nothing is due that day, whatever the rule', () => {
  const rules: TodoRepeatRule[] = [weekly, { ...weekly, until: nextMon }, { every: 'day', interval: 1, from: 'schedule' }, { every: 'day', interval: 1, from: 'done' },
    { every: 'day', interval: 5, from: 'done', until: sat }, { every: 'month', interval: 1, from: 'schedule' }]
  for (const rule of rules) for (const doneOn of [mon, null]) for (const today of [mon, wed, nextMon, dec7]) {
    const { h, id } = setup()
    setRepeat(h, id, rule)
    h.ws = { ...h.ws, tasks: h.ws.tasks.map(t => ({ ...t, status: 'done' as const, doneOn, version: t.version + 1 })) }
    h.run({ type: 'run-repeats', today, time: '09:00', at })
    assert.deepEqual(dueTodoRepeats(h.ws, today, liveTaskIds(h.ws)), [], JSON.stringify({ rule, doneOn, today }))
  }
})

test('a next one given a blocker has been touched: it stays', () => {
  const { h, id } = setup()
  setRepeat(h, id, weekly)
  h.save(dayId(mon), d => [...d, todo('r-2', 'Other', 'plan', mon)], { today: mon })
  const made = next(h, mon)
  h.run({ type: 'link-tasks', taskId: made.taskId, add: [h.task('Other').id], remove: [], at })
  reopen(h, id)
  assert.ok(h.ws.tasks.some(t => t.id === made.taskId))
  assert.equal(the(h).taskId, made.taskId)
})

test('over the limit the whole change is refused', () => {
  const kept = todoRepeatLimits.total
  todoRepeatLimits.total = 2
  try {
    const h = harness()
    h.day(mon)
    h.save(dayId(mon), d => [...d, todo('r-1', 'One', 'plan', mon), todo('r-2', 'Two', 'plan', mon), todo('r-3', 'Three', 'plan', mon)], { today: mon })
    setRepeat(h, h.task('One').id, weekly)
    setRepeat(h, h.task('Two').id, weekly)
    assert.throws(() => setRepeat(h, h.task('Three').id, weekly), /2 repeating to-dos at most/)
    assert.equal(h.ws.todoRepeats?.length, 2)
    // One whose to-do is gone doesn't count.
    h.save(dayId(mon), d => d.filter(n => n.id !== 'r-1'), { today: mon })
    setRepeat(h, h.task('Three').id, weekly)
    assert.equal(standingRepeats(h.ws).length, 2)
  } finally { todoRepeatLimits.total = kept }
})

test('the command passes the schema, and a rule out of range does not', () => {
  const ok = (repeat: unknown) => commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'set-todo-repeat', taskId: 't', repeat, today: mon, at } }).success
  assert.equal(ok(weekly), true)
  assert.equal(ok(null), true)
  assert.equal(ok({ every: 'week', interval: 2, from: 'done', weekdays: [1, 4], until: nextMon }), true)
  assert.equal(ok({ ...weekly, interval: 1000 }), false)
  assert.equal(ok({ ...weekly, every: 'hour' }), false)
  assert.equal(ok({ ...weekly, from: 'start' }), false)
  assert.equal(ok({ ...weekly, weekdays: [0, 1, 2, 3, 4, 5, 6, 0] }), false)
})
