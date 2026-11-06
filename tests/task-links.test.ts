// A to-do blocked by another (docs/design/todo-dependency.md): links between tasks, kept in their own table, never moving a date.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockedNow, linkLimits } from '../src/domain/task-links.ts'
import { liveTaskIds } from '../src/domain/workspace.ts'
import { changesBetween, applyChanges } from '../src/domain/workspace-changes.ts'
import { applyDiff, planWrites, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'
import { harness, today, todo, dayId } from './v2-helpers.ts'

const at = '2026-10-22T10:00:00.000Z'
function setup() {
  const h = harness()
  h.day(today)
  h.save(dayId(today), () => [todo('l-a', 'Alpha'), todo('l-b', 'Bravo'), todo('l-c', 'Charlie'), todo('l-d', 'Delta')])
  return h
}
const id = (h: ReturnType<typeof harness>, title: string) => h.task(title).id
const link = (h: ReturnType<typeof harness>, blocked: string, add: string[], remove: string[] = []) =>
  h.run({ type: 'link-tasks', taskId: id(h, blocked), add: add.map(t => id(h, t)), remove: remove.map(t => id(h, t)), at })
const marks = (h: ReturnType<typeof harness>) => Object.fromEntries([...blockedNow(h.ws, liveTaskIds(h.ws))].map(([taskId, b]) => [h.ws.tasks.find(t => t.id === taskId)!.title, b.by.map(t => t.title)]))
const snapshot = (h: ReturnType<typeof harness>) => JSON.stringify({ tasks: h.ws.tasks.map(({ id, attentionOn, deadlineOn }) => ({ id, attentionOn, deadlineOn })), docs: h.ws.pages.map(p => [p.id, p.document]) })

test('a link is made and taken off with one Undo each, and moves no date, line or page', () => {
  const h = setup(), before = snapshot(h)
  const made = link(h, 'Alpha', ['Bravo'])
  assert.equal(made.receipt.message, 'Blocked by Bravo')
  assert.deepEqual(marks(h), { Alpha: ['Bravo'] })
  assert.equal(snapshot(h), before)
  h.run({ type: 'undo', targetOperationId: made.receipt.operationId })
  assert.deepEqual(marks(h), {})
  link(h, 'Alpha', ['Bravo', 'Charlie'])
  assert.deepEqual(marks(h), { Alpha: ['Bravo', 'Charlie'] })
  const off = link(h, 'Alpha', [], ['Bravo'])
  assert.equal(off.receipt.message, 'Unblocked')
  assert.deepEqual(marks(h), { Alpha: ['Charlie'] })
  h.run({ type: 'undo', targetOperationId: off.receipt.operationId })
  assert.deepEqual(marks(h), { Alpha: ['Bravo', 'Charlie'] })
  assert.throws(() => link(h, 'Alpha', ['Bravo']), /Nothing to change/)
  assert.equal(snapshot(h), before)
})

test('a loop is refused, itself included, through links not in force too', () => {
  const h = setup()
  assert.throws(() => link(h, 'Alpha', ['Alpha']), /can't block itself/)
  link(h, 'Alpha', ['Bravo'])
  link(h, 'Bravo', ['Charlie'])
  assert.throws(() => link(h, 'Charlie', ['Alpha']), /Alpha already waits on this one/)
  // Bravo done: the link isn't in force, but the loop would come back on reopening it.
  h.run({ type: 'task-status', taskId: id(h, 'Bravo'), status: 'done', today })
  assert.throws(() => link(h, 'Charlie', ['Alpha']), /already waits on this one/)
  // Two at once: the second sees the first.
  link(h, 'Delta', ['Charlie'])
  assert.throws(() => link(h, 'Charlie', ['Delta']), /already waits on this one/)
})

test('done and cancelled stop blocking, paused still does, and a finished to-do shows nothing', () => {
  const h = setup()
  link(h, 'Alpha', ['Bravo', 'Charlie'])
  h.run({ type: 'task-status', taskId: id(h, 'Bravo'), status: 'done', today })
  assert.deepEqual(marks(h), { Alpha: ['Charlie'] })
  h.run({ type: 'task-status', taskId: id(h, 'Charlie'), status: 'cancelled', today })
  assert.deepEqual(marks(h), {})
  h.run({ type: 'task-status', taskId: id(h, 'Bravo'), status: 'open', today })
  assert.deepEqual(marks(h), { Alpha: ['Bravo'] }, 'reopening brings it back')
  h.run({ type: 'set-task-paused', taskId: id(h, 'Bravo'), paused: true } as never)
  assert.deepEqual(marks(h), { Alpha: ['Bravo'] }, 'paused still blocks')
  // A blocked to-do ticks with no question.
  h.run({ type: 'task-status', taskId: id(h, 'Alpha'), status: 'done', today })
  assert.deepEqual(marks(h), {}, 'finished, it says nothing')
  assert.equal(h.ws.links?.length, 2, 'and the links stay')
})

test('Trash stops a blocker only when no live line of it is left, and a restore brings it back', () => {
  const h = setup()
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
  h.save('notes', () => [todo('n-b', 'Bravo-elsewhere', 'reference')])
  // A copied line of Bravo on Notes: the same task.
  const bravo = id(h, 'Bravo')
  h.save('notes', doc => doc.map(n => (n.id === 'n-b' ? { ...n, props: { ...n.props, taskId: bravo }, content: [{ type: 'text', text: 'Bravo', styles: {} }] } : n)))
  link(h, 'Alpha', ['Bravo'])
  h.run({ type: 'delete-page', pageId: 'notes', at })
  assert.deepEqual(marks(h), { Alpha: ['Bravo'] }, 'the day page still has a line of it')
  h.run({ type: 'restore-page', pageId: 'notes' })
  h.save(dayId(today), doc => doc.filter(n => n.id !== 'l-b'))
  assert.deepEqual(marks(h), { Alpha: ['Bravo'] }, 'and now only the copy holds it')
  h.run({ type: 'delete-page', pageId: 'notes', at })
  assert.deepEqual(marks(h), {}, 'no live line left')
  assert.throws(() => link(h, 'Charlie', ['Bravo']), /Bravo is in Trash/)
  h.run({ type: 'restore-page', pageId: h.ws.pages.find(p => p.title === 'Notes')!.id })
  assert.deepEqual(marks(h), { Alpha: ['Bravo'] })
})

test('deleting a to-do keeps its links, not in force, and Undo brings them back in force with nothing to put back', () => {
  const h = setup()
  link(h, 'Alpha', ['Bravo'])
  link(h, 'Bravo', ['Charlie'])
  const gone = h.save(dayId(today), doc => doc.filter(n => n.id !== 'l-b'))
  assert.ok(!h.ws.tasks.some(t => t.title === 'Bravo'))
  assert.deepEqual(marks(h), {})
  assert.equal(h.ws.links?.length, 2)
  h.run({ type: 'undo', targetOperationId: gone.receipt.operationId })
  assert.deepEqual(marks(h), { Alpha: ['Bravo'], Bravo: ['Charlie'] })
  // A link to a deleted to-do can still be taken off.
  h.save(dayId(today), doc => doc.filter(n => n.id !== 'l-c'))
  const charlie = h.ws.deletedTasks.find(t => t.title === 'Charlie')!.id
  h.run({ type: 'link-tasks', taskId: id(h, 'Bravo'), add: [], remove: [charlie], at })
  assert.equal(h.ws.links?.length, 1)
})

test('over a limit the whole change is refused', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), () => Array.from({ length: linkLimits.perTask + 2 }, (_, i) => todo(`l${i}`, `T${i}`)))
  const many = Array.from({ length: linkLimits.perTask + 1 }, (_, i) => `T${i + 1}`)
  assert.throws(() => link(h, 'T0', many), new RegExp(`${linkLimits.perTask} blockers at most`))
  assert.equal(h.ws.links, undefined)
  link(h, 'T0', many.slice(0, linkLimits.perTask))
  assert.equal(h.ws.links?.length, linkLimits.perTask)
})

test('links go through the rows and back, an inverse from before links leaves them, and the browser\'s changes carry them', () => {
  const h = setup()
  const before = h.ws, rows = rowsOf(before)
  link(h, 'Alpha', ['Bravo'])
  const { write, inverse } = planWrites(rows, h.ws)
  assert.equal(write.links?.upsert.length, 1)
  assert.equal(inverse.links?.remove.length, 1)
  const after = applyDiff(rows, write)
  assert.deepEqual(workspaceOf(after).links, h.ws.links)
  assert.equal(workspaceOf(applyDiff(after, inverse)).links, undefined)
  const { links: _none, ...older } = inverse
  assert.deepEqual(workspaceOf(applyDiff(after, older)).links, h.ws.links, 'an older build\'s Undo leaves the links alone')
  const changes = changesBetween(before, h.ws)
  assert.deepEqual(applyChanges(before, changes)!.links, h.ws.links)
})

test('To-dos: Blocked by and Blocking read both sides, hidden until asked for, and the Blocked by cell sets links', async () => {
  const { withTodos, todoChange, todoRowId, todosDatabase, blockedByColumn, blockingColumn } = await import('../src/domain/todos-source.ts')
  const h = setup()
  link(h, 'Alpha', ['Bravo', 'Charlie'])
  const rows = withTodos(h.ws).pages, row = (title: string) => rows.find(p => p.title === title && p.id.startsWith('todo:'))!
  assert.deepEqual(row('Alpha').values?.[blockedByColumn], [todoRowId(id(h, 'Bravo')), todoRowId(id(h, 'Charlie'))])
  assert.deepEqual(row('Bravo').values?.[blockingColumn], [todoRowId(id(h, 'Alpha'))])
  assert.ok(!todosDatabase.views[0]!.columns!.some(c => c.id === blockedByColumn || c.id === blockingColumn))
  assert.equal(todosDatabase.properties.find(p => p.id === blockingColumn)!.readOnly, true)
  const change = todoChange(h.ws, id(h, 'Alpha'), blockedByColumn, [todoRowId(id(h, 'Charlie')), todoRowId(id(h, 'Delta'))], today)
  assert.ok(change && 'action' in change)
  const { at: _at, ...action } = change.action as { at: string }
  assert.deepEqual(action, { type: 'link-tasks', taskId: id(h, 'Alpha'), add: [id(h, 'Delta')], remove: [id(h, 'Bravo')] })
  h.run(change.action)
  assert.deepEqual(marks(h), { Alpha: ['Charlie', 'Delta'] })
})

test('the export writes what blocks a to-do on its line, as the mark reads', async () => {
  const { pageMarkdown, fileNames } = await import('../src/domain/export.ts')
  const h = setup()
  link(h, 'Alpha', ['Bravo', 'Charlie'])
  h.run({ type: 'task-status', taskId: id(h, 'Charlie'), status: 'done', today })
  const text = pageMarkdown(h.page(dayId(today)), h.ws, fileNames(h.ws))
  assert.match(text, /- \[ \] Alpha · Blocked by Bravo\n/)
  assert.match(text, /- \[ \] Bravo\n/)
})

test('a line pasted as the same to-do holds its links; Make a copy makes a new one with none', () => {
  const h = setup()
  link(h, 'Alpha', ['Bravo'])
  const alpha = id(h, 'Alpha')
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
  // The same task: its id kept (B22). Make a copy: a new line's identity, so a new task.
  h.save('notes', () => [{ ...todo('n-same', 'Alpha', 'reference'), props: { taskId: alpha, role: 'reference', planDate: '' } }, todo('n-copy', 'Alpha copy', 'reference')])
  assert.deepEqual(marks(h), { Alpha: ['Bravo'] })
  assert.equal(h.ws.links?.length, 1)
  assert.ok(!h.ws.links!.some(l => l.blockedId === id(h, 'Alpha copy')))
})

test('a deleted to-do\'s links count for nothing he can do: no loop through it, and not toward the limit', () => {
  const h = setup()
  link(h, 'Alpha', ['Bravo'])
  link(h, 'Bravo', ['Charlie'])
  // Bravo deleted: Charlie blocked by Alpha would be a loop only through Bravo, which he can't see.
  h.save(dayId(today), doc => doc.filter(n => n.id !== 'l-b'))
  link(h, 'Charlie', ['Alpha'])
  assert.deepEqual(marks(h), { Charlie: ['Alpha'] })
  // Paused, done or in Trash still count.
  link(h, 'Delta', ['Charlie'])
  h.run({ type: 'task-status', taskId: id(h, 'Delta'), status: 'done', today })
  assert.throws(() => link(h, 'Charlie', ['Delta']), /already waits on this one/)
})
