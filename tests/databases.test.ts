// Databases (docs/design/databases-model.md): a database is a page with a schema and views, a row is a child page with
// values read through their property. The domain's commands, placement rules and views, then the stores.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { cellValue, databaseRows, newRowValues, readValue, storedValue, viewRows, type Condition, type Database, type Property, type View } from '../src/domain/database.ts'
import { childPages, listedPages, moveRefusal, subtreeIds } from '../src/domain/page-tree.ts'
import { exportFiles } from '../src/domain/export.ts'
import { buildSearchIndex, search } from '../src/domain/search.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import type { Action, Page } from '../src/domain/types.ts'
import { harness, para, todo, today } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
const block = (id: string, pageId: string) => ({ id, type: 'database', props: { pageId, view: '' }, content: undefined, children: [] })
const dbOf = (p: Page): Database => { assert.ok(p.database, `${p.id} is a database`); return p.database }

/** A host page "Books" with an inline database "Reading list" (home block `home`), properties and rows. */
function reading() {
  const h = harness()
  h.run({ type: 'create-document', title: 'Books', body: '', pageId: 'books' })
  h.save('books', d => [...d, block('home', 'list')])
  h.run({ type: 'create-database', pageId: 'list', parentId: 'books', homeBlockId: 'home', title: 'Reading list' })
  const change = (c: Extract<Action, { type: 'change-database' }>['change']) => h.run({ type: 'change-database', pageId: 'list', change: c })
  change({ kind: 'addProperty', property: { id: 'status', name: 'Status', type: 'status' } })
  change({ kind: 'addProperty', property: { id: 'pages', name: 'Pages', type: 'number' } })
  change({ kind: 'addProperty', property: { id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'sf', name: 'SF' }, { id: 'hist', name: 'History' }] } })
  change({ kind: 'addProperty', property: { id: 'due', name: 'Due', type: 'date' } })
  change({ kind: 'addProperty', property: { id: 'owned', name: 'Owned', type: 'checkbox' } })
  const status = (name: string) => dbOf(h.page('list')).properties[0]!.options!.find(o => o.name === name)!.id
  const row = (pageId: string, title: string, values: Record<string, unknown> = {}) => h.run({ type: 'add-row', databaseId: 'list', pageId, title, values: values as never, at })
  row('dune', 'Dune', { status: status('In progress'), pages: 412, tags: ['sf'], due: { start: '2026-10-25' }, owned: true })
  row('emma', 'Emma', { pages: 300, tags: ['hist'], due: { start: '2026-10-20', end: '2026-10-24' } })
  row('ubik', 'Ubik', { status: status('Done'), tags: ['sf', 'hist'] })
  const set = (pageId: string, values: Record<string, unknown>, expected: Record<string, unknown> = {}) => h.run({ type: 'set-values', pageId, values: values as never, expected: expected as never, at })
  return Object.assign(h, { change, status, row, set })
}
const view = (filter: Condition[] = [], sort: View['sort'] = []): View => ({ id: 'v', name: 'T', layout: 'table', columns: [], sort, filter })
const titles = (rows: Page[]) => rows.map(r => r.title)
const ctx = { today, pageDate: null }

test('a database is a page with the default schema; inline needs a host, and never inside a database', () => {
  const h = reading()
  const list = h.page('list')
  assert.equal(list.type, 'document')
  assert.equal(list.parentId, 'books')
  assert.equal(dbOf(list).homeBlockId, 'home')
  assert.equal(dbOf(list).views.length, 1)
  assert.deepEqual(dbOf(list).views[0]!.columns.map(c => c.id), ['status', 'pages', 'tags', 'due', 'owned'])
  h.run({ type: 'create-database', pageId: 'top', homeBlockId: null, title: 'Films' })
  assert.equal(h.page('top').parentId, undefined)
  assert.throws(() => h.run({ type: 'create-database', pageId: 'x', homeBlockId: 'b1', title: 'X' }), /Invalid database block/)
  assert.throws(() => h.run({ type: 'create-database', pageId: 'x', parentId: 'list', homeBlockId: null, title: 'X' }), /can't go into a database/)
  assert.throws(() => h.run({ type: 'create-document', title: 'Note', body: '', parentId: 'list' }), /can't go into a database/)
  // A replay with the same id is the same database.
  assert.equal(h.run({ type: 'create-database', pageId: 'top', homeBlockId: null, title: 'Films' }).receipt.entityId, 'top')
})

test('properties: Status gets its three groups; names are unique and never "Name"; values are checked against the type', () => {
  const h = reading()
  assert.deepEqual(dbOf(h.page('list')).properties[0]!.options!.map(o => [o.name, o.group]), [['Not started', 'todo'], ['In progress', 'active'], ['Done', 'done']])
  assert.throws(() => h.change({ kind: 'addProperty', property: { id: 'p2', name: 'status', type: 'text' } }), /already a property/)
  assert.throws(() => h.change({ kind: 'addProperty', property: { id: 'p2', name: 'Name', type: 'text' } }), /already a property/)
  assert.throws(() => h.change({ kind: 'addProperty', property: { id: 'title', name: 'T', type: 'text' } }), /Invalid id/)
  assert.throws(() => h.set('dune', { pages: '12' }), /Not a value for Pages/)
  assert.throws(() => h.set('dune', { tags: ['nope'] }), /Not a value for Tags/)
  assert.throws(() => h.set('dune', { due: { start: '2026-02-30' } }), /Not a value for Due/)
  assert.throws(() => h.set('dune', { due: { start: '2026-10-25', end: '2026-10-24' } }), /Not a value for Due/)
  assert.throws(() => h.set('dune', { gone: 'x' }), /Property not found/)
  h.set('dune', { due: '2026-10-26T09:30' })
  assert.deepEqual(h.page('dune').values!.due, { start: '2026-10-26T09:30' })
})

test('set-values: refused only when a column it expected changed; other cells and rows meanwhile are fine; one Undo', () => {
  const h = reading()
  // Another device edits Dune's pages; this tab's edit of Dune's tags (expecting the old tags) still lands.
  h.set('dune', { pages: 500 }, { pages: 412 })
  h.set('dune', { tags: ['hist'] }, { tags: ['sf'] })
  assert.deepEqual(h.page('dune').values, { status: h.page('dune').values!.status, pages: 500, tags: ['hist'], due: { start: '2026-10-25' }, owned: true })
  // The same cell changed since: refused.
  assert.throws(() => h.set('dune', { pages: 450 }, { pages: 412 }), /Changed elsewhere/)
  // An absent value is expected as null; clearing removes it; the title is a column too.
  h.set('emma', { owned: true, title: '  Emma (1815) ' }, { owned: null, title: 'Emma' })
  assert.equal(h.page('emma').title, 'Emma (1815)')
  h.set('emma', { owned: false }, { owned: true })
  assert.equal('owned' in h.page('emma').values!, false)
  assert.equal(h.page('emma').editedAt, at)
  const before = structuredClone(h.page('emma'))
  const r = h.set('emma', { pages: null }, { pages: 300 })
  assert.equal('pages' in h.page('emma').values!, false)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(h.page('emma'), before)
  // Several rows at once: all or nothing.
  assert.throws(() => h.run({ type: 'set-values-many', items: [{ pageId: 'dune', values: { owned: false }, expected: {} }, { pageId: 'ubik', values: { pages: 'x' as never }, expected: {} }], at }), /Not a value/)
  assert.equal(h.page('dune').values!.owned, true)
  h.run({ type: 'set-values-many', items: [{ pageId: 'dune', values: { owned: false }, expected: { owned: true } }, { pageId: 'ubik', values: { owned: true }, expected: {} }], at })
  assert.equal(h.page('ubik').values!.owned, true)
  assert.throws(() => h.set('books', { pages: 1 }), /Not a row/)
})

test('values are read through the property: a type change converts what is obvious, and changing back restores the rest', () => {
  const h = reading()
  const property = () => dbOf(h.page('list')).properties.find(p => p.id === 'pages')!
  h.set('ubik', { title: 'Ubik' })
  assert.match(h.change({ kind: 'updateProperty', propertyId: 'pages', type: 'text' }).receipt.message, /^Changed to Text$/)
  assert.equal(cellValue(dbOf(h.page('list')), h.page('dune'), 'pages'), '412')
  // A text typed while it's Text, then back to Number: numbers read, words show as empty (and the count says so).
  h.set('ubik', { pages: 'about 200' })
  assert.match(h.change({ kind: 'updateProperty', propertyId: 'pages', type: 'number' }).receipt.message, /Changed to Number · 1 value shows as empty/)
  assert.equal(cellValue(dbOf(h.page('list')), h.page('dune'), 'pages'), 412)
  assert.equal(cellValue(dbOf(h.page('list')), h.page('ubik'), 'pages'), null)
  assert.equal(h.page('ubik').values!.pages, 'about 200')
  assert.equal(property().type, 'number')
  // Multi-select read as select takes its first known option; as text, the option names.
  const tags = dbOf(h.page('list')).properties.find(p => p.id === 'tags')!
  assert.equal(readValue({ ...tags, type: 'select' }, ['hist', 'sf']), 'hist')
  assert.equal(readValue({ ...tags, type: 'text' }, ['sf', 'hist']), 'SF, History')
  // Status: empty reads as its first To-do option.
  assert.equal(cellValue(dbOf(h.page('list')), h.page('emma'), 'status'), h.status('Not started'))
})

test('deleting a property or an option rewrites only the database page; Undo brings the values back', () => {
  const h = reading()
  const rowsBefore = ['dune', 'emma', 'ubik'].map(id => structuredClone(h.page(id)))
  const r = h.change({ kind: 'removeProperty', propertyId: 'tags' })
  assert.equal(r.receipt.message, 'Tags deleted')
  assert.deepEqual(['dune', 'emma', 'ubik'].map(id => h.page(id)), rowsBefore)
  assert.equal(dbOf(h.page('list')).views[0]!.columns.some(c => c.id === 'tags'), false)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(cellValue(dbOf(h.page('list')), h.page('ubik'), 'tags'), ['sf', 'hist'])
  const tags = dbOf(h.page('list')).properties.find(p => p.id === 'tags')!
  const removed = h.change({ kind: 'updateProperty', propertyId: 'tags', options: tags.options!.filter(o => o.id !== 'sf') })
  assert.equal(removed.receipt.message, 'Option "SF" removed from 2 rows')
  assert.equal(cellValue(dbOf(h.page('list')), h.page('dune'), 'tags'), null)
  assert.deepEqual(h.page('dune').values!.tags, ['sf'])
  assert.throws(() => h.change({ kind: 'updateProperty', propertyId: 'tags', options: [{ id: 'a', name: 'X' }, { id: 'b', name: 'x' }] }), /already an option/)
  assert.throws(() => h.change({ kind: 'removeView', viewId: dbOf(h.page('list')).views[0]!.id }), /at least one view/)
})

test('viewRows: filters by type, sorts with empty last and ties in page order, ignores a deleted property', () => {
  const h = reading()
  const ws = () => h.ws
  const rows = (filter: Condition[], sort: View['sort'] = [], context: { today: string; pageDate: string | null } = ctx) => titles(viewRows(ws(), 'list', view(filter, sort), context))
  assert.deepEqual(rows([]), ['Dune', 'Emma', 'Ubik'])
  assert.deepEqual(rows([{ by: 'title', op: 'contains', value: 'u' }]), ['Dune', 'Ubik'])
  assert.deepEqual(rows([{ by: 'pages', op: 'gt', value: 350 }]), ['Dune'])
  assert.deepEqual(rows([{ by: 'pages', op: 'isEmpty' }]), ['Ubik'])
  assert.deepEqual(rows([{ by: 'tags', op: 'contains', value: ['hist'] }]), ['Emma', 'Ubik'])
  assert.deepEqual(rows([{ by: 'tags', op: 'isNoneOf', value: ['hist'] }]), ['Dune'])
  assert.deepEqual(rows([{ by: 'status', op: 'isAnyOf', value: [h.status('Not started')] }]), ['Emma'])
  assert.deepEqual(rows([{ by: 'owned', op: 'is', value: true }]), ['Dune'])
  assert.deepEqual(rows([{ by: 'owned', op: 'is', value: false }]), ['Emma', 'Ubik'])
  // Dates: a range is on each day it covers; relative to today, or to the day page the view is on.
  assert.deepEqual(rows([{ by: 'due', op: 'is', value: { date: '2026-10-22' } }]), ['Emma'])
  assert.deepEqual(rows([{ by: 'due', op: 'onOrAfter', value: { relative: 'today', offset: 3 } }]), ['Dune'])
  assert.deepEqual(rows([{ by: 'due', op: 'is', value: { relative: 'pageDate' } }], [], { today, pageDate: '2026-10-25' }), ['Dune'])
  assert.deepEqual(rows([{ by: 'due', op: 'within', value: 'next7' }]), ['Dune', 'Emma'])
  // "pageDate" off a day page can't be read: the rule is ignored, never hiding rows.
  assert.deepEqual(rows([{ by: 'due', op: 'is', value: { relative: 'pageDate' } }]), ['Dune', 'Emma', 'Ubik'])
  assert.deepEqual(rows([], [{ by: 'pages', direction: 'desc' }]), ['Dune', 'Emma', 'Ubik'])
  assert.deepEqual(rows([], [{ by: 'pages', direction: 'asc' }]), ['Emma', 'Dune', 'Ubik'])
  assert.deepEqual(rows([], [{ by: 'status', direction: 'asc' }, { by: 'title', direction: 'desc' }]), ['Emma', 'Dune', 'Ubik'])
  assert.deepEqual(rows([], [{ by: 'tags', direction: 'asc' }]), ['Dune', 'Ubik', 'Emma'])
  // A filter or sort on a deleted property is ignored.
  h.change({ kind: 'removeProperty', propertyId: 'pages' })
  assert.deepEqual(rows([{ by: 'pages', op: 'gt', value: 350 }], [{ by: 'pages', direction: 'desc' }]), ['Dune', 'Emma', 'Ubik'])
  // A trashed row is gone from every view.
  h.run({ type: 'delete-page', pageId: 'emma', at })
  assert.deepEqual(rows([]), ['Dune', 'Ubik'])
})

test('a new row in a filtered view starts with the values that keep it in sight, or says it will be hidden', () => {
  const h = reading()
  const db = dbOf(h.page('list'))
  const reading_ = h.status('In progress')
  assert.deepEqual(newRowValues(db, view([{ by: 'status', op: 'isAnyOf', value: [reading_] }, { by: 'owned', op: 'is', value: true }]), ctx), { title: '', values: { status: reading_, owned: true }, visible: true })
  assert.deepEqual(newRowValues(db, view([{ by: 'due', op: 'is', value: { relative: 'pageDate' } }]), { today, pageDate: '2026-10-25' }).values, { due: { start: '2026-10-25' } })
  assert.equal(newRowValues(db, view([{ by: 'pages', op: 'gt', value: 100 }]), ctx).visible, false)
  assert.equal(newRowValues(db, view([{ by: 'title', op: 'contains', value: 'x' }]), ctx).visible, false)
})

test('rows: in page order, inserted before a row, never subpages or Move targets, and they stay in their database', () => {
  const h = reading()
  h.row('alpha', 'Alpha')
  h.run({ type: 'add-row', databaseId: 'list', pageId: 'zero', title: 'Zero', beforeId: 'dune', at })
  assert.deepEqual(titles(databaseRows(h.ws, 'list')), ['Zero', 'Dune', 'Emma', 'Ubik', 'Alpha'])
  assert.deepEqual(childPages(h.ws, 'books').map(p => p.id), ['list'])
  assert.deepEqual(childPages(h.ws, 'list'), [])
  assert.equal(listedPages(h.ws).some(p => p.id === 'dune'), false)
  assert.equal(h.page('dune').createdAt, at)
  // Reordering inside the database is a move-page; leaving it, or moving another page in, is refused.
  h.run({ type: 'move-page', pageId: 'alpha', parentId: 'list', beforeId: 'zero' })
  assert.deepEqual(titles(databaseRows(h.ws, 'list')), ['Alpha', 'Zero', 'Dune', 'Emma', 'Ubik'])
  assert.equal(moveRefusal(h.ws, 'dune', 'books'), 'A row stays in its database')
  assert.equal(moveRefusal(h.ws, 'dune', null), 'A row stays in its database')
  h.run({ type: 'create-document', title: 'Shelf', body: '', pageId: 'shelf' })
  assert.equal(moveRefusal(h.ws, 'shelf', 'list'), "Pages can't go into a database")
  assert.throws(() => h.run({ type: 'move-page', pageId: 'dune', parentId: null }), /stays in its database/)
  // A row's own subpages are ordinary pages.
  h.run({ type: 'create-document', title: 'Notes on Dune', body: '', pageId: 'notes', parentId: 'dune' })
  assert.deepEqual(childPages(h.ws, 'dune').map(p => p.id), ['notes'])
  assert.equal(subtreeIds(h.ws, 'list').has('notes'), true)
})

test('deleting the home block trashes the database and its rows as one batch; Undo and Restore bring them back', () => {
  const h = reading()
  const r = h.save('books', d => d.filter(n => n.id !== 'home'), { at })
  assert.equal(r.receipt.message, 'Reading list moved to trash · 3 rows')
  for (const id of ['list', 'dune', 'emma', 'ubik']) assert.equal(h.page(id).trashId, r.receipt.operationId)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(h.page('list').trashedAt, undefined)
  assert.equal(h.page('dune').trashedAt, undefined)
  h.save('books', d => d.filter(n => n.id !== 'home'), { at })
  h.run({ type: 'restore-batch', trashId: h.page('list').trashId! })
  assert.equal(databaseRows(h.ws, 'list').length, 3)
  // Restored from Trash, the block isn't back in the page: putting it back keeps it live.
  h.save('books', d => [...d, block('home', 'list')])
  assert.equal(h.page('list').trashedAt, undefined)
  // The block back in the page right after a delete (the editor's ⌘Z) restores the database and its rows.
  h.save('books', d => d.filter(n => n.id !== 'home'), { at })
  assert.ok(h.page('list').trashedAt)
  h.save('books', d => [...d, block('home', 'list')])
  assert.equal(h.page('list').trashedAt, undefined)
  assert.equal(databaseRows(h.ws, 'list').length, 3)
})

test('moving the home block inside the page, or another block of it, never trashes anything', () => {
  const h = reading()
  h.save('books', d => [block('home', 'list'), para('p1'), ...d.filter(n => n.id !== 'home')])
  h.save('books', d => [...d, block('view2', 'list')])
  h.save('books', d => d.filter(n => n.id !== 'view2'))
  assert.equal(h.page('list').trashedAt, undefined)
  assert.equal(dbOf(h.page('list')).homeBlockId, 'home')
  // Nesting the block under another line (an indent) keeps its id too.
  h.save('books', d => [{ ...para('p2'), children: [block('home', 'list')] }, ...d.filter(n => n.id !== 'home')])
  assert.equal(h.page('list').trashedAt, undefined)
})

test('Turn into page detaches it; Turn into inline, or a paste after a cut, adopts it; one that has a home stays a view', () => {
  const h = reading()
  h.run({ type: 'create-document', title: 'Shelf', body: '', pageId: 'shelf' })
  // Cut from Books: detached, now a full page under Books, nothing trashed.
  h.save('books', d => d.filter(n => n.id !== 'home'), { detachDatabaseIds: ['list'], at })
  assert.equal(h.page('list').trashedAt, undefined)
  assert.equal(dbOf(h.page('list')).homeBlockId, null)
  assert.equal(h.page('list').parentId, 'books')
  // Pasted into Shelf: its home is there now.
  h.save('shelf', d => [...d, block('pasted', 'list')], { adoptDatabaseBlocks: [{ blockId: 'pasted', pageId: 'list' }] })
  assert.equal(h.page('list').parentId, 'shelf')
  assert.equal(dbOf(h.page('list')).homeBlockId, 'pasted')
  // A second adopt while it has a home: that block is just a view.
  h.save('books', d => [...d, block('again', 'list')], { adoptDatabaseBlocks: [{ blockId: 'again', pageId: 'list' }] })
  assert.equal(h.page('list').parentId, 'shelf')
  // Never adopted into one of its own rows.
  h.save('shelf', d => d.filter(n => n.id !== 'pasted'), { detachDatabaseIds: ['list'] })
  h.save('dune', d => [...d, block('loop', 'list')], { adoptDatabaseBlocks: [{ blockId: 'loop', pageId: 'list' }] })
  assert.equal(h.page('list').parentId, 'shelf')
  assert.equal(dbOf(h.page('list')).homeBlockId, null)
  // Moved to another page with Move to…: a full page there, its old block a view.
  h.save('shelf', d => [...d, block('back', 'list')], { adoptDatabaseBlocks: [{ blockId: 'back', pageId: 'list' }] })
  h.run({ type: 'move-page', pageId: 'list', parentId: null })
  assert.equal(dbOf(h.page('list')).homeBlockId, null)
  h.save('shelf', d => d.filter(n => n.id !== 'back'), { at })
  assert.equal(h.page('list').trashedAt, undefined)
})

test('Trash: a row restored while its database is in the trash brings the database back; several rows are one batch', () => {
  const h = reading()
  h.run({ type: 'delete-page', pageId: 'dune', at })
  const del = h.run({ type: 'delete-page', pageId: 'list', at })
  assert.equal(del.receipt.message, 'Moved to trash · 2 rows')
  const r = h.run({ type: 'restore-page', pageId: 'dune' })
  assert.equal(r.receipt.message, 'Restored with Reading list')
  assert.deepEqual(titles(databaseRows(h.ws, 'list')), ['Dune', 'Emma', 'Ubik'])
  // The same from the Trash row's Restore (restore-batch) of a row whose database was deleted after it.
  const rowDel = h.run({ type: 'delete-page', pageId: 'emma', at })
  h.run({ type: 'delete-page', pageId: 'list', at })
  assert.equal(h.run({ type: 'restore-batch', trashId: rowDel.receipt.operationId }).receipt.message, 'Restored with Reading list')
  assert.equal(h.page('emma').parentId, 'list')
  assert.deepEqual(titles(databaseRows(h.ws, 'list')), ['Dune', 'Emma', 'Ubik'])
  const many = h.run({ type: 'delete-pages', pageIds: ['dune', 'ubik'], at })
  assert.equal(many.receipt.message, '2 rows moved to trash')
  assert.deepEqual(titles(databaseRows(h.ws, 'list')), ['Emma'])
  h.run({ type: 'undo', targetOperationId: many.receipt.operationId })
  assert.deepEqual(titles(databaseRows(h.ws, 'list')), ['Dune', 'Emma', 'Ubik'])
  // A database restored without its host goes to the top level as a full page.
  h.run({ type: 'delete-page', pageId: 'books', at })
  h.run({ type: 'restore-page', pageId: 'list' })
  assert.equal(h.page('list').parentId, undefined)
  assert.equal(dbOf(h.page('list')).homeBlockId, null)
})

test('Duplicate row copies the values and the body; its to-dos are new tasks, so ticking one never ticks the other', () => {
  const h = reading()
  h.save('dune', d => [todo('t1', 'Buy a copy', 'reference', '')])
  const original = h.task('Buy a copy')
  const r = h.run({ type: 'add-row', databaseId: 'list', pageId: 'dune2', title: '', copyOf: 'dune', at })
  assert.equal(r.receipt.message, 'Row duplicated')
  assert.equal(h.page('dune2').title, 'Dune (copy)')
  assert.deepEqual(h.page('dune2').values, h.page('dune').values)
  assert.deepEqual(titles(databaseRows(h.ws, 'list')), ['Dune', 'Dune (copy)', 'Emma', 'Ubik'])
  const copied = JSON.parse(h.page('dune2').document)[0]
  assert.notEqual(copied.id, 't1')
  assert.notEqual(copied.props.taskId, original.id)
  assert.equal(h.ws.tasks.filter(t => t.title === 'Buy a copy').length, 2)
  assert.equal(h.ws.tasks.find(t => t.id === copied.props.taskId)!.sourcePageId, 'dune2')
  // A done to-do is done in the copy too; ticking the copy's never touches the original.
  h.run({ type: 'task-status', taskId: original.id, status: 'done', today })
  const again = h.run({ type: 'add-row', databaseId: 'list', pageId: 'dune3', title: '', copyOf: 'dune', at })
  const copiedTask = h.ws.tasks.find(t => t.id === JSON.parse(h.page(again.receipt.entityId!).document)[0].props.taskId)!
  assert.equal(copiedTask.status, 'done')
  assert.equal(copiedTask.doneOn, today)
})

test('the stored form is what readValue reads back; the schema accepts every new command', () => {
  const props: Property[] = [
    { id: 'a', name: 'A', type: 'text' }, { id: 'b', name: 'B', type: 'number' }, { id: 'c', name: 'C', type: 'select', options: [{ id: 'o', name: 'O' }] },
    { id: 'd', name: 'D', type: 'date' }, { id: 'e', name: 'E', type: 'checkbox' }, { id: 'f', name: 'F', type: 'url' },
  ]
  const inputs = ['hello', 4.5, 'o', { start: '2026-10-22', end: '2026-10-23' }, true, 'https://example.com']
  props.forEach((p, i) => assert.deepEqual(readValue(p, storedValue(p, inputs[i])), inputs[i]))
  assert.equal(storedValue(props[0]!, ''), undefined)
  assert.equal(storedValue(props[4]!, false), undefined)
  const commands: Action[] = [
    { type: 'create-database', pageId: 'x', parentId: 'p', homeBlockId: 'b', title: 'X' },
    { type: 'change-database', pageId: 'x', change: { kind: 'updateView', viewId: 'v', filter: [{ by: 'title', op: 'contains', value: 'a' }], sort: [{ by: 'title', direction: 'asc' }] } },
    { type: 'add-row', databaseId: 'x', pageId: 'r', title: 'R', values: { a: 'x', d: { start: '2026-10-22' } }, at },
    { type: 'set-values', pageId: 'r', values: { a: null }, expected: { a: 'x' }, at },
    { type: 'save-editor', pageId: 'p', expectedContent: 'k', document: '[]', detachDatabaseIds: ['x'], adoptDatabaseBlocks: [{ blockId: 'b', pageId: 'x' }], at },
    { type: 'delete-pages', pageIds: ['r'], at },
  ]
  for (const action of commands) assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action }).success, true, action.type)
})

test('export: a database page is a table of its rows; a row carries its values as front matter', () => {
  const h = reading()
  const files = exportFiles(h.ws, new Date(at))
  const list = files.find(f => f.path.endsWith('/pages/Reading list.md'))!.text
  assert.match(list, /\| Name \| Status \| Pages \| Tags \| Due \| Owned \|/)
  assert.match(list, /\| \[\[Dune\]\] \| In progress \| 412 \| SF \| 2026-10-25 \| Yes \|/)
  assert.match(list, /\| \[\[Emma\]\] \| Not started \| 300 \| History \| 2026-10-20 → 2026-10-24 \| {2}\|/)
  const dune = files.find(f => f.path.endsWith('/pages/Dune.md'))!.text
  assert.match(dune, /"Pages": "412"/)
  assert.match(files.find(f => f.path.endsWith('/pages/Books.md'))!.text, /\[\[Reading list\]\]/)
})

test('Postgres: the database columns are added to an existing schema on start, and databases round-trip with Undo', async () => {
  const db = await PGlite.create()
  try {
    const sql = pgliteClient(db)
    // A schema as the current release leaves it: without the four columns, with a page in it.
    const old = new PostgresWorkspaceRepository(sql)
    await old.workspaceIdFor(null)
    await db.exec(`alter table daythread.pages drop column database_json, drop column row_values, drop column created_at, drop column edited_at`)
    await db.exec(`insert into daythread.pages (workspace_id, id, position, type, title, document) select id, 'kept', 99, 'document', 'Kept', '[]' from daythread.workspaces`)
    // A new process finds a column missing and adds them under its lock; the page written before is kept.
    const repo = new PostgresWorkspaceRepository(sql)
    let ws = await repo.load()
    assert.equal(ws.pages.find(p => p.id === 'kept')!.title, 'Kept')
    const cols = (await db.query<{ attname: string }>(`select attname from pg_attribute where attrelid = 'daythread.pages'::regclass and attnum > 0 and not attisdropped`)).rows.map(r => r.attname)
    for (const c of ['database_json', 'row_values', 'created_at', 'edited_at']) assert.ok(cols.includes(c), c)
    const run = async (action: Action, operationId: string) => { const r = await repo.execute({ operationId, expectedRevision: ws.revision, action }); ws = r.workspace; return r }
    await run({ type: 'create-database', pageId: 'list', homeBlockId: null, title: 'Reading list' }, 'o1')
    await run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'pages', name: 'Pages', type: 'number' } } }, 'o2')
    await run({ type: 'add-row', databaseId: 'list', pageId: 'dune', title: 'Dune', values: { pages: 412 }, at }, 'o3')
    const edit = await run({ type: 'set-values', pageId: 'dune', values: { pages: 500 }, expected: { pages: 412 }, at }, 'o4')
    const loaded = await new PostgresWorkspaceRepository(sql).load()
    assert.deepEqual(loaded.pages.find(p => p.id === 'dune')!.values, { pages: 500 })
    assert.equal(loaded.pages.find(p => p.id === 'dune')!.createdAt, at)
    assert.deepEqual(loaded.pages.find(p => p.id === 'list')!.database, ws.pages.find(p => p.id === 'list')!.database)
    await run({ type: 'undo', targetOperationId: edit.receipt.operationId }, 'o5')
    assert.deepEqual((await new PostgresWorkspaceRepository(sql).load()).pages.find(p => p.id === 'dune')!.values, { pages: 412 })
    // A page that isn't a database reads without the fields at all.
    assert.equal('database' in loaded.pages.find(p => p.id === 'dune')!, false)
    assert.equal('values' in loaded.pages.find(p => p.id === 'list')!, false)
  } finally { await db.close() }
})

test('search: a row is labelled by its database and found by its values', () => {
  const h = reading()
  const index = buildSearchIndex(h.ws)
  const hit = (q: string) => search(index, q, today).pages.map(p => `${p.page.title} · ${p.path}`)
  assert.deepEqual(hit('dune'), ['Dune · Reading list'])
  assert.deepEqual(hit('history').sort(), ['Emma · Reading list', 'Ubik · Reading list'])
})
