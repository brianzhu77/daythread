// B21: a synced block's lines live once, in a record; a page's stored row holds only the block (docs/plan/b21-sizing.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { commandSchema } from '../src/domain/command-schema.ts'
import { flatNodes, pageContentKey, pageNodes, type EditorNode } from '../src/domain/editor-document.ts'
import { blockUpdates, expandedWorkspace, homePageOfRecord, storedDocument, strippedWorkspace, syncedBlockType } from '../src/domain/synced.ts'
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
import { buildDayDraftRequest } from '../src/server/model/day-draft.ts'
import { buildSearchIndex } from '../src/domain/search.ts'
import { tagIndex } from '../src/domain/tags.ts'
import { plannedOn } from '../src/domain/workspace.ts'
import { dayId, harness, para, text, todo, today, tomorrow } from './v2-helpers.ts'

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
  const at = '2030-01-01T00:00:00.000Z'
  const r = h.save('c', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [...n.children!, line('l3', 'Third')] } : n), { at })
  assert.deepEqual(lines(h.page('a')).slice(-1), ['Third'])
  assert.deepEqual(lines(h.page('b')).slice(-1), ['Third'])
  assert.equal(h.ws.synced![0]!.rev, 2)
  const { write } = planWrites(before, h.ws)
  // The block's one row, and the page it was edited on for its Edited time (Brian bb1d8ff7), never the other places.
  assert.deepEqual(write.pages.upsert.map(row => row.id).sort(), ['c', 'synced:s1'])
  assert.deepEqual(['a', 'b', 'c'].map(id => h.page(id).editedAt === at), [false, false, true])
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
  h.save('b', d => d.map(n => n.id === 'kept' ? para('kept', text('Kept and edited')) : n))
  assert.deepEqual(lines(h.page('b')), ['Kept and edited', 'Changed'])
  assert.deepEqual(lines(h.page('c')), ['Changed'])
})

test('an edit made on an older revision: the block takes the latest, his version goes right below it, and nothing goes', () => {
  const h = shown()
  h.save('a', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [line('l1', 'Changed')] } : n))
  // B still holds what it read at revision 1: its key says so.
  const was = { rev: 1, key: pageContentKey({ document: JSON.stringify([line('l1', 'First'), line('l2', 'Second')].map(n => ({ ...n, children: [] }))) }) }
  const r = h.save('b', d => d.map(n => n.type === syncedBlockType ? { ...n, props: { ...n.props, ...was }, children: [line('l1:sb', 'Mine')] } : n))
  assert.deepEqual(r.receipt.conflicted, ['sb'])
  assert.deepEqual(lines(h.page('b')), ['Kept', 'Changed', 'Mine'])
  assert.deepEqual(lines(h.page('a')).slice(-1), ['Changed'])
  assert.deepEqual(lines(h.page('c')), ['Changed'], 'it stays on B')
  // The ids of his lines there hold no place separator.
  for (const n of pageNodes(h.page('b'))) if (n.type === 'paragraph') assert.ok(!n.id.includes(':') , n.id)
  // B's own lines there aren't in the block any more.
  assert.equal(blockOf(h.page('b')).children!.length, 1)
  const ids = h.ws.pages.flatMap(p => flatNodes(pageNodes(p)).map(n => n.id))
  assert.equal(new Set(ids).size, ids.length)
})

test('blockUpdates: own save sets the facts; another place\'s edit updates a block he has not changed, and leaves one he has', () => {
  const h = shown()
  const b = () => pageNodes(h.page('b'))
  const held = structuredClone(b())
  h.save('a', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [line('l1', 'Changed')] } : n))
  const follow = blockUpdates(held, h.page('b').document, false)
  assert.equal(follow[0]!.rev, 2)
  assert.deepEqual(follow[0]!.lines!.map(n => n.id), ['l1:sb'])
  const typed = structuredClone(held).map(n => n.type === syncedBlockType ? { ...n, children: [line('l1:sb', 'Typing')] } : n)
  assert.deepEqual(blockUpdates(typed, h.page('b').document, false), [])
  // His own save, with more typed since: the facts move on, the lines stay.
  const own = blockUpdates(typed, h.page('b').document, true)
  assert.equal(own[0]!.rev, 2)
  assert.equal(own[0]!.lines, null)
  // An Undo back to the old lines while the save was on its way: they look untouched, but they're his latest, so they stay and save (Ratchet 0074b95c).
  const sent = JSON.stringify(typed)
  const undone = blockUpdates(held, h.page('b').document, true, sent)
  assert.equal(undone[0]!.lines, null)
  assert.equal(undone[0]!.rev, 2)
  // Another place on the page that went out as it is still follows, whoever saved.
  assert.deepEqual(blockUpdates(held, h.page('b').document, true, JSON.stringify(held))[0]!.lines!.map(n => n.id), ['l1:sb'])
  // It starts from what was saved, so the words typed since still read as his: nothing follows over them (Lead's review of #93).
  const after = structuredClone(typed).map(n => n.type === syncedBlockType ? { ...n, props: { ...n.props, rev: own[0]!.rev, key: own[0]!.key } } : n)
  assert.deepEqual(blockUpdates(after, h.page('b').document, false), [])
  // A new line typed on a copy takes this place's id once the save is back.
  const r = h.save('b', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [...n.children!, line('n9', 'New here')] } : n))
  assert.equal(r.receipt.conflicted, undefined)
  const mine = structuredClone(b()).map(n => n.type === syncedBlockType ? { ...n, children: n.children!.map(c => c.id === 'n9:sb' ? { ...c, id: 'n9' } : c) } : n)
  assert.deepEqual(blockUpdates(mine, h.page('b').document, true)[0]!.rename, { n9: 'n9:sb' })
  assert.deepEqual(blockUpdates(b(), h.page('b').document, false), [])
})

test('two places on one page changed differently in one save: the first is the edit, and the other goes below, so no words go', () => {
  const h = shown()
  h.save('b', d => [...d, block('sb2', 's1')])
  const r = h.save('b', d => d.map(n => n.id === 'sb' ? { ...n, children: [line('l1:sb', 'First words')] } : n.id === 'sb2' ? { ...n, children: [line('l1:sb2', 'Second words')] } : n))
  assert.deepEqual(r.receipt.conflicted, ['sb2'])
  assert.deepEqual(lines(h.page('c')), ['First words'])
  assert.deepEqual(lines(h.page('b')), ['Kept', 'First words', 'First words', 'Second words'])
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

test('a block whose record is missing stays as it is: no save removes it or makes an empty record', () => {
  const h = shown()
  const before = h.ws.synced!.length
  h.save('b', d => [...d, block('sx', 'gone')])
  assert.ok(pageNodes(h.page('b')).some(n => n.id === 'sx'))
  assert.equal(h.ws.synced!.length, before)
  h.save('b', d => d)
  assert.ok(pageNodes(h.page('b')).some(n => n.id === 'sx'))
})

test('Unsync here: that place keeps its lines as ordinary lines, the others stay synced, one Undo', () => {
  const h = shown()
  const r = h.run({ type: 'unsync-block', pageId: 'b', blockId: 'sb' })
  assert.equal(r.receipt.message, 'Unsynced here')
  assert.ok(!pageNodes(h.page('b')).some(n => n.type === syncedBlockType))
  assert.deepEqual(lines(h.page('b')), ['Kept', 'First', 'Second'])
  h.save('a', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [line('l1', 'Changed')] } : n))
  assert.deepEqual(lines(h.page('c')), ['Changed'])
  assert.deepEqual(lines(h.page('b')), ['Kept', 'First', 'Second'], 'no longer follows')
})

test('Unsync all on the original: every page keeps its lines, the record goes, one Undo restores every place', () => {
  const h = shown()
  assert.throws(() => h.run({ type: 'unsync-block', pageId: 'b', blockId: 'sb', all: true }), /Only the original/)
  const r = h.run({ type: 'unsync-block', pageId: 'a', blockId: 'sa', all: true })
  assert.equal(r.receipt.message, 'Unsynced on 3 pages')
  for (const id of ['a', 'b', 'c']) { assert.ok(!pageNodes(h.page(id)).some(n => n.type === syncedBlockType)); assert.ok(lines(h.page(id)).includes('First')) }
  assert.equal(h.ws.synced, undefined)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  assert.equal(h.ws.synced!.length, 1)
  for (const id of ['a', 'b', 'c']) assert.ok(pageNodes(h.page(id)).some(n => n.type === syncedBlockType))
  assert.deepEqual(blockOf(h.page('a')).children!.map(n => n.id), ['l1', 'l2'], 'line ids as they were')
})

test('deleting a copy leaves the others; deleting the original ends the syncing, each keeping its lines; Undo restores', () => {
  const h = shown()
  const copy = h.run({ type: 'delete-synced-place', pageId: 'c', blockId: 'sc' })
  assert.equal(copy.receipt.message, 'Removed from this page · still on 2 pages')
  assert.deepEqual(lines(h.page('c')), [])
  assert.deepEqual(lines(h.page('b')), ['Kept', 'First', 'Second'])
  h.run({ type: 'undo', targetOperationId: copy.receipt.operationId })
  assert.deepEqual(lines(h.page('c')), ['First', 'Second'])
  const original = h.run({ type: 'delete-synced-place', pageId: 'a', blockId: 'sa' })
  assert.equal(original.receipt.message, 'Removed · the other 2 pages keep their lines, no longer synced')
  assert.deepEqual(lines(h.page('a')), ['Before'])
  assert.deepEqual(lines(h.page('b')), ['Kept', 'First', 'Second'])
  assert.ok(!pageNodes(h.page('b')).some(n => n.type === syncedBlockType))
  assert.equal(h.ws.synced, undefined, 'no place left: the record goes')
  h.run({ type: 'undo', targetOperationId: original.receipt.operationId })
  assert.equal(h.ws.synced!.length, 1)
  assert.deepEqual(lines(h.page('a')), ['Before', 'First', 'Second'])
})

test('Trash: a place in Trash holds the record; the others stay synced; restored it reads the latest; with its original deleted it comes back as ordinary lines', () => {
  const h = shown()
  h.run({ type: 'delete-page', pageId: 'a', at: '2026-10-22T18:00:00.000Z' })
  assert.equal(h.ws.synced!.length, 1)
  h.save('b', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [line('l1:sb', 'Changed')] } : n))
  assert.deepEqual(lines(h.page('c')), ['Changed'])
  h.run({ type: 'restore-page', pageId: 'a' })
  assert.deepEqual(lines(h.page('a')), ['Before', 'Changed'])
  // A copy in Trash while the original goes: it keeps the last shared lines.
  h.run({ type: 'delete-page', pageId: 'c', at: '2026-10-22T18:00:00.000Z' })
  h.run({ type: 'delete-synced-place', pageId: 'a', blockId: 'sa' })
  h.run({ type: 'restore-page', pageId: 'c' })
  assert.deepEqual(lines(h.page('c')), ['Changed'])
  assert.ok(!pageNodes(h.page('c')).some(n => n.type === syncedBlockType))
})

test('a block removed by a save, with no place left, takes its record with it; a to-do in a block is one task through it all', () => {
  const h = harness()
  h.day(today)
  const day = `day:${today}`
  h.run({ type: 'create-document', title: 'B', body: '', pageId: 'b' })
  h.save(day, d => [...d, block('sa', 's1', [todo('r1', 'Book the flights')])])
  h.save('b', d => [...d, block('sb', 's1')])
  const count = () => h.ws.tasks.filter(t => t.title === 'Book the flights').length
  assert.equal(count(), 1)
  const r = h.run({ type: 'unsync-block', pageId: day, blockId: 'sa', all: true })
  assert.equal(count(), 1)
  h.run({ type: 'undo', targetOperationId: r.receipt.operationId })
  h.save('b', d => d.filter(n => n.type !== syncedBlockType))
  assert.equal(count(), 1)
  h.save(day, d => d.filter(n => n.type !== syncedBlockType))
  assert.equal(h.ws.synced, undefined)
})

test('the new commands pass the schema', () => {
  for (const action of [{ type: 'unsync-block', pageId: 'p', blockId: 'b' }, { type: 'unsync-block', pageId: 'p', blockId: 'b', all: true }, { type: 'delete-synced-place', pageId: 'p', blockId: 'b' }]) {
    assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action }).success, true, action.type)
  }
})

test('planning: a row in a block is per place. Planned elsewhere, Not today, carried: the line stays on every page', () => {
  const h = harness()
  h.day(today)
  const day = dayId(today), next = dayId(tomorrow)
  h.run({ type: 'create-document', title: 'B', body: '', pageId: 'b' })
  h.save(day, d => [...d, block('sa', 's1', [todo('r1', 'Book the flights')])])
  h.save('b', d => [...d, block('sb', 's1')])
  const task = h.task('Book the flights').id
  const row = (id: string) => flatNodes(pageNodes(h.page(id))).find(n => n.props?.taskId === task)
  const words = () => JSON.parse(h.ws.synced![0]!.lines)
  // Moved to tomorrow: today's line stays, as a reference; tomorrow has its plan row; nothing else changed.
  h.run({ type: 'plan-task', taskId: task, date: tomorrow, from: today, today })
  assert.equal(row(day)!.props?.role, 'reference')
  assert.equal(row(next)!.props?.role, 'plan')
  assert.equal(row('b')!.props?.role, 'reference')
  assert.equal(words().length, 1)
  assert.equal(h.ws.tasks.filter(t => t.id === task).length, 1)
  assert.equal(plannedOn(h.ws, task), tomorrow)
  // Planned back on today, in the block: only that place's row.
  h.run({ type: 'plan-task', taskId: task, date: today, from: tomorrow, today })
  assert.equal(row(day)!.props?.role, 'plan')
  assert.equal(row('b')!.props?.role, 'reference')
  // Not today: the row leaves the plan, not the block.
  h.run({ type: 'not-today', taskId: task, date: today })
  assert.ok(row(day), 'the line stays')
  assert.equal(row(day)!.props?.role, 'reference')
  assert.ok(row('b'))
  assert.equal(words().length, 1)
})

test('templates: made on the template each page gets its own; a copy pasted into it stays connected, one note on every new day', () => {
  const h = harness()
  h.day(today)
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
  h.save('notes', d => [...d, block('home', 'shared', [line('n1', 'One note')])])
  h.save('tpl', () => [para('t1', text('Plain')), block('own', 'tplsync', [line('o1', 'Made here')]), block('copy', 'shared')])
  const first = h.day(tomorrow), other = h.day('2026-10-24')
  const blocks = (p: Page) => pageNodes(p).filter(n => n.type === syncedBlockType)
  assert.equal(blocks(first).length, 2)
  const syncIds = (p: Page) => blocks(p).map(n => n.props?.syncId)
  assert.notEqual(syncIds(first)[0], 'tplsync', 'its own')
  assert.notEqual(syncIds(first)[0], syncIds(other)[0], 'connected to nothing')
  assert.equal(syncIds(first)[1], 'shared')
  assert.equal(syncIds(other)[1], 'shared')
  h.save('notes', d => d.map(n => n.type === syncedBlockType ? { ...n, children: [line('n1', 'One note, edited')] } : n))
  assert.ok(lines(h.page(dayId(tomorrow))).includes('One note, edited'))
  assert.ok(lines(h.page('tpl')).includes('One note, edited'))
  // An edit in one day's own block stays there.
  const ownId = blocks(first)[0]!.id
  h.save(dayId(tomorrow), d => d.map(n => n.id === ownId ? { ...n, children: [line('x1', 'Only tomorrow')] } : n))
  assert.ok(!lines(h.page(dayId('2026-10-24'))).includes('Only tomorrow'))
  assert.ok(lines(h.page(dayId('2026-10-24'))).includes('Made here'))
})

test('a duplicated row: a connected block stays connected, an original gets its own', () => {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'DB' })
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'row', title: 'Row', at: '2026-10-22T18:00:00.000Z' })
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
  h.save('notes', d => [...d, block('home', 'shared', [line('n1', 'One note')])])
  h.save('row', () => [block('own', 'rowsync', [line('o1', 'Own')]), block('copy', 'shared')])
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'dup', copyOf: 'row', title: '', at: '2026-10-22T18:00:00.000Z' })
  const ids = pageNodes(h.page('dup')).map(n => n.props?.syncId)
  assert.notEqual(ids[0], 'rowsync')
  assert.equal(ids[1], 'shared')
  assert.ok(lines(h.page('dup')).includes('One note'))
})

test('once: Tags and Search count a block once, under the original or its earliest day; the draft sees it on its day, with no anchor in it', () => {
  const h = harness()
  h.day(today); h.day(tomorrow)
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
  h.save('notes', d => [...d, block('home', 'shared', [line('n1', 'A note #idea')])])
  h.save(dayId(tomorrow), d => [...d, block('copy1', 'shared')])
  h.save(dayId(today), d => [...d, block('copy2', 'shared'), block('copy3', 'shared')])
  const tag = tagIndex(h.ws).find(t => t.key === 'idea')!
  assert.equal(tag.occurrences.length, 1)
  assert.equal(tag.occurrences[0]!.date, today, 'under its earliest day')
  const index = buildSearchIndex(h.ws)
  const hits = index.lines.filter(l => l.text.includes('A note'))
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.page.id, 'notes')
  assert.equal(hits[0]!.places, 3)
  // Original in Trash: under the oldest live place.
  h.run({ type: 'delete-page', pageId: 'notes', at: '2026-10-22T18:00:00.000Z' })
  assert.equal(buildSearchIndex(h.ws).lines.filter(l => l.text.includes('A note')).length, 1)
  const request = buildDayDraftRequest(h.ws, h.page(dayId(today)))
  assert.equal(JSON.stringify(request.messages).match(/A note/g)!.length, 1, 'once, though shown twice on the day')
  // And once when yesterday showed it too.
  assert.equal(JSON.stringify(buildDayDraftRequest(h.ws, h.page(dayId(tomorrow))).messages).match(/A note/g)!.length, 1)
  assert.ok(![...request.blocks.values()].some(n => n.type === syncedBlockType))
})

test('with no block nothing changes: the same objects, the same key', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'A', body: '', pageId: 'a' })
  assert.equal(expandedWorkspace(h.ws), h.ws)
  assert.equal(strippedWorkspace(h.ws), h.ws)
  assert.equal(storedDocument(h.page('a').document), h.page('a').document)
  assert.equal(h.ws.synced, undefined)
})

// B21-11: what can go inside.
const databaseLine = (id: string, pageId: string) => ({ id, type: 'database', props: { pageId, view: '' }, children: [] }) as unknown as EditorNode
function withDatabase() {
  const h = harness()
  for (const [id, title] of [['a', 'A'], ['b', 'B']] as const) h.run({ type: 'create-document', title, body: '', pageId: id })
  h.run({ type: 'create-database', pageId: 'db', parentId: 'a', homeBlockId: 'home', title: 'Books' })
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'r1', title: 'One', values: {}, at: '2026-11-05T00:00:00.000Z' } as never)
  h.save('a', () => [line('above', 'Above'), block('sa', 's1', [line('l1', 'Shared'), databaseLine('home', 'db')])])
  h.save('b', () => [block('sb', 's1')])
  return h
}
const holder = (h: ReturnType<typeof harness>, id: string) => h.page('db').database!.homeBlockId === id
test('a database inside: home on the original under its own id, a view of the same rows everywhere else (B21-11)', () => {
  const h = withDatabase()
  assert.equal(holder(h, 'home'), true)
  const copy = flatNodes(pageNodes(h.page('b'))).find(n => n.type === 'database')!
  assert.notEqual(copy.id, 'home', 'so the copy is a view')
  assert.equal(copy.props?.pageId, 'db')
  assert.equal(h.page('r1').trashedAt ?? null, null)
})
test('deleting a copy of the block never trashes the database; deleting its line from a copy leaves the database as a full page, rows and all (B21-11)', () => {
  const h = withDatabase()
  const lineGone = (nodes: EditorNode[]) => nodes.map(n => n.type === syncedBlockType ? { ...n, children: n.children!.filter(c => c.type !== 'database') } : n)
  h.save('b', lineGone)
  assert.equal(flatNodes(pageNodes(h.page('a'))).some(n => n.type === 'database'), false, 'shared lines, so it left the original too')
  assert.equal(h.page('db').trashedAt ?? null, null)
  assert.equal(h.page('r1').trashedAt ?? null, null)
  assert.equal(h.page('db').database!.homeBlockId, null)
  assert.equal(h.page('db').parentId, 'a')
})
test('deleting the home line on the original follows the usual rule: it goes to Trash (B21-11)', () => {
  const h = withDatabase()
  h.save('a', nodes => nodes.map(n => n.type === syncedBlockType ? { ...n, children: n.children!.filter(c => c.type !== 'database') } : n))
  assert.ok(h.page('db').trashedAt)
})
test('moving the home line out of the block on the original keeps it the home (B21-11)', () => {
  const h = withDatabase()
  h.save('a', nodes => [...nodes.map(n => n.type === syncedBlockType ? { ...n, children: n.children!.filter(c => c.type !== 'database') } : n), databaseLine('home', 'db')])
  assert.equal(holder(h, 'home'), true)
  assert.equal(h.page('db').trashedAt ?? null, null)
})
test('deleting the original: the database stays as a full page, and the other places keep a view of it (B21-11)', () => {
  const h = withDatabase()
  const gone = h.run({ type: 'delete-synced-place', pageId: 'a', blockId: 'sa' })
  assert.equal(h.page('db').trashedAt ?? null, null)
  assert.equal(h.page('db').database!.homeBlockId, null)
  assert.equal(flatNodes(pageNodes(h.page('b'))).find(n => n.type === 'database')?.props?.pageId, 'db')
  h.run({ type: 'undo', targetOperationId: gone.receipt.operationId })
  assert.equal(holder(h, 'home'), true, 'Undo on the notice puts it all back, the home with it')
})
test('a page\'s Undo of the line taken from a copy brings it back as a view; the rows were never touched (B21-11)', () => {
  const h = withDatabase()
  const before = pageNodes(h.page('b'))
  h.save('b', nodes => nodes.map(n => n.type === syncedBlockType ? { ...n, children: n.children!.filter(c => c.type !== 'database') } : n))
  h.save('b', () => before.map(n => ({ ...n, props: { ...n.props, rev: h.ws.synced![0]!.rev, key: blockOf(h.page('b')).props!.key } })))
  assert.equal(h.page('db').database!.homeBlockId, null)
  assert.equal(flatNodes(pageNodes(h.page('a'))).find(n => n.type === 'database')?.props?.pageId, 'db', 'on the original, as a view')
  assert.equal(h.page('r1').trashedAt ?? null, null)
})
test('deleting a copy place leaves the home alone (B21-11)', () => {
  const h = withDatabase()
  h.run({ type: 'delete-synced-place', pageId: 'b', blockId: 'sb' })
  assert.equal(holder(h, 'home'), true)
})
test('what\'s made in a copy lives on the original\'s page; a page in Trash can\'t be a home (B21-11)', () => {
  const h = withDatabase()
  assert.equal(homePageOfRecord(h.ws, 's1')?.id, 'a')
  h.run({ type: 'delete-page', pageId: 'a', at: '2026-11-05T00:00:00.000Z' })
  assert.equal(homePageOfRecord(h.ws, 's1'), undefined)
})
test('a database made inside a copy: its home line reaches the original and it isn\'t trashed by saving either page (B21-11)', () => {
  const h = withDatabase()
  h.run({ type: 'create-database', pageId: 'db2', parentId: 'a', homeBlockId: 'made', title: 'New' })
  h.save('b', nodes => nodes.map(n => n.type === syncedBlockType ? { ...n, children: [...n.children!, databaseLine('made', 'db2')] } : n))
  assert.ok(flatNodes(pageNodes(h.page('a'))).some(n => n.id === 'made'), 'plain id on the original')
  assert.equal(flatNodes(pageNodes(h.page('b'))).some(n => n.id === 'made'), false, 'its own id on the copy')
  h.save('a', nodes => nodes)
  h.save('b', nodes => nodes)
  assert.equal(h.page('db2').trashedAt ?? null, null)
  assert.equal(h.page('db2').database!.homeBlockId, 'made')
})

