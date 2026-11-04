// B86: what a page's header shows. A sub-item's parent rows follow its database, stopping at one in Trash.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageContentKey } from '../src/domain/editor-document.ts'
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

function linked() {
  const h = work()
  h.run({ type: 'create-database', pageId: 'people', parentId: 'projects', homeBlockId: null, title: 'People' } as never)
  h.run({ type: 'add-row', databaseId: 'people', pageId: 'ann', title: 'Ann', values: {}, at })
  const change = (c: never) => h.run({ type: 'change-database', pageId: 'work', change: c })
  change({ kind: 'addProperty', property: { id: 'owner', name: 'Owner', type: 'relation', target: 'people' } } as never)
  change({ kind: 'addProperty', property: { id: 'pal', name: 'Pal', type: 'relation', target: 'people' } } as never)
  change({ kind: 'setMirror', propertyId: 'pal', mirror: { id: 'palback', name: 'Work' } } as never)
  return h
}
const sources = (h: ReturnType<typeof work>, id: string) => linkedFrom(h.ws, id).filter(e => !e.isParent).map(e => e.page.id)

test('a one-way relation shows its row under Linked from on the target', () => {
  const h = linked()
  h.run({ type: 'set-values', pageId: 'top', values: { owner: ['ann'] }, expected: {}, at })
  h.run({ type: 'set-values', pageId: 'mid', values: { owner: ['ann'] }, expected: {}, at })
  assert.deepEqual(sources(h, 'ann').sort(), ['mid', 'top'])
  h.run({ type: 'set-values', pageId: 'top', values: { owner: [] }, expected: { owner: ['ann'] }, at })
  assert.deepEqual(sources(h, 'ann'), ['mid'], 'taken off, it goes')
})

test('a two-way relation, a sub-item and a dependency don\'t: the target already names them', () => {
  const h = linked()
  h.run({ type: 'set-values', pageId: 'top', values: { pal: ['ann'] }, expected: {}, at })
  assert.deepEqual(sources(h, 'ann'), [], 'two-way')
  h.run({ type: 'change-database', pageId: 'work', change: { kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } } })
  h.run({ type: 'set-values', pageId: 'mid', values: { par: ['top'] }, expected: {}, at })
  assert.deepEqual(sources(h, 'top'), [], 'sub-item')
  assert.deepEqual(sources(h, 'mid'), [], 'and its parent')
})

test('a linked view shows its page on the database\'s page; the home block doesn\'t', () => {
  const h = linked()
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
  const notes = h.ws.pages.find(p => p.id === 'notes')!
  h.run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(notes), document: JSON.stringify([{ id: 'lv', type: 'database', props: { pageId: 'work' }, children: [] }]) } as never)
  assert.deepEqual(sources(h, 'work'), ['notes'])
  assert.deepEqual(sources(h, 'people'), [])
})

test('a source in Trash comes last, whatever its date', () => {
  const h = work()
  h.run({ type: 'create-document', title: 'New', body: '', pageId: 'newer' })
  h.run({ type: 'create-document', title: 'Old', body: '', pageId: 'older' })
  for (const [source, id] of [['older', 'c1'], ['newer', 'c2']] as const) {
    const p = h.ws.pages.find(x => x.id === source)!
    h.run({ type: 'save-editor', pageId: source, expectedContent: pageContentKey(p), document: JSON.stringify([{ id, type: 'pageLink', props: { pageId: 'other' }, children: [] }]) } as never)
  }
  const before = sources(h, 'other')
  const first = before[0]!, second = before[1]!
  h.run({ type: 'delete-page', pageId: first, at })
  const after = linkedFrom(h.ws, 'other')
  assert.deepEqual(after.map(e => e.page.id), [second, first])
  assert.deepEqual(after.map(e => e.removed), [false, true])
})

test('no references, no entries', () => {
  const h = work()
  assert.deepEqual(linkedFrom(h.ws, 'other').filter(e => !e.isParent), [])
})
