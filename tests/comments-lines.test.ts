// A comment on a line (docs/design/comments.md §2, §4, step 2): held by the block's id, kept out of the document, following a cut to another page, and never taken by a copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import { exportFiles } from '../src/domain/export.ts'
import { applyDiff, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'
import { dayId, flat, harness, nodesOf, para, text, today, todo, tomorrow } from './v2-helpers.ts'

const at = '2026-11-05T10:00:00.000Z'
function pages() {
  const h = harness()
  h.run({ type: 'create-document', title: 'One', body: '', pageId: 'one' })
  h.run({ type: 'create-document', title: 'Two', body: '', pageId: 'two' })
  h.save('one', () => [para('l1', text('A line')), para('l2', text('Another'))])
  h.save('two', () => [para('t1', text('Over here'))])
  return h
}
const add = (h: ReturnType<typeof pages>, pageId = 'one', blockId = 'l1', threadId = 'th') => h.run({ type: 'add-comment', pageId, threadId, commentId: `${threadId}c`, body: 'A note', at, anchor: { blockId, quote: 'A line' } })
const thread = (h: ReturnType<typeof pages>, id = 'th') => h.ws.threads!.find(t => t.id === id)!

test('stored with its line, and the document is untouched', () => {
  const h = pages(), doc = h.page('one').document
  add(h)
  assert.deepEqual(thread(h).anchor, { blockId: 'l1', quote: 'A line' })
  assert.equal(h.page('one').document, doc)
  // A reply leaves the anchor as it was, and can't set another.
  h.run({ type: 'add-comment', pageId: 'one', threadId: 'th', commentId: 'r', body: 'Reply', at })
  assert.equal(thread(h).comments.length, 2); assert.equal(thread(h).anchor?.blockId, 'l1')
})
test('a long quote is kept short, and the command stops one past its limit', () => {
  const h = pages()
  h.run({ type: 'add-comment', pageId: 'one', threadId: 'q', commentId: 'qc', body: 'A note', at, anchor: { blockId: 'l1', quote: 'x'.repeat(1000) } })
  assert.equal(thread(h, 'q').anchor!.quote.length, 300)
  assert.ok(!commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'add-comment', pageId: 'one', threadId: 'a', commentId: 'b', body: 'c', at, anchor: { blockId: 'l1', quote: 'x'.repeat(3000) } } }).success)
})
test('cut and pasted to another page, the thread goes with its line; a copy with the same words does not take it', () => {
  const h = pages()
  add(h)
  // Pasted first: it's on both for a moment, so it stays home.
  h.save('two', () => [para('t1', text('Over here')), para('l1', text('A line'))])
  assert.equal(thread(h).pageId, 'one')
  // Gone from home: it follows on the next save of where it is.
  h.save('one', () => [para('l2', text('Another'))])
  h.save('two', () => [para('t1', text('Over here, typed')), para('l1', text('A line'))])
  assert.equal(thread(h).pageId, 'two')
})
test('a line deleted keeps its thread, on its page', () => {
  const h = pages()
  add(h)
  h.save('one', () => [para('l2', text('Another'))])
  assert.equal(thread(h).pageId, 'one'); assert.equal(thread(h).anchor?.quote, 'A line')
})
test('the rows hold it, and a row from before anchors reads as a page comment', () => {
  const h = pages()
  add(h)
  const rows = rowsOf(h.ws), row = rows.threads.find(t => t.id === 'th')!
  assert.equal(row.anchor, JSON.stringify({ blockId: 'l1', quote: 'A line' }))
  assert.deepEqual(workspaceOf(rows).threads!.find(t => t.id === 'th')!.anchor, { blockId: 'l1', quote: 'A line' })
  const old = { ...rows, threads: rows.threads.map(({ anchor: _anchor, ...t }) => t) }
  assert.equal('anchor' in workspaceOf(old).threads![0]!, false)
})
test('export writes what it was on', () => {
  const h = pages()
  add(h)
  const file = exportFiles(h.ws, new Date(at)).find(f => f.path.includes('One'))!
  assert.ok(file.text.includes('> A line'), file.text.slice(-120))
})
test('an undo written by a build with no anchors keeps the one a thread has (Roadbuster)', () => {
  const h = pages()
  add(h)
  const rows = rowsOf(h.ws), { anchor: _anchor, ...older } = rows.threads[0]!
  const after = applyDiff(rows, { pages: { upsert: [], remove: [] }, tasks: { upsert: [], remove: [] }, deleted: { upsert: [], remove: [] }, threads: { upsert: [{ ...older, resolved_at: null }], remove: [] } } as never)
  assert.equal(after.threads[0]!.anchor, rows.threads[0]!.anchor)
})
test('a to-do planned to another day takes its thread to its new line (Roadbuster)', () => {
  const h = pages()
  h.run({ type: 'ensure-day', date: today })
  h.save(dayId(today), () => [todo('row1', 'A to-do', 'plan', today)])
  const row = flat(nodesOf(h.page(dayId(today)))).find(n => n.type === 'task')!, taskId = String(row.props!.taskId)
  h.run({ type: 'add-comment', pageId: dayId(today), threadId: 'td', commentId: 'tdc', body: 'A note', at, anchor: { blockId: row.id, quote: 'A to-do', taskId } })
  // Planned on a day of its own, it keeps a line where it was and has its plan row there: the thread stays on a line that exists.
  h.run({ type: 'plan-task', taskId, date: tomorrow } as never)
  const here = thread(h, 'td'); assert.ok(flat(nodesOf(h.page(here.pageId))).some(n => n.id === here.anchor!.blockId), 'on a line that exists')
  // That line gone from the old day, it goes to where the to-do is now.
  h.save(dayId(today), nodes => nodes.filter(n => n.id !== here.anchor!.blockId))
  const t = thread(h, 'td'), moved = flat(nodesOf(h.page(t.pageId))).find(n => n.id === t.anchor!.blockId)
  assert.equal(h.page(t.pageId).date, tomorrow); assert.ok(moved, 'on its new line')
  assert.equal(String(moved!.props!.taskId), taskId)
})

