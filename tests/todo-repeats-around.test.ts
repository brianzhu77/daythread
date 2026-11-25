// Repeating to-dos, phase 3 (docs/design/repeating-to-dos.md §4 "Export", §6 phase 3): what is around the screen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayId, harness, todo } from './v2-helpers.ts'

// Nov 23, 2026 is a Monday.
const mon = '2026-11-23', nextMon = '2026-11-30', at = '2026-11-23T10:00:00.000Z'
function setup() {
  const h = harness()
  h.day(mon)
  h.save(dayId(mon), d => [...d, todo('r-1', 'Weekly review', 'plan', mon), todo('r-2', 'Water the plants', 'plan', mon), todo('r-3', 'Book the dentist', 'plan', mon)], { today: mon })
  h.run({ type: 'set-todo-repeat', taskId: h.task('Weekly review').id, repeat: { every: 'week', interval: 1, from: 'schedule' }, today: mon, at })
  h.run({ type: 'set-todo-repeat', taskId: h.task('Water the plants').id, repeat: { every: 'day', interval: 5, from: 'done' }, today: mon, at })
  return h
}

test("the export says the rule on the current to-do's line, after what blocks it, and on no other line", async () => {
  const { pageMarkdown, fileNames } = await import('../src/domain/export.ts')
  const h = setup()
  const first = h.task('Weekly review').id
  let text = pageMarkdown(h.page(dayId(mon)), h.ws, fileNames(h.ws))
  assert.match(text, /- \[ \] Weekly review · Repeats every week\n/)
  assert.match(text, /- \[ \] Water the plants · Repeats every 5 days, from when it's done\n/)
  assert.match(text, /- \[ \] Book the dentist\n/)
  h.run({ type: 'link-tasks', taskId: first, add: [h.task('Book the dentist').id], remove: [], at })
  text = pageMarkdown(h.page(dayId(mon)), h.ws, fileNames(h.ws))
  assert.match(text, /- \[ \] Weekly review · Blocked by Book the dentist · Repeats every week\n/)
  h.run({ type: 'task-status', taskId: first, status: 'done', today: mon })
  text = pageMarkdown(h.page(dayId(mon)), h.ws, fileNames(h.ws))
  assert.match(text, /- \[x\] Weekly review\n/, 'a finished one is an ordinary done to-do')
  assert.match(pageMarkdown(h.page(dayId(nextMon)), h.ws, fileNames(h.ws)), /- \[ \] Weekly review · Repeats every week\n/, 'the next one carries it')
})

test('To-dos: a read-only Repeat column, hidden until asked for, says the rule for the current to-do only', async () => {
  const { withTodos, todoChange, todosDatabase, repeatColumn } = await import('../src/domain/todos-source.ts')
  const h = setup()
  const first = h.task('Weekly review').id
  const rows = withTodos(h.ws).pages, row = (title: string) => rows.find(p => p.title === title && p.id.startsWith('todo:'))!
  assert.equal(row('Weekly review').values?.[repeatColumn], 'Every week')
  assert.equal(row('Water the plants').values?.[repeatColumn], "Every 5 days, from when it's done")
  assert.equal(row('Book the dentist').values?.[repeatColumn], undefined)
  const property = todosDatabase.properties.find(p => p.id === repeatColumn)!
  assert.deepEqual({ name: property.name, type: property.type, readOnly: property.readOnly }, { name: 'Repeat', type: 'text', readOnly: true })
  assert.ok(!todosDatabase.views[0]!.columns!.some(c => c.id === repeatColumn), 'not shown until he asks for it under Properties')
  const change = todoChange(h.ws, first, repeatColumn, 'Every day', mon)
  assert.ok(!change || 'refused' in change, 'a cell edit sent anyway changes nothing')
  h.run({ type: 'task-status', taskId: first, status: 'done', today: mon })
  const both = withTodos(h.ws).pages.filter(p => p.title === 'Weekly review' && p.id.startsWith('todo:'))
  assert.equal(both.length, 2)
  assert.equal(both.find(p => p.id === `todo:${first}`)!.values?.[repeatColumn], undefined, 'the finished one says nothing')
  assert.equal(both.find(p => p.id !== `todo:${first}`)!.values?.[repeatColumn], 'Every week')
})

test("the export's own description says how a repeating to-do reads", async () => {
  const { exportFiles } = await import('../src/domain/export.ts')
  const readme = exportFiles(setup().ws, new Date(at)).find(f => f.path.endsWith('/README.md'))!.text
  assert.ok(readme.includes('A repeating one ends with `· Repeats` and its rule.'))
})
