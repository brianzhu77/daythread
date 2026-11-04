// A bar's All on a big view (R3-15, R3-26): up to a database's own limit, with one Undo; and several deleted together reach what one at a time would.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import { limits, type DatabaseChange } from '../src/domain/database.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-04T10:00:00.000Z'
function shelf() {
  const h = harness()
  h.run({ type: 'create-document', title: 'Host', body: '', pageId: 'host' })
  h.run({ type: 'create-database', pageId: 'db', parentId: 'host', homeBlockId: null, title: 'Shelf' })
  const change = (c: DatabaseChange) => h.run({ type: 'change-database', pageId: 'db', change: c })
  change({ kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } })
  change({ kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } })
  for (const id of ['top', 'kid', 'grand', 'other', 'lone']) h.run({ type: 'add-row', databaseId: 'db', pageId: id, title: id, at })
  const set = (pageId: string, parent: string) => h.run({ type: 'set-values', pageId, values: { par: [parent] }, expected: {}, at })
  set('kid', 'top'); set('grand', 'kid')
  // A page in a row's body, a template of the database, and a page in a page: which of these go with what they sit under is the point.
  h.run({ type: 'create-document', title: 'In the kid', body: '', pageId: 'inKid', parentId: 'kid' } as never)
  h.run({ type: 'create-document', title: 'In that', body: '', pageId: 'deep', parentId: 'inKid' } as never)
  h.run({ type: 'create-template', pageId: 'tpl', title: 'Tpl', databaseId: 'db' } as never)
  h.run({ type: 'create-document', title: 'Elsewhere', body: '', pageId: 'elsewhere' })
  return { h }
}
const trashed = (h: ReturnType<typeof harness>) => h.ws.pages.filter(p => p.trashedAt).map(p => p.id).sort()
for (const picked of [['top'], ['kid'], ['top', 'kid'], ['grand', 'other'], ['top', 'other', 'lone'], ['elsewhere', 'other'], ['host']]) {
  test(`deleting ${picked.join(', ')} together reaches what one at a time does`, () => {
    const together = shelf(), single = shelf()
    together.h.run({ type: 'delete-pages', pageIds: picked, at })
    for (const id of picked) if (!single.h.ws.pages.find(p => p.id === id)!.trashedAt) single.h.run({ type: 'delete-page', pageId: id, at })
    assert.deepEqual(trashed(together.h), trashed(single.h))
  })
}
test('the notice counts sub-items that went unpicked, once each; one Undo brings all of it back', () => {
  const { h } = shelf()
  const before = trashed(h)
  const r = h.run({ type: 'delete-pages', pageIds: ['top', 'other'], at })
  assert.equal(r.receipt.message, '2 rows moved to trash · 2 sub-items')
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(trashed(h), before)
  const both = h.run({ type: 'delete-pages', pageIds: ['top', 'kid'], at })
  assert.equal(both.receipt.message, '2 rows moved to trash · 1 sub-item', 'one picked isn\'t counted')
})
test('a picked page that isn\'t a row says page', () => {
  const { h } = shelf()
  assert.equal(h.run({ type: 'delete-pages', pageIds: ['elsewhere'], at }).receipt.message, '1 page moved to trash')
})
test('a bar reaches a database\'s own limit, and one more is refused', () => {
  assert.equal(limits.rowsAtOnce, 10_000)
  const ok = (type: string, n: number) => commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: type === 'delete-pages' ? { type, pageIds: Array.from({ length: n }, (_, i) => `r${i}`), at } : { type, items: Array.from({ length: n }, (_, i) => ({ pageId: `r${i}`, values: {}, expected: {} })), at } }).success
  for (const type of ['set-values-many', 'delete-pages']) { assert.ok(ok(type, 10_000), type); assert.equal(ok(type, 10_001), false, type) }
  const { h } = shelf()
  const many = Array.from({ length: 10_001 }, (_, i) => ({ pageId: `r${i}`, values: {}, expected: {} }))
  assert.throws(() => h.run({ type: 'set-values-many', items: many, at }), /Invalid rows/)
})
test('a thousand rows, edited and deleted together, each with one Undo', () => {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'Big' })
  h.run({ type: 'change-database', pageId: 'db', change: { kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } } })
  h.run({ type: 'add-rows', databaseId: 'db', rows: Array.from({ length: 1000 }, (_, i) => ({ pageId: `r${i}`, title: `R ${i}`, values: { n: i } })), at })
  const ids = h.ws.pages.filter(p => p.parentId === 'db').map(p => p.id)
  const edit = h.run({ type: 'set-values-many', items: ids.map((pageId, i) => ({ pageId, values: { n: 7 }, expected: { n: i } })), at })
  assert.ok(h.ws.pages.filter(p => p.parentId === 'db').every(p => p.values?.n === 7))
  h.run({ type: 'undo', targetOperationId: edit.receipt.operationId })
  assert.equal(h.ws.pages.find(p => p.id === 'r5')!.values?.n, 5)
  const del = h.run({ type: 'delete-pages', pageIds: ids, at })
  assert.equal(h.ws.pages.filter(p => p.parentId === 'db' && !p.trashedAt).length, 0)
  h.run({ type: 'undo', targetOperationId: del.receipt.operationId })
  assert.equal(h.ws.pages.filter(p => p.parentId === 'db' && !p.trashedAt).length, 1000)
})
