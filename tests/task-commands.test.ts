// The commands To-dos as a source adds (design §11, R2-9): new words for a to-do reach every line of it; dates change alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import { flatNodes, inlineText, pageNodes } from '../src/domain/editor-document.ts'
import { canRenameTask } from '../src/domain/workspace.ts'
import { dayId, harness, todo, today } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
/** A to-do on a day page, with a second line of it on an ordinary page. */
function planOnFor(h: ReturnType<typeof harness>, day: string) {
  h.day(day)
  const dayPage = dayId(day)
  h.save(dayPage, d => [...d, todo('r1', 'Book the flights')])
  const id = h.task('Book the flights').id
  h.run({ type: 'create-document', title: 'Trip', body: '', pageId: 'trip' })
  h.save('trip', d => [...d, { ...todo('r2', 'Book the flights'), props: { taskId: id, role: 'reference', planDate: '' } }])
  return { h, id, day: dayPage, other: 'trip' }
}
const words = (h: ReturnType<typeof harness>, pageId: string, taskId: string) => flatNodes(pageNodes(h.page(pageId))).filter(n => n.props?.taskId === taskId).map(n => inlineText(n.content))

test('rename-task: the title and every line of it, on any page, with one Undo', () => {
  const { h, id, day, other } = planOnFor(harness(), today)
  const r = h.run({ type: 'rename-task', taskId: id, title: '  Call the vet  ' })
  assert.equal(r.receipt.message, 'Renamed')
  assert.equal(h.ws.tasks.find(t => t.id === id)!.title, 'Call the vet')
  assert.deepEqual(words(h, day, id), ['Call the vet'])
  assert.deepEqual(words(h, other, id), ['Call the vet'])
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(h.ws.tasks.find(t => t.id === id)!.title, 'Book the flights')
  assert.deepEqual(words(h, other, id), ['Book the flights'])
})

test('rename-task: blank words are refused, and a saved page after it keeps the new words', () => {
  const { h, id, day } = planOnFor(harness(), today)
  assert.throws(() => h.run({ type: 'rename-task', taskId: id, title: '   ' }), /needs words/)
  h.run({ type: 'rename-task', taskId: id, title: 'New words' })
  h.save(day, d => d)
  assert.equal(h.ws.tasks.find(t => t.id === id)!.title, 'New words')
})

test('rename-task: a page in Trash takes the new words too', () => {
  const { h, id, other } = planOnFor(harness(), today)
  h.run({ type: 'delete-page', pageId: other, at })
  h.run({ type: 'rename-task', taskId: id, title: 'New words' })
  assert.deepEqual(words(h, other, id), ['New words'])
})

test('rename-task: a line with a chip or a link is refused, so it keeps them', () => {
  const { h, id, day } = planOnFor(harness(), today)
  h.save(day, d => d.map(n => n.id === 'r1' ? { ...n, content: [{ type: 'text', text: 'Book ', styles: {} }, { type: 'dateChip', props: { date: '2026-12-01' } }] } : n))
  assert.equal(canRenameTask(h.ws, id), false)
  const before = h.page(day).document
  assert.throws(() => h.run({ type: 'rename-task', taskId: id, title: 'New words' }), /more than words/)
  assert.equal(h.page(day).document, before)
})

test('set-task-dates: each field alone, null clears it, a bad day is refused, one Undo', () => {
  const { h, id } = planOnFor(harness(), today)
  const task = () => h.ws.tasks.find(t => t.id === id)!
  const r = h.run({ type: 'set-task-dates', taskId: id, deadlineOn: '2026-12-01' })
  assert.equal(task().deadlineOn, '2026-12-01')
  assert.equal(task().attentionOn, null)
  h.run({ type: 'set-task-dates', taskId: id, attentionOn: '2026-11-20' })
  assert.equal(task().deadlineOn, '2026-12-01')
  h.run({ type: 'set-task-dates', taskId: id, deadlineOn: null })
  assert.equal(task().deadlineOn, null)
  assert.equal(task().attentionOn, '2026-11-20')
  assert.throws(() => h.run({ type: 'set-task-dates', taskId: id, deadlineOn: 'soon' }))
  assert.ok(r.receipt.operationId)
})

test('the new commands pass the schema', () => {
  for (const action of [{ type: 'rename-task', taskId: 't', title: 'x' }, { type: 'set-task-dates', taskId: 't', deadlineOn: null }, { type: 'set-task-dates', taskId: 't', attentionOn: '2026-11-20' }]) {
    assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action }).success, true, action.type)
  }
})
