// B86: what a page's header shows. A sub-item's parent rows follow its database, stopping at one in Trash.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkedFrom, pagePathTo } from '../src/domain/page-tree.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-04T10:00:00.000Z'
function work() {
  const h = harness()
  h.run({ type: 'create-document', title: 'Projects', body: '', pageId: 'projects' })
  h.run({ type: 'create-database', pageId: 'work', parentId: 'projects', homeBlockId: null, title: 'Work' } as never)
  for (const id of ['top', 'mid', 'leaf', 'other']) h.run({ type: 'add-row', databaseId: 'work', pageId: id, title: id, values: {}, at })
  return h
}
const path = (h: ReturnType<typeof work>, id: string) => pagePathTo(h.ws, id).map(p => p.id)

test('a row\'s path ends in its database; a sub-item\'s goes on through its parent rows', () => {
  const h = work()
  assert.deepEqual(path(h, 'leaf'), ['projects', 'work'], 'no sub-items yet')
  h.run({ type: 'change-database', pageId: 'work', change: { kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } } })
  for (const [id, parent] of [['mid', 'top'], ['leaf', 'mid']] as const) h.run({ type: 'set-values', pageId: id, values: { par: [parent] }, expected: {}, at })
  assert.deepEqual(path(h, 'leaf'), ['projects', 'work', 'top', 'mid'])
  assert.deepEqual(path(h, 'top'), ['projects', 'work'], 'a top row has none')
  assert.deepEqual(path(h, 'other'), ['projects', 'work'])
})

test('a sub-item\'s path stops at a parent row in Trash', () => {
  const h = work()
  h.run({ type: 'change-database', pageId: 'work', change: { kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } } })
  for (const [id, parent] of [['mid', 'top'], ['leaf', 'mid']] as const) h.run({ type: 'set-values', pageId: id, values: { par: [parent] }, expected: {}, at })
  const page = h.ws.pages.find(p => p.id === 'top')!
  page.trashedAt = at
  assert.deepEqual(path(h, 'leaf'), ['projects', 'work', 'mid'])
  assert.deepEqual(path(h, 'mid'), ['projects', 'work'])
})

test('a loop of parents ends instead of hanging', () => {
  const h = work()
  h.run({ type: 'change-database', pageId: 'work', change: { kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } } })
  h.ws.pages.find(p => p.id === 'top')!.values = { par: ['mid'] }
  h.ws.pages.find(p => p.id === 'mid')!.values = { par: ['top'] }
  assert.deepEqual(path(h, 'mid'), ['projects', 'work', 'top'])
})

test('a day has no path, and its own card is never a source under Linked from', () => {
  const h = work()
  h.run({ type: 'ensure-day', date: '2026-11-03' })
  assert.deepEqual(path(h, 'day:2026-11-03'), [])
  h.run({ type: 'make-link-pages', parentPageId: 'day:2026-11-03', items: [{ url: 'https://example.com/a', pageId: 'a', title: 'A' }] })
  assert.deepEqual(path(h, 'a'), ['day:2026-11-03'])
  assert.deepEqual(linkedFrom(h.ws, 'a').filter(e => !e.isParent), [])
})
