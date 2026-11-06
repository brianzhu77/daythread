// To-dos as an automation's source (automations.md §7, G3-20): its rules kept on the workspace, set off by a tick or a to-do's first words, with one Undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeSteps, type ButtonStep } from '../src/domain/buttons.ts'
import type { Automation } from '../src/domain/automations.ts'
import { todosSourceId } from '../src/domain/database.ts'
import { changesBetween, applyChanges } from '../src/domain/workspace-changes.ts'
import { applyDiff, planWrites, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'
import { harness, today, todo, dayId } from './v2-helpers.ts'

const log: ButtonStep = { id: 's-log', kind: 'add-row', databaseId: 'log', databaseName: 'Log', title: '', titleFormula: '"Done: " + prop("title")', set: [] }
const rule = (over: Partial<Automation> = {}): Automation => ({ id: 'r', name: 'Log it', active: true, triggers: [{ kind: 'property-edited', propertyId: 'status', name: 'Status', condition: { by: 'status', op: 'isAnyOf', value: ['done'] } } as never], steps: writeSteps([log]), ...over })
function setup(rules: Automation[] = [rule()]) {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'log', homeBlockId: null, title: 'Log' })
  h.day(today)
  h.save(dayId(today), () => [todo('l-a', 'Alpha'), todo('l-b', 'Bravo')])
  for (const r of rules) h.run({ type: 'change-database', pageId: todosSourceId, change: { kind: 'addAutomation', automation: r } } as never)
  return h
}
const logged = (h: ReturnType<typeof harness>) => h.ws.pages.filter(p => p.parentId === 'log' && !p.trashedAt).map(p => p.title)
const tick = (h: ReturnType<typeof harness>, title: string, status: 'done' | 'open' = 'done') => h.run({ type: 'task-status', taskId: h.task(title).id, status, today })

test('To-dos\' rules are kept on the workspace, and only rules can change there', () => {
  const h = setup()
  assert.equal(h.ws.todoAutomations?.length, 1)
  assert.ok(!h.ws.pages.some(p => p.id === todosSourceId))
  assert.throws(() => h.run({ type: 'change-database', pageId: todosSourceId, change: { kind: 'addProperty', property: { id: 'x', name: 'X', type: 'text' } } } as never), /To-dos can't change that/)
  h.run({ type: 'change-database', pageId: todosSourceId, change: { kind: 'setAutomationActive', automationId: 'r', active: false } } as never)
  assert.equal(h.ws.todoAutomations?.[0]?.active, false)
  h.run({ type: 'change-database', pageId: todosSourceId, change: { kind: 'removeAutomation', automationId: 'r' } } as never)
  assert.equal(h.ws.todoAutomations, undefined)
})

test('a tick runs the rule inside it, one Undo takes back both, and reopening doesn\'t run it', () => {
  const h = setup()
  const r = tick(h, 'Alpha')
  assert.deepEqual(logged(h), ['Done: Alpha'])
  assert.equal(r.receipt.automations?.ran.join(), 'Log it')
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(logged(h), [])
  assert.equal(h.task('Alpha').status, 'open')
  tick(h, 'Alpha'); tick(h, 'Alpha', 'open')
  assert.deepEqual(logged(h), ['Done: Alpha'])
})

test('a to-do is added the first time it has words, once; a copied line and one pasted back from the deleted aren\'t new', () => {
  const added = rule({ id: 'n', name: 'Note new', triggers: [{ kind: 'row-added' }], steps: writeSteps([{ ...log, titleFormula: '"New: " + prop("title")' }]) })
  const h = setup([added])
  h.save(dayId(today), doc => [...doc, todo('l-c', '')])
  assert.deepEqual(logged(h), [], 'a blank box isn\'t a to-do yet')
  h.save(dayId(today), doc => doc.map(n => (n.id === 'l-c' ? { ...n, content: [{ type: 'text', text: 'Charlie', styles: {} }] } : n)))
  assert.deepEqual(logged(h), ['New: Charlie'])
  h.save(dayId(today), doc => doc.map(n => (n.id === 'l-c' ? { ...n, content: [{ type: 'text', text: 'Charlie two', styles: {} }] } : n)))
  assert.deepEqual(logged(h), ['New: Charlie'], 'more words don\'t add it again')
  // The same task on another page.
  const charlie = h.task('Charlie two').id
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
  h.save('notes', () => [{ ...todo('n-c', 'Charlie two', 'reference'), props: { taskId: charlie, role: 'reference', planDate: '' } }])
  assert.equal(logged(h).length, 1)
  // Deleted with its last lines, then pasted back as the same task.
  h.save('notes', () => [])
  h.save(dayId(today), doc => doc.filter(n => n.id !== 'l-c'))
  assert.ok(h.ws.deletedTasks.some(t => t.id === charlie))
  h.save(dayId(today), doc => [...doc, { ...todo('l-c2', 'Charlie two'), props: { taskId: charlie, role: 'plan', planDate: today } }])
  assert.ok(h.ws.tasks.some(t => t.id === charlie), 'it came back')
  assert.equal(logged(h).length, 1, 'and isn\'t new')
})

test('Edit property on a to-do goes through its task command: a tick that sets a deadline, with one Undo', () => {
  const set = rule({ id: 'd', name: 'Due', triggers: [{ kind: 'property-edited', propertyId: 'planned', name: 'Planned' } as never], steps: writeSteps([{ id: 'e', kind: 'edit-property', set: [{ id: 'deadline', name: 'Deadline', value: { kind: 'formula', text: 'dateAdd(prop("planned"), 2, "days")' } }] }]) })
  const h = setup([set])
  const r = h.run({ type: 'plan-task', taskId: h.task('Alpha').id, date: '2026-10-25', from: today, today })
  assert.equal(h.task('Alpha').deadlineOn, '2026-10-27')
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(h.task('Alpha').deadlineOn, null)
})

test('a broken rule pauses and the tick stands', () => {
  const broken = rule({ steps: writeSteps([{ ...log, databaseId: 'gone', databaseName: 'Gone' }]) })
  const h = setup([broken])
  const r = tick(h, 'Bravo')
  assert.equal(h.task('Bravo').status, 'done')
  assert.ok(h.ws.todoAutomations?.[0]?.paused)
  assert.match(r.receipt.automations?.paused[0]?.reason ?? '', /Gone was deleted/)
})

test('an Every… rule on To-dos runs on its schedule', () => {
  const weekly = rule({ id: 'w', name: 'Weekly', triggers: [{ kind: 'every', repeat: { every: 'day', interval: 1, start: '2026-10-01', time: '09:00', notBefore: '2026-10-01T00:00' } }], steps: writeSteps([{ id: 's', kind: 'add-row', databaseId: todosSourceId, databaseName: 'To-dos', title: 'Review the week', set: [] }]) })
  const h = setup([weekly])
  h.run({ type: 'run-repeats', today, time: '10:00', at: `${today}T17:00:00.000Z` } as never)
  assert.ok(h.ws.tasks.some(t => t.title === 'Review the week'))
  assert.equal((h.ws.todoAutomations![0]!.triggers[0] as { repeat: { last?: string } }).repeat.last, today)
})

test('the rules go through the workspace row and back; an older build\'s inverse leaves them; the browser\'s changes carry them', () => {
  const h = setup([])
  const before = h.ws, rows = rowsOf(before)
  h.run({ type: 'change-database', pageId: todosSourceId, change: { kind: 'addAutomation', automation: rule() } } as never)
  const { write, inverse } = planWrites(rows, h.ws)
  assert.equal(typeof write.todoAutomations, 'string')
  assert.equal(inverse.todoAutomations, null)
  const after = applyDiff(rows, write)
  assert.deepEqual(workspaceOf(after).todoAutomations, h.ws.todoAutomations)
  assert.equal(workspaceOf(applyDiff(after, inverse)).todoAutomations, undefined)
  const { todoAutomations: _none, ...older } = inverse
  assert.deepEqual(workspaceOf(applyDiff(after, older)).todoAutomations, h.ws.todoAutomations)
  assert.deepEqual(applyChanges(before, changesBetween(before, h.ws))!.todoAutomations, h.ws.todoAutomations)
})

test('a rule on an ordinary database whose step adds a to-do runs, rather than reading To-dos as deleted', () => {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  const make = rule({ id: 'm', name: 'Make a to-do', triggers: [{ kind: 'row-added' }], steps: writeSteps([{ id: 's', kind: 'add-row', databaseId: todosSourceId, databaseName: 'To-dos', title: 'Follow up', set: [] }]) })
  h.run({ type: 'change-database', pageId: 'runs', change: { kind: 'addAutomation', automation: make } } as never)
  h.run({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: {}, at: '2026-10-22T10:00:00.000Z' } as never)
  assert.ok(h.ws.tasks.some(t => t.title === 'Follow up'))
  assert.equal(h.page('runs').database!.automations![0]!.paused, undefined)
})

test('"A to-do is added" doesn\'t fire on planning one to another day, a day made from its template, or an Undo', () => {
  const added = rule({ id: 'n', name: 'Note new', triggers: [{ kind: 'row-added' }], steps: writeSteps([{ ...log, titleFormula: '"New: " + prop("title")' }]) })
  const h = setup([added])
  h.run({ type: 'plan-task', taskId: h.task('Alpha').id, date: '2026-10-25', from: today, today })
  assert.deepEqual(logged(h), [], 'planned to another day: the same to-do')
  // The day template holds a to-do: each day made from it is a repeat (G3-13), and its to-do starts empty.
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true } as never)
  h.save('tpl', doc => [...doc, todo('t-1', 'Stretch')])
  h.run({ type: 'ensure-day', date: '2026-10-24' })
  assert.ok(JSON.parse(h.page(dayId('2026-10-24')).document ?? '[]').some((n: { type: string }) => n.type === 'task'), 'the day has its to-do line')
  assert.deepEqual(logged(h), [], 'a day made from its template sets off nothing')
  // A to-do added, and that undone: the Undo sets off nothing either.
  const made = h.save(dayId(today), doc => [...doc, todo('l-d', 'Delta')])
  assert.deepEqual(logged(h), ['New: Delta'])
  h.run({ type: 'undo', targetOperationId: made.receipt.operationId })
  assert.deepEqual(logged(h), [])
})

test('a to-do whose words are cleared and typed again isn\'t added again (Ratchet)', () => {
  const added = rule({ id: 'n', name: 'Note new', triggers: [{ kind: 'row-added' }], steps: writeSteps([{ ...log, titleFormula: '"New: " + prop("title")' }]) })
  const h = setup([added])
  const words = (text: string) => h.save(dayId(today), doc => doc.map(n => (n.id === 'l-c' ? { ...n, content: text ? [{ type: 'text', text, styles: {} }] : [] } : n)))
  h.save(dayId(today), doc => [...doc, todo('l-c', '')])
  words('Charlie')
  assert.deepEqual(logged(h), ['New: Charlie'])
  words('')
  words('Charlie again')
  assert.deepEqual(logged(h), ['New: Charlie'])
})
