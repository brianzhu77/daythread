import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { childPages, sidebarDays, linkedFrom, moveRefusal, moveTargets, pageAncestors, subtreeIds } from '../src/domain/page-tree.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import type { Action, Workspace } from '../src/domain/types.ts'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'

// pages-delta N-2 / N-5 step B: Move to…, the tree queries and Linked from.
const run = (ws: Workspace, action: Action, operationId: string = crypto.randomUUID()) => applyCommand(ws, { operationId, expectedRevision: ws.revision, action })
const ok = (ws: Workspace, action: Action) => run(ws, action).workspace
const page = (ws: Workspace, id: string) => ws.pages.find(p => p.id === id)!
const card = (id: string, pageId: string): EditorNode => ({ id, type: 'pageLink', props: { pageId } })
function save(ws: Workspace, pageId: string, edit: (doc: EditorNode[]) => EditorNode[]) {
  const p = page(ws, pageId)
  return ok(ws, { type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))) })
}
/** `/page` in `parentId`: the child page plus its card at the end of the parent's body. */
function subpage(ws: Workspace, parentId: string, pageId: string) {
  ws = ok(ws, { type: 'create-document', title: pageId, body: '', pageId, parentId })
  return save(ws, parentId, doc => [...doc, card(`card:${parentId}:${pageId}`, pageId)])
}
const ids = (pages: { id: string }[]) => pages.map(p => p.id)
const sources = (ws: Workspace, pageId: string) => linkedFrom(ws, pageId).map(e => [e.page.id, e.isParent])
const dayId = (ws: Workspace, date: string) => ws.pages.find(p => p.date === date)!.id

/** Today (2026-10-19) > A > B > C, each made with `/page`, plus a top-level page T. */
function tree() {
  let ws = ok(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-19' })
  const today = dayId(ws, '2026-10-19')
  ws = subpage(ws, today, 'A'); ws = subpage(ws, 'A', 'B'); ws = subpage(ws, 'B', 'C')
  ws = ok(ws, { type: 'create-document', title: 'T', body: '', pageId: 'T' })
  return { ws, today }
}

test('the tree: children in order, breadcrumb root first, subtree at any depth', () => {
  const { ws, today } = tree()
  assert.deepEqual(ids(childPages(ws, null)), ['T'])
  assert.deepEqual(ids(childPages(ws, today)), ['A'])
  assert.deepEqual(ids(childPages(ws, 'B')), ['C'])
  assert.deepEqual(ids(pageAncestors(ws, 'C')), [today, 'A', 'B'])
  assert.deepEqual(pageAncestors(ws, today), [])
  assert.deepEqual([...subtreeIds(ws, 'A')].sort(), ['A', 'B', 'C'])
})

test('N08: a page can not move into itself or its descendants; a day page can not move at all', () => {
  const { ws, today } = tree()
  for (const target of ['A', 'B', 'C']) {
    assert.throws(() => run(ws, { type: 'move-page', pageId: 'A', parentId: target }), /into itself or its subpages/)
  }
  assert.throws(() => run(ws, { type: 'move-page', pageId: today, parentId: 'T' }), /Day pages stay in Days/)
  assert.throws(() => run(ws, { type: 'move-page', pageId: 'T', parentId: 'missing' }), /not found/)
  assert.throws(() => run(ws, { type: 'move-page', pageId: 'missing', parentId: null }), /not found/)
  assert.throws(() => run(ws, { type: 'move-page', pageId: 'B', parentId: 'A' }), /Already there/)
  assert.throws(() => run(ws, { type: 'move-page', pageId: 'T', parentId: null }), /Already there/)
  assert.deepEqual(ids(moveTargets(ws, 'A')).sort(), ['T'], 'not itself, its subpages or its current parent (today)')
  assert.deepEqual(ids(moveTargets(ws, 'C')).sort(), [today, 'A', 'T'].sort())
})

test('N09: moving keeps the id, the body and every reference record; it lands last among the new siblings', () => {
  let { ws, today } = tree()
  ws = ok(ws, { type: 'create-document', title: 'T2', body: '', pageId: 'T2' })
  const before = structuredClone(ws)
  ws = ok(ws, { type: 'move-page', pageId: 'C', parentId: null })
  assert.equal(page(ws, 'C').parentId, undefined)
  assert.deepEqual(ids(childPages(ws, null)), ['T', 'T2', 'C'])
  assert.deepEqual(childPages(ws, 'B'), [])
  // Same page, same body, same cards everywhere: only the tree link changed.
  const strip = (w: Workspace) => w.pages.map(({ parentId: _p, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))
  assert.deepEqual(strip(ws), strip(before))
  assert.deepEqual(ws.tasks, before.tasks); assert.deepEqual(ws.placements, before.placements)
  // B's card to C still resolves to C; B was the parent, and is now an ordinary Linked from source.
  assert.deepEqual(sources(before, 'C'), [['B', true]])
  assert.deepEqual(sources(ws, 'C'), [['B', false]])
  ws = ok(ws, { type: 'move-page', pageId: 'C', parentId: today })
  assert.deepEqual(ids(pageAncestors(ws, 'C')), [today])
  assert.deepEqual(sources(ws, 'C'), [['B', false]], 'a new parent without a card adds no reference')
})

test('moving a page carries its subtree, and Undo puts it back where it was', () => {
  let { ws, today } = tree()
  const before = structuredClone(ws.pages)
  const r = run(ws, { type: 'move-page', pageId: 'B', parentId: 'T' })
  ws = r.workspace
  assert.deepEqual(ids(pageAncestors(ws, 'C')), ['T', 'B'])
  ws = ok(ws, { type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(ws.pages, before)
  assert.deepEqual(ids(pageAncestors(ws, 'C')), [today, 'A', 'B'])
})

test('a replayed move applies once, a stale one is refused, and a refusal writes nothing', () => {
  let { ws } = tree()
  const command = { operationId: 'move-c', expectedRevision: ws.revision, action: { type: 'move-page', pageId: 'C', parentId: 'T' } as Action }
  ws = applyCommand(ws, command).workspace
  const replay = applyCommand(ws, command).workspace
  assert.equal(replay.revision, ws.revision); assert.deepEqual(replay.pages, ws.pages)
  assert.throws(() => applyCommand(ws, { ...command, operationId: 'late', expectedRevision: ws.revision - 1 }), /Saved elsewhere/)
  const frozen = JSON.stringify(ws)
  assert.throws(() => run(ws, { type: 'move-page', pageId: 'A', parentId: 'B' }), /into itself/)
  assert.equal(JSON.stringify(ws), frozen)
})

test('a deep chain with identical titles: identity is the id', () => {
  let ws = createEmptyWorkspace()
  ws = ok(ws, { type: 'create-document', title: 'Same', body: '', pageId: 'p0' })
  for (let i = 1; i < 60; i++) ws = ok(ws, { type: 'create-document', title: 'Same', body: '', pageId: `p${i}`, parentId: `p${i - 1}` })
  assert.equal(pageAncestors(ws, 'p59').length, 59)
  assert.equal(subtreeIds(ws, 'p0').size, 60)
  assert.throws(() => run(ws, { type: 'move-page', pageId: 'p0', parentId: 'p59' }), /into itself/)
  ws = ok(ws, { type: 'move-page', pageId: 'p30', parentId: null })
  assert.deepEqual(ids(pageAncestors(ws, 'p59')), Array.from({ length: 29 }, (_, i) => `p${i + 30}`))
})

test('undoing a card deletion brings the source back into Linked from', () => {
  let { ws } = tree()
  ws = save(ws, 'T', doc => [...doc, card('t1', 'B'), card('t2', 'B')])
  ws = save(ws, 'T', doc => doc.filter(n => n.id !== 't1'))
  assert.deepEqual(sources(ws, 'B'), [['T', false], ['A', true]])
  const r = run(ws, { type: 'save-editor', pageId: 'T', expectedContent: pageContentKey(page(ws, 'T')), document: JSON.stringify(editorSeed(page(ws, 'T'), ws).filter(n => n.id !== 't2')) })
  assert.deepEqual(sources(r.workspace, 'B'), [['A', true]])
  ws = ok(r.workspace, { type: 'undo', targetOperationId: r.receipt.operationId })
  assert.deepEqual(sources(ws, 'B'), [['T', false], ['A', true]])
})

test('a page can move under a day page, and from one day page to another', () => {
  let { ws, today } = tree()
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-18' })
  const yesterday = dayId(ws, '2026-10-18')
  ws = ok(ws, { type: 'move-page', pageId: 'T', parentId: yesterday })
  ws = ok(ws, { type: 'move-page', pageId: 'A', parentId: yesterday })
  assert.deepEqual(ids(childPages(ws, yesterday)), ['T', 'A'])
  assert.deepEqual(childPages(ws, today), [])
})

test('N10: deleting the card leaves the child in the tree; the parent then leaves Linked from', () => {
  let { ws } = tree()
  ws = save(ws, 'A', doc => doc.filter(n => n.id !== 'card:A:B'))
  assert.deepEqual(ids(childPages(ws, 'A')), ['B'])
  assert.deepEqual(sources(ws, 'B'), [])
})

test('N-5: one entry per referencing page, day pages newest first, then document pages newest first', () => {
  let { ws, today } = tree()
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-17' })
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-18' })
  const d17 = dayId(ws, '2026-10-17'), d18 = dayId(ws, '2026-10-18')
  ws = save(ws, d17, doc => [...doc, card('x1', 'C')])
  ws = save(ws, d18, doc => [...doc, card('x2', 'C'), card('x3', 'C')])
  ws = save(ws, 'T', doc => [...doc, card('x4', 'C')])
  ws = save(ws, 'C', doc => [...doc, card('self', 'C')])
  assert.deepEqual(sources(ws, 'C'), [[d18, false], [d17, false], ['T', false], ['B', true]])
  assert.equal(linkedFrom(ws, today).length, 0)
  assert.deepEqual(linkedFrom(ws, 'missing'), [])
})

test('stored data that disagrees with the rules reads safely: a missing parent is top level, a cycle stops the breadcrumb', () => {
  const { ws } = tree()
  const bad = structuredClone(ws)
  page(bad, 'T').parentId = 'gone'
  assert.deepEqual(ids(childPages(bad, null)), ['T'])
  page(bad, 'A').parentId = 'C'
  assert.deepEqual(ids(pageAncestors(bad, 'A')), ['B', 'C'])
  assert.equal(moveRefusal(bad, 'T', 'A'), null)
})

test('the browser command schema accepts move-page with a parent or null and nothing else', () => {
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'move-page', pageId: 'A', parentId: null } }).success)
  assert.ok(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'move-page', pageId: 'A', parentId: 'B' } }).success)
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'move-page', pageId: 'A' } }).success, false)
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 1, action: { type: 'move-page', pageId: 'A', parentId: '' } }).success, false)
})

test('SQLite keeps a move, the new sibling order and its Undo across a reopen; no new column is needed', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'daythread-tree-')), 'w.sqlite')
  const exec = async (action: Action, operationId: string = crypto.randomUUID()) => {
    const repo = new SqliteWorkspaceRepository(path), ws = await repo.load()
    return repo.execute({ operationId, expectedRevision: ws.revision, action })
  }
  await exec({ type: 'create-document', title: 'P', body: '', pageId: 'P' })
  await exec({ type: 'create-document', title: 'Q', body: '', pageId: 'Q' })
  await exec({ type: 'create-document', title: 'R', body: '', pageId: 'R', parentId: 'P' })
  await exec({ type: 'create-document', title: 'S', body: '', pageId: 'S', parentId: 'Q' })
  await exec({ type: 'move-page', pageId: 'S', parentId: 'P' }, 'move-s')
  let ws = await new SqliteWorkspaceRepository(path).load()
  assert.deepEqual(ids(childPages(ws, 'P')), ['R', 'S'])
  assert.deepEqual(ids(ws.pages), ['P', 'Q', 'R', 'S'])
  await exec({ type: 'move-page', pageId: 'R', parentId: null })
  ws = await new SqliteWorkspaceRepository(path).load()
  assert.deepEqual(ids(childPages(ws, null)), ['P', 'Q', 'R'])
  assert.deepEqual(ids(childPages(ws, 'P')), ['S'])
  const last = ws.undo!.operationId
  await exec({ type: 'undo', targetOperationId: last })
  ws = await new SqliteWorkspaceRepository(path).load()
  assert.deepEqual(ids(childPages(ws, 'P')), ['R', 'S'])
  assert.deepEqual(ids(childPages(ws, null)), ['P', 'Q'])
})

test('a page moved under a future day stays in the sidebar Days, before today, with that day as its ancestor', () => {
  let { ws, today } = tree()
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-22' })
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-25' })
  ws = ok(ws, { type: 'ensure-day', date: '2026-09-30' })
  ws = save(ws, dayId(ws, '2026-09-30'), doc => [...doc, { id: 'n', type: 'paragraph', content: [{ type: 'text', text: 'old note', styles: {} }] } as EditorNode])
  const future = dayId(ws, '2026-10-22')
  const listed = (active: string | null) => {
    const { recent, earlier } = sidebarDays(ws, '2026-10-19', active)
    return [recent.map(p => p.date), [...earlier].map(([m, list]) => [m, list.map(p => p.date)])]
  }
  // Future days without subpages are not listed (they open from the Calendar).
  assert.deepEqual(listed(null), [['2026-10-19'], [['2026-09', ['2026-09-30']]]])
  ws = ok(ws, { type: 'move-page', pageId: 'C', parentId: future })
  assert.deepEqual(listed(null), [['2026-10-22', '2026-10-19'], [['2026-09', ['2026-09-30']]]])
  assert.deepEqual(ids(childPages(ws, future)), ['C'])
  assert.deepEqual(ids(pageAncestors(ws, 'C')), [future], 'the sidebar expands this chain when C is open')
  // An empty future day that is open itself is listed while it's open.
  assert.deepEqual(listed(dayId(ws, '2026-10-25'))[0], ['2026-10-25', '2026-10-22', '2026-10-19'])
  // A page two levels under the future day: the day is in its breadcrumb chain, which the sidebar expands.
  ws = ok(ws, { type: 'move-page', pageId: 'C', parentId: 'B' })
  ws = ok(ws, { type: 'move-page', pageId: 'B', parentId: future })
  assert.deepEqual(ids(pageAncestors(ws, 'C')), [future, 'B'])
  assert.deepEqual(listed('C')[0], ['2026-10-22', '2026-10-19'])
  ws = ok(ws, { type: 'move-page', pageId: 'B', parentId: 'A' })
  ws = ok(ws, { type: 'move-page', pageId: 'C', parentId: future })
  // A past day whose only content is a subpage is listed too.
  ws = ok(ws, { type: 'ensure-day', date: '2026-10-12' })
  ws = ok(ws, { type: 'create-document', title: 'Only child', body: '', pageId: 'only', parentId: dayId(ws, '2026-10-12') })
  assert.deepEqual(listed(null)[0], ['2026-10-22', '2026-10-19', '2026-10-12'])
  // Moving the last subpage away takes the future day out again.
  ws = ok(ws, { type: 'move-page', pageId: 'C', parentId: today })
  assert.deepEqual(listed(null)[0], ['2026-10-19', '2026-10-12'])
})
