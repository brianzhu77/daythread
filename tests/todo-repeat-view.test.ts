// Repeating to-dos, the screen (docs/design/repeating-to-dos.md §3): its words, the editor's fields, the index behind
// the icon and what a command must hold, as pure functions. The copy and the dates are the design's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mendKey, nextDayLabel, nextLine, noticeWithNext, repeatFields, repeatMarkName, repeatMenuLabel, repeatPages, repeatsIn, ruleAfter, undoHoldPages, type RepeatEdit } from '../src/components/todo-repeat-view.ts'
import { dueTodoRepeats, type TodoRepeat, type TodoRepeatRule } from '../src/domain/todo-repeats.ts'
import type { Action, Workspace } from '../src/domain/types.ts'
import { dayId, harness, todo } from './v2-helpers.ts'

type H = ReturnType<typeof harness>
// Nov 23, 2026 is a Monday.
const mon = '2026-11-23', tue = '2026-11-24', sat = '2026-11-28', nextMon = '2026-11-30', dec7 = '2026-12-07', dec14 = '2026-12-14'
const at = '2026-11-23T10:00:00.000Z'
const weekly: TodoRepeatRule = { every: 'week', interval: 1, from: 'schedule' }
const repeat = (over: Partial<TodoRepeat> = {}): TodoRepeat => ({ id: 'r', taskId: 't', slot: mon, start: mon, every: 'week', interval: 1, from: 'schedule', createdAt: at, ...over })

/** To-dos planned on Monday's page, one per title. */
function setup(...titles: string[]) {
  const h = harness()
  h.day(mon)
  h.save(dayId(mon), d => [...d, ...titles.map((title, i) => todo(`r-${i}`, title, 'plan', mon))], { today: mon })
  return h
}
const setRepeat = (h: H, taskId: string, rule: TodoRepeatRule = weekly) => h.run({ type: 'set-todo-repeat', taskId, repeat: rule, today: mon, at })
const status = (taskId: string, to: 'done' | 'cancelled' | 'open', today: string | null = mon) => ({ type: 'task-status', taskId, status: to, ...(today ? { today } : {}) }) as Action
/** The floor build's tick: done, and the repeat still names it. */
const floorTick = (h: H, taskId: string) => { h.ws = { ...h.ws, tasks: h.ws.tasks.map(t => (t.id === taskId ? { ...t, status: 'done' as const, doneOn: mon, version: t.version + 1 } : t)) } }
/** Pages that were there before and whose document the command rewrote. */
const rewritten = (before: Workspace, after: Workspace) => before.pages.filter(p => after.pages.find(q => q.id === p.id)?.document !== p.document).map(p => p.id)

test('the menu item and the icon say the rule', () => {
  assert.equal(repeatMenuLabel(undefined), 'Repeat…')
  assert.equal(repeatMenuLabel(weekly), 'Repeat · Every week…')
  assert.equal(repeatMenuLabel({ every: 'week', interval: 2, weekdays: [1, 4], from: 'schedule' }), 'Repeat · Every 2 weeks on Mon, Thu…')
  assert.equal(repeatMenuLabel({ every: 'day', interval: 5, from: 'done' }), "Repeat · Every 5 days, from when it's done…")
  assert.equal(repeatMarkName(weekly), 'Repeats every week')
})

test('a notice keeps its own words and adds the day when the command made exactly one next to-do', () => {
  const made = (on: string) => ({ nextTodos: [{ taskId: 'x', on }] })
  assert.equal(noticeWithNext('Task completed', made(dec7), tue), 'Task completed · Next Mon, Dec 7')
  assert.equal(noticeWithNext('Done', made(dec7), tue), 'Done · Next Mon, Dec 7')
  assert.equal(noticeWithNext('Cancelled', made(dec14), tue), 'Cancelled · Next Mon, Dec 14')
  assert.equal(noticeWithNext('Done', {}, tue), 'Done', 'no repeat: the words it has today')
  assert.equal(noticeWithNext('3 to-dos changed', { nextTodos: [{ taskId: 'x', on: dec7 }, { taskId: 'y', on: dec14 }] }, tue), '3 to-dos changed')
  assert.equal(nextDayLabel(dec7, tue), 'Mon, Dec 7')
  assert.equal(noticeWithNext('Done', made('2027-11-24'), tue), 'Done · Next Wed, Nov 24, 2027', 'another year says so')
})

test("the editor's last line: the next day, 'if done today' when it counts from the finish, and no day once it has ended", () => {
  assert.equal(nextLine(repeat({ slot: nextMon }), tue), 'Next Mon, Dec 7')
  assert.equal(nextLine(repeat(), tue), 'Next Mon, Nov 30')
  assert.equal(nextLine(repeat({ every: 'day', interval: 5, from: 'done', slot: tue, start: tue }), tue), 'Next Sun, Nov 29 if done today')
  assert.equal(nextLine(repeat({ until: '2026-11-29' }), tue), 'Ends after this one')
  assert.equal(nextLine(repeat({ every: 'year', slot: tue, start: tue }), tue), 'Next Wed, Nov 24, 2027')
})

test('the fields the editor shows, for a repeat and for none', () => {
  assert.deepEqual(repeatFields(undefined), { every: 'off', interval: 1, showWeekdays: false, from: 'schedule', ends: 'never', until: '' })
  assert.deepEqual(repeatFields(repeat()), { every: 'week', interval: 1, showWeekdays: true, from: 'schedule', ends: 'never', until: '' })
  assert.equal(repeatFields(repeat({ from: 'done' })).showWeekdays, false, "weekdays aren't offered with When it's done")
  assert.deepEqual(repeatFields(repeat({ every: 'month', interval: 3, until: '2027-01-31' })), { every: 'month', interval: 3, showWeekdays: false, from: 'schedule', ends: 'date', until: '2027-01-31' })
})

test('one edit in the editor is one rule to send', () => {
  // Off to a rhythm: every 1, from its day, never ending.
  assert.deepEqual(ruleAfter(undefined, { field: 'every', value: 'week' }, tue), weekly)
  assert.equal(ruleAfter(undefined, { field: 'every', value: 'off' }, tue), undefined, 'nothing to turn off')
  assert.equal(ruleAfter(undefined, { field: 'interval', value: 2 }, tue), undefined)
  assert.equal(ruleAfter(repeat(), { field: 'every', value: 'off' }, tue), null)
  // A new rhythm keeps Every, From and Ends, and drops the weekdays.
  assert.deepEqual(ruleAfter(repeat({ interval: 2, weekdays: [1, 4], until: '2027-01-01' }), { field: 'every', value: 'month' }, tue), { every: 'month', interval: 2, from: 'schedule', until: '2027-01-01' })
  assert.deepEqual(ruleAfter(repeat(), { field: 'interval', value: 2 }, tue), { every: 'week', interval: 2, from: 'schedule' })
  for (const bad of [0, 1000, 1.5, Number.NaN]) assert.equal(ruleAfter(repeat(), { field: 'interval', value: bad }, tue), undefined, String(bad))
  // Weekdays: sorted, once each; its own day alone is what no weekdays says.
  assert.deepEqual(ruleAfter(repeat(), { field: 'weekdays', value: [4, 1, 4] }, tue), { every: 'week', interval: 1, weekdays: [1, 4], from: 'schedule' })
  assert.deepEqual(ruleAfter(repeat({ weekdays: [1, 4] }), { field: 'weekdays', value: [1] }, tue), weekly)
  assert.deepEqual(ruleAfter(repeat({ weekdays: [1, 4] }), { field: 'weekdays', value: [4] }, tue), { every: 'week', interval: 1, weekdays: [4], from: 'schedule' })
  assert.equal(ruleAfter(repeat(), { field: 'weekdays', value: [] }, tue), undefined, 'a weekly repeat always has a day')
  assert.equal(ruleAfter(repeat({ every: 'day' }), { field: 'weekdays', value: [1, 4] }, tue), undefined)
  // "When it's done" keeps no weekdays.
  assert.deepEqual(ruleAfter(repeat({ weekdays: [1, 4] }), { field: 'from', value: 'done' }, tue), { every: 'week', interval: 1, from: 'done' })
  // Ends: four weeks after the later of its own day and today, until he picks; Never takes it off.
  assert.deepEqual(ruleAfter(repeat(), { field: 'ends', value: 'date' }, tue), { ...weekly, until: '2026-12-22' })
  assert.deepEqual(ruleAfter(repeat({ slot: nextMon }), { field: 'ends', value: 'date' }, tue), { ...weekly, until: '2026-12-28' })
  assert.deepEqual(ruleAfter(repeat({ until: '2026-12-22' }), { field: 'until', value: '2027-03-01' }, tue), { ...weekly, until: '2027-03-01' })
  assert.deepEqual(ruleAfter(repeat({ until: '2026-12-22' }), { field: 'ends', value: 'never' }, tue), weekly)
  assert.equal(ruleAfter(repeat({ until: '2026-12-22' }), { field: 'until', value: '' }, tue), undefined, 'a cleared date field sends nothing')
  // The same rule again sends nothing: the command would refuse it ("Nothing to change").
  assert.equal(ruleAfter(repeat(), { field: 'interval', value: 1 }, tue), undefined)
  assert.equal(ruleAfter(repeat(), { field: 'weekdays', value: [1] }, tue), undefined)
  assert.equal(ruleAfter(repeat(), { field: 'from', value: 'schedule' }, tue), undefined)
})

test('an end date before the later of its own day and today changes nothing', () => {
  assert.equal(ruleAfter(repeat({ until: '2026-12-22' }), { field: 'until', value: '2026-11-22' }, mon), undefined, 'the day before its slot and today')
  assert.equal(ruleAfter(repeat({ until: '2026-12-22' }), { field: 'until', value: '0027-12-22' }, mon), undefined, 'a year typed short')
})

test('every rule the editor sends is one the command takes, each with its own Undo', () => {
  const h = setup('Weekly review'), id = h.task('Weekly review').id
  const now = () => repeatsIn(h.ws).get(id)
  const send = (edit: RepeatEdit) => {
    const rule = ruleAfter(now(), edit, tue)
    assert.notEqual(rule, undefined, JSON.stringify(edit))
    return h.run({ type: 'set-todo-repeat', taskId: id, repeat: rule as TodoRepeatRule | null, today: tue, at }).receipt
  }
  assert.equal(send({ field: 'every', value: 'week' }).message, 'Repeats every week')
  assert.equal(now()?.slot, mon, 'its own day, not the day he set it')
  assert.equal(send({ field: 'interval', value: 2 }).message, 'Repeats every 2 weeks')
  assert.equal(send({ field: 'weekdays', value: [1, 4] }).message, 'Repeats every 2 weeks on Mon, Thu')
  assert.equal(send({ field: 'from', value: 'done' }).message, "Repeats every 2 weeks, from when it's done")
  send({ field: 'ends', value: 'date' })
  assert.equal(now()?.until, '2026-12-22')
  const until = send({ field: 'until', value: '2027-03-01' })
  assert.equal(now()?.until, '2027-03-01')
  h.run({ type: 'undo', targetOperationId: until.operationId })
  assert.equal(now()?.until, '2026-12-22', 'one Undo, one edit')
  send({ field: 'ends', value: 'never' })
  assert.equal(now()?.until, undefined)
  assert.equal(send({ field: 'every', value: 'off' }).message, 'Repeat off')
  assert.equal(now(), undefined)
  assert.equal(h.ws.todoRepeats, undefined)
})

test('the index behind the icon: once per copy of the workspace, open current ones only, nothing where no to-do repeats', () => {
  const plain = setup('Alpha'), other = setup('Bravo')
  assert.equal(repeatsIn(plain.ws).size, 0)
  assert.equal(repeatsIn(plain.ws), repeatsIn(other.ws), 'one shared empty map: a workspace with no repeat pays nothing')
  const h = setup('Weekly review', 'Alpha'), id = h.task('Weekly review').id
  setRepeat(h, id)
  const index = repeatsIn(h.ws)
  assert.deepEqual([...index.keys()], [id])
  assert.equal(index.get(id)?.every, 'week')
  assert.equal(repeatsIn(h.ws), index, 'worked out once for this copy')
  const made = h.run(status(id, 'done')).receipt.nextTodos![0]!
  assert.deepEqual([...repeatsIn(h.ws).keys()], [made.taskId], 'the finished one carries none; the next one does')
  // Its to-do deleted: the repeat is kept, not in force.
  h.save(dayId(nextMon), d => d.filter(n => n.props?.taskId !== made.taskId), { today: mon })
  assert.equal(repeatsIn(h.ws).size, 0)
  assert.equal(h.ws.todoRepeats?.length, 1)
  const floor = setup('Weekly review'), floorId = floor.task('Weekly review').id
  setRepeat(floor, floorId)
  floorTick(floor, floorId)
  assert.equal(repeatsIn(floor.ws).size, 0, 'finished and still named by its repeat: no icon')
})

test('the pages a command rewrites because of a repeat are the ones the reducer rewrites, and none without a repeat', () => {
  const h = setup('Weekly review', 'Alpha'), id = h.task('Weekly review').id, alpha = h.task('Alpha').id
  assert.deepEqual(repeatPages(h.ws, status(id, 'done')), [], 'no repeat anywhere')
  setRepeat(h, id)
  assert.deepEqual(repeatPages(h.ws, status(alpha, 'done')), [], 'a to-do that does not repeat')
  assert.deepEqual(repeatPages(h.ws, status(id, 'done')), [], 'its next day has no page yet, so no editor can be open on it')
  h.day(nextMon)
  const before = h.ws
  assert.deepEqual(repeatPages(before, status(id, 'done')), [dayId(nextMon)])
  assert.deepEqual(repeatPages(before, status(id, 'cancelled')), [dayId(nextMon)])
  assert.deepEqual(repeatPages(before, status(id, 'cancelled', null)), [], 'a Cancel with no day makes nothing')
  assert.deepEqual(repeatPages(before, { type: 'edit-todos', items: [{ taskId: id, changes: [{ columnId: 'status', value: 'done' }] }], today: mon }), [dayId(nextMon)])
  assert.deepEqual(repeatPages(before, { type: 'plan-task', taskId: id, date: tue, today: mon }), [])
  h.run(status(id, 'done'))
  assert.deepEqual(rewritten(before, h.ws), [dayId(nextMon)], 'the reducer agrees')
  // Reopening takes the next one's line back off that page.
  const ticked = h.ws
  assert.deepEqual(repeatPages(ticked, status(id, 'open')), [dayId(nextMon)])
  h.run(status(id, 'open'))
  assert.deepEqual(rewritten(ticked, h.ws), [dayId(nextMon)])
  // An ended repeat makes nothing.
  h.run({ type: 'set-todo-repeat', taskId: id, repeat: { ...weekly, until: '2026-11-29' }, today: mon, at })
  assert.deepEqual(repeatPages(h.ws, status(id, 'done')), [])
})

test('the mend: the day pages it will write, and a key that asks once for each set of due repeats', () => {
  const h = setup('Weekly review'), id = h.task('Weekly review').id
  setRepeat(h, id)
  h.day(nextMon)
  floorTick(h, id)
  const mend: Action = { type: 'run-repeats', today: sat, time: '09:00', at }
  assert.deepEqual(repeatPages(h.ws, mend), [dayId(nextMon)])
  const due = dueTodoRepeats(h.ws, sat)
  assert.equal(mendKey(due), `${due[0]!.repeat.id}@${nextMon}`)
  assert.equal(mendKey([{ repeat: repeat({ id: 'b' }), on: mon }, { repeat: repeat({ id: 'a' }), on: tue }]), 'a@2026-11-24 b@2026-11-23', 'the same set in any order is the same key')
  assert.equal(mendKey([]), '')
  const before = h.ws
  h.run(mend)
  assert.deepEqual(rewritten(before, h.ws), [dayId(nextMon)])
  assert.deepEqual(repeatPages(h.ws, mend), [])
  assert.equal(mendKey(dueTodoRepeats(h.ws, sat)), '')
})

test('what an Undo must hold: the pages the command was held for, and wherever the next one it made has a line now', () => {
  const h = setup('Weekly review'), id = h.task('Weekly review').id
  setRepeat(h, id)
  const done = h.run(status(id, 'done'))
  assert.deepEqual(undoHoldPages(h.ws, done.receipt, []), [dayId(nextMon)], 'the page the tick made')
  assert.deepEqual(undoHoldPages(h.ws, done.receipt, [dayId(nextMon), 'p']), [dayId(nextMon), 'p'])
  assert.deepEqual(undoHoldPages(h.ws, {}, []), [])
})
