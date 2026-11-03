// B29: a link to a line follows it when it's cut and pasted. One page holds an id; whoever saves second gets a new one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flatNodes, pageNodes } from '../src/domain/editor-document.ts'
import { refTargetPage, resolveLine } from '../src/domain/page-refs.ts'
import { harness, para, text } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
const line = (id: string, words: string) => para(id, text(words))
function pages() {
  const h = harness()
  h.run({ type: 'create-document', title: 'A', body: '', pageId: 'a' })
  h.run({ type: 'create-document', title: 'B', body: '', pageId: 'b' })
  h.save('a', d => [...d, line('x', 'The line')])
  return h
}
const target = { pageId: 'a', lineId: 'x' }
const ids = (h: ReturnType<typeof harness>, pageId: string) => flatNodes(pageNodes(h.page(pageId))).map(n => n.id)

test('moved: the link follows the line to its new page, with its words', () => {
  const h = pages()
  assert.equal(resolveLine(h.ws, target).state, 'live')
  h.save('a', d => d.filter(n => n.id !== 'x'))
  assert.equal(resolveLine(h.ws, target).state, 'line-not-found')
  const r = h.save('b', d => [...d, line('x', 'The line')])
  assert.equal(r.receipt.renamed, undefined)
  const moved = resolveLine(h.ws, target)
  assert.deepEqual([moved.state, moved.pageId, moved.blockId, moved.words], ['moved', 'b', 'x', 'The line'])
  assert.equal(refTargetPage(h.ws, target), 'b')
})

test('a copy that arrives with an id another page holds gets a new one, and the link stays on the original', () => {
  const h = pages()
  const r = h.save('b', d => [...d, line('x', 'The line')])
  const renamed = r.receipt.renamed!
  assert.ok(renamed.x && renamed.x !== 'x')
  assert.ok(ids(h, 'b').includes(renamed.x!))
  assert.ok(!ids(h, 'b').includes('x'))
  assert.deepEqual([resolveLine(h.ws, target).state, resolveLine(h.ws, target).pageId], ['live', 'a'])
})

test('the same answer again for a client that missed the rename', () => {
  const h = pages()
  const first = h.save('b', d => [...d, line('x', 'The line')]).receipt.renamed!.x!
  const again = h.save('b', d => [...d.filter(n => n.id !== first), line('x', 'The line')]).receipt.renamed!.x!
  assert.equal(again, first)
})

test('Undo at the source after a move: the line comes back with a new id, and the link keeps following the moved one', () => {
  const h = pages()
  const before = pageNodes(h.page('a'))
  h.save('a', d => d.filter(n => n.id !== 'x'))
  h.save('b', d => [...d, line('x', 'The line')])
  const r = h.save('a', () => before as never)
  assert.ok(r.receipt.renamed?.x)
  assert.ok(!ids(h, 'a').includes('x'))
  assert.deepEqual([resolveLine(h.ws, target).state, resolveLine(h.ws, target).pageId], ['moved', 'b'])
})

test('an id held in Trash counts, a page in Trash reads as trashed, and an edit on the page keeps its own ids', () => {
  const h = pages()
  h.run({ type: 'delete-page', pageId: 'a', at })
  assert.ok(h.save('b', d => [...d, line('x', 'The line')]).receipt.renamed?.x)
  assert.equal(resolveLine(h.ws, target).state, 'trashed')
  const h2 = pages()
  assert.equal(h2.save('a', d => d.map(n => n.id === 'x' ? line('x', 'New words') : n)).receipt.renamed, undefined)
})

test('a page gone for good: the link still finds the moved line', () => {
  const h = pages()
  h.save('a', d => d.filter(n => n.id !== 'x'))
  h.save('b', d => [...d, line('x', 'The line')])
  assert.equal(resolveLine(h.ws, { pageId: 'nowhere', lineId: 'x' }).pageId, 'b')
  assert.equal(resolveLine(h.ws, { pageId: 'nowhere', lineId: 'none' }).state, 'page-not-found')
})

test('nothing new on the page: no scan result, nothing renamed', () => {
  const h = pages()
  assert.equal(h.save('a', d => d).receipt.renamed, undefined)
})
