import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { childPages, linkedFrom, moveTargets, pagesInDays, trashBatches, trashedChildPages, visiblePages } from '../src/domain/page-tree.ts'
import { tagIndex } from '../src/domain/tags.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// A4 trash and restore (docs/design/a4-trash-data.md §2–§3, pages-trash-layout.md at 2956eea).
const run = (ws: Workspace, action: Action, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action, operationId?: string) => run(ws, action, operationId).workspace
const page = (ws: Workspace, id: string) => ws.pages.find(p => p.id === id)!
const at = '2026-10-20T17:30:00.000Z'
const card = (id: string, pageId: string): EditorNode => ({ id, type: 'pageLink', props: { pageId } })
const line = (id: string, text: string): EditorNode => ({ id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }] })
function save(ws: Workspace, pageId: string, edit: (doc: EditorNode[]) => EditorNode[]) {
  const p = page(ws, pageId)
  return ok(ws, { type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))) })
}
function subpage(ws: Workspace, parentId: string, pageId: string) {
  ws = ok(ws, { type: 'create-document', title: pageId, body: '', pageId, parentId })
  return save(ws, parentId, doc => [...doc, card(`card:${parentId}:${pageId}`, pageId)])
}
const ids = (pages: { id: string }[]) => pages.map(p => p.id)
const del = (ws: Workspace, pageId: string, op: string) => ok(ws, { type: 'delete-page', pageId, at }, op)

/** Sun Oct 18 > A > B > C, A has a #recipe line and a task; a top-level page T with a card to A. */
function tree() {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-18' })
  const day = ws.pages[0]!.id
  ws = subpage(ws, day, 'A'); ws = subpage(ws, 'A', 'B'); ws = subpage(ws, 'B', 'C')
  ws = save(ws, 'A', doc => [...doc, line('a-line', 'ragu #recipe'), { id: 'a-task', type: 'task', props: { taskId: 'editor-task:a-task', role: 'reference' }, content: 'buy tomatoes' }])
  ws = ok(ws, { type: 'create-document', title: 'T', body: '', pageId: 'T' })
  ws = save(ws, 'T', doc => [...doc, card('card:T:A', 'A')])
  return { ws, day }
}

test('delete: the page and its live subpages go to the trash as one batch and leave every list', () => {
  const { ws: before, day } = tree()
  const result = run(before, { type: 'delete-page', pageId: 'A', at }, 'op1')
  const ws = result.workspace
  assert.equal(result.receipt.message, 'Moved to trash · 2 subpages')
  for (const id of ['A', 'B', 'C']) assert.deepEqual([page(ws, id).trashedAt, page(ws, id).trashId], [at, 'op1'])
  assert.deepEqual(ids(visiblePages(ws)).sort(), [day, 'T'].sort())
  assert.deepEqual(ids(childPages(ws, day)), [])
  assert.deepEqual(pagesInDays(ws), [])
  assert.equal(ids(moveTargets(ws, 'T')).some(id => ['A', 'B', 'C'].includes(id)), false)
  assert.equal(tagIndex(ws).some(t => t.key === 'recipe'), false)
  assert.deepEqual(linkedFrom(ws, 'A').map(e => [e.page.id, e.removed]), [[day, false], ['T', false]])
  assert.deepEqual(linkedFrom(ws, 'B').map(e => [e.page.id, e.removed]), [['A', true]])
  // Nothing else changes: tasks, materials, other pages' cards.
  assert.deepEqual(ws.tasks, before.tasks)
  assert.deepEqual(page(ws, 'T').sections, page(before, 'T').sections)
  assert.deepEqual(trashBatches(ws).map(b => [b.trashId, b.top.id, b.members.length]), [['op1', 'A', 3]])
  assert.deepEqual(ids(trashedChildPages(ws, page(ws, 'A'))), ['B'])
})

test('Undo of a delete brings everything back; tags and lists show again', () => {
  const { ws: before, day } = tree()
  const ws = ok(del(before, 'A', 'op1'), { type: 'undo', targetOperationId: 'op1' })
  assert.deepEqual(ws.pages, before.pages)
  assert.deepEqual(ids(childPages(ws, day)), ['A'])
  assert.ok(tagIndex(ws).some(t => t.key === 'recipe'))
})

test('day pages, missing pages and pages already in the trash are refused', () => {
  const { ws, day } = tree()
  assert.throws(() => del(ws, day, 'x'), /Day pages can't be deleted/)
  assert.throws(() => del(ws, 'nope', 'x'), /Page not found/)
  assert.throws(() => del(del(ws, 'A', 'op1'), 'B', 'x'), /in trash/)
  assert.equal(commandSchema.safeParse({ operationId: 'x', expectedRevision: 0, action: { type: 'delete-page', pageId: 'A', at: 'yesterday' } }).success, false)
  assert.equal(commandSchema.safeParse({ operationId: 'x', expectedRevision: 0, action: { type: 'delete-page', pageId: 'A', at } }).success, true)
})

test('a trashed page is read-only: no edit, rename, move, subpage or new card to it', () => {
  const { ws: before, day } = tree()
  const ws = del(before, 'A', 'op1')
  const a = page(ws, 'A')
  for (const action of [
    { type: 'save-editor', pageId: 'A', expectedContent: pageContentKey(a), document: JSON.stringify(editorSeed(a, ws)) },
    { type: 'rename-page', pageId: 'A', title: 'x' },
    { type: 'move-page', pageId: 'A', parentId: null },
    { type: 'move-page', pageId: 'T', parentId: 'A' },
    { type: 'create-document', title: '', body: '', pageId: 'new', parentId: 'B' },
    { type: 'create-document', title: '', body: '', pageId: 'A', parentId: day },
    { type: 'insert-reference', pageId: 'T', sectionId: page(ws, 'T').sections[0]!.id, targetPageId: 'A' },
  ] as Action[]) assert.throws(() => run(ws, action), /in trash/, action.type)
})

test('two batches: delete a child, then its parent; restore the parent leaves the child in the trash', () => {
  const { ws: before, day } = tree()
  let ws = del(del(before, 'B', 'op-child'), 'A', 'op-parent')
  assert.deepEqual([page(ws, 'A').trashId, page(ws, 'B').trashId, page(ws, 'C').trashId], ['op-parent', 'op-child', 'op-child'])
  assert.deepEqual(trashBatches(ws).map(b => [b.top.id, b.members.length]).sort(), [['A', 1], ['B', 2]])
  ws = ok(ws, { type: 'restore-batch', trashId: 'op-parent' })
  assert.equal(page(ws, 'A').trashedAt, undefined)
  assert.equal(page(ws, 'A').parentId, day)
  assert.equal(page(ws, 'B').trashId, 'op-child')
  // The child restored now goes back under its live parent.
  ws = ok(ws, { type: 'restore-batch', trashId: 'op-child' })
  assert.deepEqual(ids(childPages(ws, 'A')), ['B'])
  assert.deepEqual(ids(childPages(ws, 'B')), ['C'])
  assert.deepEqual(trashBatches(ws), [])
})

test('restore a child alone while its parent is in the trash: top level, with its own subtree from that delete', () => {
  const { ws: before } = tree()
  const result = run(del(before, 'A', 'op1'), { type: 'restore-page', pageId: 'B' })
  const ws = result.workspace
  assert.equal(result.receipt.message, 'Restored to Pages')
  assert.equal(page(ws, 'B').parentId, undefined)
  assert.ok(ids(childPages(ws, null)).includes('B'))
  assert.deepEqual(ids(childPages(ws, 'B')), ['C'])
  assert.equal(page(ws, 'A').trashId, 'op1')
  assert.deepEqual(trashBatches(ws).map(b => [b.top.id, b.members.length]), [['A', 1]])
})

test('restore-page only takes members of the same delete: a subpage trashed earlier stays', () => {
  const { ws: before, day } = tree()
  const ws = ok(del(del(before, 'C', 'op-c'), 'A', 'op-a'), { type: 'restore-page', pageId: 'A' })
  assert.equal(page(ws, 'A').parentId, day)
  assert.equal(page(ws, 'B').trashedAt, undefined)
  assert.equal(page(ws, 'C').trashId, 'op-c')
})

test('same-batch delete → restore only a child → move it → restore the batch: the child stays where it was moved', () => {
  const { ws: before, day } = tree()
  let ws = ok(del(before, 'A', 'op1'), { type: 'restore-page', pageId: 'B' })
  ws = ok(ws, { type: 'move-page', pageId: 'B', parentId: 'T' })
  ws = ok(ws, { type: 'restore-batch', trashId: 'op1' })
  assert.equal(page(ws, 'A').parentId, day)
  assert.equal(page(ws, 'B').parentId, 'T')
  assert.deepEqual(ids(childPages(ws, 'A')), [])
  assert.deepEqual(trashBatches(ws), [])
  assert.throws(() => run(ws, { type: 'restore-batch', trashId: 'op1' }), /Nothing left/)
  assert.throws(() => run(ws, { type: 'restore-page', pageId: 'A' }), /not in trash/)
})

test('restore keeps the stored order; a restored page under a day goes back under that day', () => {
  const { ws: before, day } = tree()
  const ws = ok(del(before, 'A', 'op1'), { type: 'restore-batch', trashId: 'op1' })
  assert.deepEqual(ids(ws.pages), ids(before.pages))
  assert.deepEqual(ids(childPages(ws, day)), ['A'])
  assert.deepEqual(linkedFrom(ws, 'B').map(e => [e.page.id, e.removed]), [['A', false]])
  assert.ok(tagIndex(ws).some(t => t.key === 'recipe'))
})
