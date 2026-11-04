// Sub-items (docs/design/sub-items.md, R4-4): turning on and off, the tree, a loop refused, delete and duplicate with one Undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, viewRows, type Database, type DatabaseChange, type View } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { treeEntries } from '../src/domain/sub-items.ts'
import { withLinks } from '../src/domain/relations.ts'
import type { Page } from '../src/domain/types.ts'
import { harness, today } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
function work() {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'w', homeBlockId: null, title: 'Work' })
  const change = (c: DatabaseChange) => h.run({ type: 'change-database', pageId: 'w', change: c })
  change({ kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } })
  for (const [id, n] of [['top', 1], ['kid', 2], ['grand', 3], ['great', 4], ['other', 5], ['kid2', 6]] as const) h.run({ type: 'add-row', databaseId: 'w', pageId: id, title: id, values: { n }, at })
  change({ kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } })
  const set = (pageId: string, parent: string | null) => h.run({ type: 'set-values', pageId, values: { par: parent ? [parent] : null }, expected: {}, at })
  set('kid', 'top'); set('grand', 'kid'); set('great', 'grand'); set('kid2', 'top')
  const db = () => h.ws.pages.find(p => p.id === 'w')!.database as Database
  const live = () => h.ws.pages.filter(p => p.parentId === 'w' && !p.trashedAt)
  return { h, change, set, db, live }
}
const context = { today, pageDate: null, weekStart: 0 as const }

test('turning on makes two linked relations out of sight; turning off leaves every row and value; on again uses them', () => {
  const s = work(), db = s.db()
  assert.deepEqual(db.subItems, { parent: 'par', sub: 'sub' })
  assert.deepEqual(db.properties.filter(p => p.type === 'relation').map(p => [p.name, p.limit ?? null, p.mirror]), [['Parent item', 1, 'sub'], ['Sub-item', null, 'par']])
  assert.ok(!db.views[0]!.columns.some(c => c.id === 'par' || c.id === 'sub'))
  assert.deepEqual(s.h.ws.pages.find(p => p.id === 'top')!.values!.sub, ['kid', 'kid2'])
  const before = JSON.stringify(s.live().map(r => r.values))
  s.change({ kind: 'setSubItems', on: null })
  assert.equal(s.db().subItems, undefined)
  assert.equal(JSON.stringify(s.live().map(r => r.values)), before)
  assert.ok(s.db().properties.some(p => p.id === 'par'))
  s.change({ kind: 'setSubItems', on: { parent: 'par', sub: 'sub', using: true } })
  assert.deepEqual(s.db().subItems, { parent: 'par', sub: 'sub' })
  assert.equal(JSON.stringify(s.live().map(r => r.values)), before)
  // Deleting either relation ends it, with the rows left.
  s.change({ kind: 'removeProperty', propertyId: 'sub' })
  assert.equal(s.db().subItems, undefined)
})
test('a row can\'t be its own ancestor, through Parent item or Sub-item, nor can its parent become its child', () => {
  const s = work()
  assert.throws(() => s.set('top', 'top'), /own ancestor/)
  assert.throws(() => s.set('top', 'grand'), /own ancestor/)
  assert.throws(() => s.h.run({ type: 'set-values', pageId: 'great', values: { sub: ['top'] }, expected: {}, at }), /own ancestor/)
  assert.equal(s.h.ws.pages.find(p => p.id === 'top')!.values!.par, undefined)
  // One parent: a new one replaces the old, on both sides.
  s.set('kid', 'other')
  assert.deepEqual(s.h.ws.pages.find(p => p.id === 'other')!.values!.sub, ['kid'])
  assert.deepEqual(s.h.ws.pages.find(p => p.id === 'top')!.values!.sub, ['kid2'])
})
test('the tree: nested in order, a closed toggle hides its own, a match under a parent that doesn\'t match keeps it as context', () => {
  const s = work(), rows = s.live(), db = s.db()
  const shape = (open: string[], shown: Page[] = rows, every = false) => treeEntries(db, shown, rows, id => open.includes(id), every).map(e => `${'  '.repeat(e.depth)}${e.row.id}${e.hasChildren ? (e.open ? '-' : '+') : ''}${e.context ? '*' : ''}`)
  assert.deepEqual(shape([]), ['top+', 'other'])
  assert.deepEqual(shape(['top']), ['top-', '  kid+', '  kid2', 'other'])
  assert.deepEqual(shape(['top', 'kid', 'grand']), ['top-', '  kid-', '    grand-', '      great', '  kid2', 'other'])
  // A filter that only matches a grandchild: what's above it is context, not counted.
  const great = rows.filter(r => r.id === 'great')
  assert.deepEqual(shape(['top', 'kid', 'grand'], great), ['top-*', '  kid-*', '    grand-*', '      great'])
  // Parents only: top-level rows, opening onto all their sub-items, whatever they match.
  const parents = rows.filter(r => r.id === 'top' || r.id === 'other')
  assert.deepEqual(shape(['top'], parents, true), ['top-', '  kid+', '  kid2', 'other'])
})
test('which rows a view counts: both, parents only, sub-items only', () => {
  const s = work(), view: View = s.db().views[0]!
  const ids = (extra: Partial<View>) => viewRows(s.h.ws, 'w', { ...view, ...extra }, context).map(r => r.id).sort()
  assert.deepEqual(ids({}), ['grand', 'great', 'kid', 'kid2', 'other', 'top'])
  assert.deepEqual(ids({ subItemsShow: 'parents' }), ['other', 'top'])
  assert.deepEqual(ids({ subItemsShow: 'subs' }), ['grand', 'great', 'kid', 'kid2'])
  s.change({ kind: 'updateView', viewId: view.id, subItemsDisplay: 'flat', subItemsShow: 'parents' })
  assert.deepEqual([s.db().views[0]!.subItemsDisplay, s.db().views[0]!.subItemsShow], ['flat', 'parents'])
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'change-database', pageId: 'p', change: { kind: 'setSubItems', on: { parent: 'a', sub: 'b' } } } }).success)
})
test('deleting a parent takes its sub-items, says how many, one Undo restores them; Restore from Trash brings them together', () => {
  const s = work()
  const r = s.h.run({ type: 'delete-page', pageId: 'kid', at })
  assert.equal(r.receipt.message, 'Moved to trash · 2 sub-items')
  assert.deepEqual(s.live().map(p => p.id).sort(), ['kid2', 'other', 'top'])
  assert.equal(new Set(s.h.ws.pages.filter(p => p.trashedAt).map(p => p.trashId)).size, 1)
  s.h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(s.live().length, 6)
  s.h.run({ type: 'delete-page', pageId: 'top', at })
  assert.equal(s.live().length, 1)
  s.h.run({ type: 'restore-page', pageId: 'top' })
  assert.equal(s.live().length, 6)
  assert.deepEqual(s.h.ws.pages.find(p => p.id === 'great')!.values!.par, ['grand'])
  s.h.run({ type: 'delete-pages', pageIds: ['kid'], at })
  assert.equal(s.live().length, 3)
})
test('duplicating copies the tree with its own links, leaves the old rows where they were, and one Undo takes it back', () => {
  const s = work()
  const r = s.h.run({ type: 'add-row', databaseId: 'w', pageId: 'copy', title: '', copyOf: 'top', at })
  const page = (id: string) => s.h.ws.pages.find(p => p.id === id)!
  assert.deepEqual(page('top').values!.sub, ['kid', 'kid2'])
  assert.deepEqual(page('kid').values!.par, ['top'])
  assert.equal(page('copy').title, 'top (copy)')
  assert.equal(s.live().length, 11)
  const kids = page('copy').values!.sub as string[]
  assert.equal(kids.length, 2)
  assert.deepEqual(kids.map(id => page(id).title), ['kid', 'kid2'])
  const kidCopy = page(kids[0]!)
  assert.deepEqual(kidCopy.values!.par, ['copy'])
  assert.equal(page((kidCopy.values!.sub as string[])[0]!).title, 'grand')
  assert.equal(cellValue(s.db(), kidCopy, 'n'), 2)
  s.h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(s.live().length, 6)
  assert.deepEqual(page('top').values!.sub, ['kid', 'kid2'])
})
test('rollups and formulas read them as the relations they are', () => {
  const s = work()
  s.change({ kind: 'addProperty', property: { id: 'count', name: 'Count', type: 'rollup', rollup: { relation: 'sub', property: 'title', fn: 'countAll' } } })
  const read = withLinks(s.h.ws)
  assert.equal(cellValue(read.pages.find(p => p.id === 'w')!.database!, read.pages.find(p => p.id === 'top')!, 'count'), 2)
})
