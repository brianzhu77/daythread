// A comment on a line (docs/design/comments.md §2, §4, step 2): held by the block's id, kept out of the document, following a cut to another page, and never taken by a copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import { threadsShownOn } from '../src/domain/comments.ts'
import { buildSearchIndex, search } from '../src/domain/search.ts'
import { lineIdsOnPage, sharedLineId, syncedBlockType } from '../src/domain/synced.ts'
import type { EditorNode } from '../src/domain/editor-document.ts'
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

// comments.md §4: a thread on a synced line belongs to the shared lines.
const syncedBlock = (id: string, syncId: string, children: EditorNode[] = []): EditorNode => ({ id, type: syncedBlockType, props: { syncId, roles: '' }, children })
function shared() {
  const h = harness()
  for (const [id, title] of [['a', 'A'], ['b', 'B'], ['c', 'C']] as const) h.run({ type: 'create-document', title, body: '', pageId: id })
  h.save('a', d => [...d, para('before', text('Before')), syncedBlock('sa', 's1', [para('l1', text('First')), para('l2', text('Second'))])])
  h.save('b', d => [...d, para('kept', text('Kept')), syncedBlock('sb', 's1')])
  h.save('c', d => [...d, syncedBlock('sc', 's1')])
  h.run({ type: 'add-comment', pageId: 'a', threadId: 'sh', commentId: 'shc', body: 'On a shared line', at, anchor: { blockId: 'l1', quote: 'First' } })
  return h
}
const shownOn = (h: ReturnType<typeof shared>, id: string) => threadsShownOn(h.ws, id).map(t => t.id)
test('a thread on a synced line shows on every page holding a place, under the place\'s own id, and its home keeps it', () => {
  const h = shared()
  for (const id of ['a', 'b', 'c']) assert.deepEqual(shownOn(h, id), ['sh'], id)
  assert.deepEqual(lineIdsOnPage(h.page('b'), 'l1'), ['l1:sb'])
  assert.equal(thread(h, 'sh').pageId, 'a')
  // Written from a copy's id, it still belongs to the shared line.
  assert.equal(sharedLineId(nodesOf(h.page('b')), 'l1:sb'), 'l1')
  assert.equal(sharedLineId(nodesOf(h.page('a')), 'kept'), 'kept')
})
test('export writes it once, under its home', () => {
  const h = shared()
  const says = exportFiles(h.ws, new Date(at)).filter(f => f.text.includes('On a shared line')).map(f => f.path)
  assert.equal(says.length, 1); assert.ok(says[0]!.includes('/A'), says[0])
})
test('Unsync here: the thread stays with the shared lines, and that place carries none', () => {
  const h = shared()
  h.run({ type: 'unsync-block', pageId: 'b', blockId: 'sb' })
  assert.deepEqual(shownOn(h, 'b'), []); assert.deepEqual(shownOn(h, 'c'), ['sh']); assert.equal(thread(h, 'sh').anchor!.blockId, 'l1')
})
test('Unsync all: it stays on its line in its home', () => {
  const h = shared()
  h.run({ type: 'unsync-block', pageId: 'a', blockId: 'sa', all: true })
  assert.equal(thread(h, 'sh').pageId, 'a'); assert.equal(thread(h, 'sh').anchor!.blockId, 'l1'); assert.deepEqual(shownOn(h, 'a'), ['sh']); assert.deepEqual(shownOn(h, 'b'), [])
})
test('the original deleted: it goes to the first place left, whose line is ordinary now (Ratchet\'s case)', () => {
  const h = shared()
  h.run({ type: 'delete-synced-place', pageId: 'a', blockId: 'sa' })
  const t = thread(h, 'sh')
  assert.equal(t.pageId, 'b'); assert.equal(t.anchor!.blockId, 'l1:sb')
  assert.ok(flat(nodesOf(h.page('b'))).some(n => n.id === 'l1:sb'))
  assert.equal(t.comments[0]!.body, 'On a shared line')
})
test('the last place deleted: it stays on its home, with its words, for the pane to say Line removed', () => {
  const h = shared()
  h.run({ type: 'delete-synced-place', pageId: 'b', blockId: 'sb' }); h.run({ type: 'delete-synced-place', pageId: 'c', blockId: 'sc' }); h.run({ type: 'delete-synced-place', pageId: 'a', blockId: 'sa' })
  const t = thread(h, 'sh')
  assert.equal(t.pageId, 'a'); assert.equal(t.anchor!.quote, 'First'); assert.deepEqual(lineIdsOnPage(h.page('a'), t.anchor!.blockId), [])
})
test('Ratchet: an ordinary line with a comment, then synced and its original removed, keeps its thread on a line', () => {
  const h = pages()
  add(h)
  h.save('one', () => [syncedBlock('so', 's2', [para('l1', text('A line'))])])
  h.save('two', d => [...d, syncedBlock('st', 's2')])
  assert.deepEqual(threadsShownOn(h.ws, 'two').map(t => t.id), ['th'])
  h.run({ type: 'delete-synced-place', pageId: 'one', blockId: 'so' })
  const t = thread(h); assert.equal(t.pageId, 'two'); assert.equal(t.anchor!.blockId, 'l1:st')
})
test('one Undo takes the anchor back with the sharing', () => {
  const h = shared()
  const { receipt } = h.run({ type: 'delete-synced-place', pageId: 'a', blockId: 'sa' })
  assert.equal(thread(h, 'sh').pageId, 'b')
  h.run({ type: 'undo', targetOperationId: receipt.operationId })
  assert.equal(thread(h, 'sh').pageId, 'a'); assert.equal(thread(h, 'sh').anchor!.blockId, 'l1'); assert.deepEqual(shownOn(h, 'c'), ['sh'])
})
test('its home in Trash: the other places still show it, and search opens the first of them (Bumblebee)', () => {
  const h = shared()
  h.run({ type: 'delete-page', pageId: 'a', at } as never)
  assert.deepEqual(shownOn(h, 'b'), ['sh'])
  const hit = search(buildSearchIndex(h.ws), 'shared line').comments.find(c => c.threadId === 'sh')
  assert.ok(hit && ['b', 'c'].includes(hit.page.id), hit?.page.id)
})
test('every place in Trash: it comes back with whichever is restored first', () => {
  const h = shared()
  const trash = (id: string) => h.run({ type: 'delete-page', pageId: id, at } as never)
  trash('a'); const last = trash('b'); trash('c')
  assert.equal(thread(h, 'sh').comments.length, 1)
  void last
  h.run({ type: 'restore-page', pageId: 'c' } as never)
  assert.deepEqual(shownOn(h, 'c'), ['sh'])
})

