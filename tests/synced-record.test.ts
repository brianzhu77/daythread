// B21: a synced block's lines live once, in a record; a page's stored row holds only the block (docs/plan/b21-sizing.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { flatNodes, pageContentKey, pageNodes, type EditorNode } from '../src/domain/editor-document.ts'
import { expandedWorkspace, storedDocument, strippedWorkspace, syncedBlockType } from '../src/domain/synced.ts'
import { applyChanges, changesBetween } from '../src/domain/workspace-changes.ts'
import { applyCommand } from '../src/domain/workspace.ts'
import { planWrites, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import type { Page } from '../src/domain/types.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { harness, para, text, todo, today } from './v2-helpers.ts'

const block = (id: string, syncId: string, children: EditorNode[] = []): EditorNode => ({ id, type: syncedBlockType, props: { syncId, roles: '' }, children })
const line = (id: string, words: string) => para(id, text(words))
function shown() {
  const h = harness()
  for (const [id, title] of [['a', 'A'], ['b', 'B'], ['c', 'C']] as const) h.run({ type: 'create-document', title, body: '', pageId: id })
  h.save('a', d => [...d, para('before', text('Before')), block('sa', 's1', [line('l1', 'First'), line('l2', 'Second')])])
  h.save('b', d => [...d, para('kept', text('Kept')), block('sb', 's1')])
  h.save('c', d => [...d, block('sc', 's1')])
  return h
}
const lines = (p: Pick<Page, 'document'>) => flatNodes(pageNodes(p)).filter(n => n.type === 'paragraph').map(n => (n.content as { text?: string }[] | undefined)?.[0]?.text ?? '').filter(Boolean)
const blockOf = (p: Pick<Page, 'document'>) => pageNodes(p).find(n => n.type === syncedBlockType)!
const words = ['First', 'Second', 'Third', 'Changed']
/** No page's stored document may hold a block's lines. */
const assertStripped = (document: string) => { for (const w of words) assert.ok(!document.includes(w), `a stored page holds "${w}"`) }

test('every place reads the lines in memory; the record holds them once, and the original keeps its line ids', () => {
  const h = shown()
  assert.deepEqual(lines(h.page('b')).slice(-2), ['First', 'Second'])
  assert.deepEqual(lines(h.page('c')), ['First', 'Second'])
  assert.equal(h.ws.synced!.length, 1)
  assert.deepEqual(blockOf(h.page('a')).children!.map(n => n.id), ['l1', 'l2'])
  assert.deepEqual(blockOf(h.page('b')).children!.map(n => n.id), ['l1:sb', 'l2:sb'])
  // Every line id in the workspace is unique, so anything that looks a line up by id finds one.
  const ids = h.ws.pages.flatMap(p => flatNodes(pageNodes(p)).map(n => n.id))
  assert.equal(new Set(ids).size, ids.length)
})

test('an edit in any place reaches them all, in one command with one Undo, and writes one row', () => {
  const h = shown()
  const before = rowsOf(h.ws)
  const was = h.page('b').document
  const r = h.save('c', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [...n.children!, line('l3', 'Third')] } : n))
  assert.deepEqual(lines(h.page('a')).slice(-1), ['Third'])
  assert.deepEqual(lines(h.page('b')).slice(-1), ['Third'])
  assert.equal(h.ws.synced![0]!.rev, 2)
  const { write } = planWrites(before, h.ws)
  assert.deepEqual(write.pages.upsert.map(row => row.id), ['synced:s1'])
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(h.page('b').document, was)
})

test('stored rows never hold a block\'s lines: the row diff, rows for a first import, Undo\'s inverse', () => {
  const h = shown()
  const check = (rows: ReturnType<typeof rowsOf>['pages']) => { for (const row of rows) if (row.type !== 'synced') assertStripped(row.document) }
  check(rowsOf(h.ws).pages)
  const before = rowsOf(h.ws)
  h.save('b', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [line('l1:sb', 'Changed')] } : n))
  const { write, inverse, rows } = planWrites(before, h.ws)
  check(write.pages.upsert); check(inverse.pages.upsert); check(rows.pages)
  // What loads from them is expanded again.
  assert.deepEqual(lines(workspaceOf(rows).pages.find(p => p.id === 'c')!), ['Changed'])
})

test('Postgres: rows on disk hold no lines, one row is written, and a fresh load reads every place', async () => {
  const db = await PGlite.create()
  try {
    const repo = new PostgresWorkspaceRepository(pgliteClient(db))
    let ws = await repo.load()
    const run = async (action: Parameters<typeof applyCommand>[1]['action']) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }); ws = r.workspace; return r }
    await run({ type: 'create-document', title: 'A', body: '', pageId: 'a' })
    await run({ type: 'create-document', title: 'B', body: '', pageId: 'b' })
    const page = (id: string) => ws.pages.find(p => p.id === id)!
    await run({ type: 'save-editor', pageId: 'a', expectedContent: pageContentKey(page('a')), document: JSON.stringify([block('sa', 's1', [line('l1', 'First')])]) })
    await run({ type: 'save-editor', pageId: 'b', expectedContent: pageContentKey(page('b')), document: JSON.stringify([block('sb', 's1')]) })
    const raw = async () => (await db.query<{ id: string; type: string; document: string }>(`select id, type, document from daythread.pages`)).rows
    for (const row of await raw()) if (row.type !== 'synced') assertStripped(row.document)
    assert.equal((await raw()).filter(row => row.type === 'synced').length, 1)
    assert.deepEqual(lines((await new PostgresWorkspaceRepository(pgliteClient(db)).load()).pages.find(p => p.id === 'b')!), ['First'])
    // An edit from the other place, with Undo.
    const r = await run({ type: 'save-editor', pageId: 'b', expectedContent: pageContentKey(page('b')), document: JSON.stringify(pageNodes(page('b')).map(n => ({ ...n, children: [line('l1:sb', 'Changed')] }))) })
    for (const row of await raw()) if (row.type !== 'synced') assertStripped(row.document)
    assert.deepEqual(lines((await new PostgresWorkspaceRepository(pgliteClient(db)).load()).pages.find(p => p.id === 'a')!), ['Changed'])
    await run({ type: 'undo', targetOperationId: r.receipt.operationId })
    assert.deepEqual(lines((await new PostgresWorkspaceRepository(pgliteClient(db)).load()).pages.find(p => p.id === 'a')!), ['First'])
  } finally { await db.close() }
})

test('SQLite: the stored file holds no lines in any page, nor in Undo\'s copy, and a fresh load reads every place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'synced-'))
  try {
    const path = join(dir, 'ws.sqlite')
    const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
    let ws = await repo.load()
    const run = async (action: Parameters<typeof applyCommand>[1]['action']) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }); ws = r.workspace; return r }
    await run({ type: 'create-document', title: 'A', body: '', pageId: 'a' })
    await run({ type: 'create-document', title: 'B', body: '', pageId: 'b' })
    const page = (id: string) => ws.pages.find(p => p.id === id)!
    await run({ type: 'save-editor', pageId: 'a', expectedContent: pageContentKey(page('a')), document: JSON.stringify([block('sa', 's1', [line('l1', 'First')])]) })
    await run({ type: 'save-editor', pageId: 'b', expectedContent: pageContentKey(page('b')), document: JSON.stringify([block('sb', 's1')]) })
    await run({ type: 'rename-page', pageId: 'b', title: 'B2' })
    const raw = () => { const db = new DatabaseSync(path); const { data } = db.prepare('select data from workspace').get() as { data: string }; db.close(); return JSON.parse(data) as { pages: Page[]; undo?: { before?: { pages: Page[] } } } }
    const stored = raw()
    for (const p of [...stored.pages, ...(stored.undo?.before?.pages ?? [])]) assertStripped(p.document)
    assert.deepEqual(lines((await new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true }).load()).pages.find(p => p.id === 'b')!), ['First'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a page\'s content key means one thing: stored or expanded, here or loaded, and another place\'s edit does not move it', () => {
  const h = shown()
  const b = h.page('b')
  assert.equal(pageContentKey(b), pageContentKey({ document: storedDocument(b.document) }))
  assert.equal(pageContentKey(b), pageContentKey(workspaceOf(rowsOf(h.ws)).pages.find(p => p.id === 'b')!))
  // The browser's preview and the server's reply agree (B81's `sent.base`).
  const action = { type: 'save-editor' as const, pageId: 'b', expectedContent: pageContentKey(b), document: b.document }
  const preview = applyCommand(h.ws, { operationId: 'p', expectedRevision: h.ws.revision, action }).workspace
  const served = workspaceOf(planWrites(rowsOf(h.ws), preview).rows)
  assert.equal(pageContentKey(preview.pages.find(p => p.id === 'b')!), pageContentKey(served.pages.find(p => p.id === 'b')!))
  const key = pageContentKey(b)
  h.save('a', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [line('l1', 'Changed')] } : n))
  assert.equal(pageContentKey(h.page('b')), key, 'B can still save what it has')
  // And B's own save, with a block on the older lines he didn't touch, takes the latest.
  h.save('b', d => d.map(n => n.id === 'kept' ? para('kept', text('Kept and edited')) : n.type === syncedBlockType ? { ...n, props: { ...n.props, rev: 1 } } : n))
  assert.deepEqual(lines(h.page('b')), ['Kept and edited', 'Changed'])
  assert.deepEqual(lines(h.page('c')), ['Changed'])
})

test('an edit made on an older revision is refused, so nothing typed is lost', () => {
  const h = shown()
  h.save('a', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [line('l1', 'Changed')] } : n))
  assert.throws(() => h.save('b', d => d.map(n => n.type === syncedBlockType ? { ...n, props: { ...n.props, rev: 1, edited: true }, children: [line('l1:sb', 'Mine')] } : n)), /changed elsewhere/)
})

test('the reply to the browser carries the record and no lines, and applying it gives the same workspace', () => {
  const h = shown()
  const before = h.ws
  h.save('c', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [line('l1', 'Changed')] } : n))
  const changes = changesBetween(before, h.ws)
  assert.deepEqual(changes.pages.upsert, [])
  assert.equal(changes.synced!.length, 1)
  const applied = applyChanges(before, changes)!
  for (const id of ['a', 'b', 'c']) assert.deepEqual(lines(applied.pages.find(p => p.id === id)!), lines(h.page(id)))
  // A whole workspace travels without lines too.
  for (const p of strippedWorkspace(h.ws).pages) assertStripped(p.document)
  assert.deepEqual(lines(expandedWorkspace(strippedWorkspace(h.ws)).pages.find(p => p.id === 'b')!).slice(-1), ['Changed'])
})

test('a to-do row in a block has its role per place, and a rename reaches every place', () => {
  const h = harness()
  h.day(today)
  const dayPage = `day:${today}`
  h.run({ type: 'create-document', title: 'B', body: '', pageId: 'b' })
  h.save(dayPage, d => [...d, block('sa', 's1', [todo('r1', 'Book the flights')])])
  h.save('b', d => [...d, block('sb', 's1')])
  const task = h.task('Book the flights').id
  const row = (id: string) => flatNodes(pageNodes(h.page(id))).find(n => n.props?.taskId === task)!
  assert.equal(row(dayPage).props?.role, 'plan')
  assert.equal(row('b').props?.role, 'reference')
  assert.equal(row('b').props?.taskId, task)
  assert.equal(h.ws.tasks.filter(t => t.title === 'Book the flights').length, 1)
  h.run({ type: 'rename-task', taskId: task, title: 'New words' })
  assert.match(JSON.stringify(row('b').content), /New words/)
  assert.match(JSON.stringify(row(dayPage).content), /New words/)
  assert.equal(row('b').props?.role, 'reference')
  assert.equal(row(dayPage).props?.role, 'plan')
})

test('with no block nothing changes: the same objects, the same key', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'A', body: '', pageId: 'a' })
  assert.equal(expandedWorkspace(h.ws), h.ws)
  assert.equal(strippedWorkspace(h.ws), h.ws)
  assert.equal(storedDocument(h.page('a').document), h.page('a').document)
  assert.equal(h.ws.synced, undefined)
})
