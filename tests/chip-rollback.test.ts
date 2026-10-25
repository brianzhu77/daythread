import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PGlite } from '@electric-sql/pglite'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { chipsAsText, chipsAsTextPostgres, chipsAsTextSqlite, documentAsText } from '../src/server/chip-rollback.ts'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B27 rollback (Lead dee40862): a build from before B27 can't open a page holding a `dateMention`; the rollback turns
// every chip into its stored text, so that build opens every page with the words intact.
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const chip = (eventId: string, date: string, time = '') => ({ type: 'dateMention', props: { eventId, date, time } })
const line = (id: string, content: unknown[], children: EditorNode[] = []) => ({ id, type: 'bulletListItem', props: {}, content, children }) as unknown as EditorNode
const lines = () => [
  line('pac', [text('PAC Lunch '), chip('e1', '2026-11-20', '12:00'), text(' at school')]),
  line('jan', [text('Dentist '), chip('e2', '2027-01-05')], [line('nested', [chip('e3', '2026-10-23', '09:30')])]),
]
/** Every stored line's words, by block id, as the editor would read them back. */
const words = (ws: Workspace) => {
  const page = ws.pages.find(p => p.date === '2026-10-22')!
  const flat = (l: EditorNode[]): EditorNode[] => l.flatMap(n => [n, ...flat(n.children ?? [])])
  return Object.fromEntries(flat(editorSeed(page, ws)).filter(n => ['pac', 'jan', 'nested'].includes(n.id)).map(n => [n.id, (n.content as { type: string; text?: string }[]).map(c => (assert.equal(c.type, 'text'), c.text)).join('')]))
}
const expected = { pac: 'PAC Lunch @Nov 20 12pm at school', jan: 'Dentist @Jan 5, 2027', nested: '@Oct 23 9:30am' }
async function withChips(run: (action: Action) => Promise<Workspace>) {
  let ws = await run({ type: 'ensure-day', date: '2026-10-22' })
  const page = ws.pages.find(p => p.date === '2026-10-22')!
  ws = await run({ type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify([...editorSeed(page, ws), ...lines()]) })
  return ws
}

test('the domain rewrite: every chip becomes its stored text and Undo is cleared; a second run finds nothing', async () => {
  let ws = createEmptyWorkspace()
  ws = await withChips(async action => (ws = applyCommand(ws, { operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }).workspace))
  ws.undo = { operationId: 'u', revision: ws.revision, before: structuredClone(ws) } as Workspace['undo']
  const blocks = JSON.stringify(ws.pages.flatMap(p => p.sections))
  assert.deepEqual(chipsAsText(ws), { chips: 3, undoCleared: true })
  assert.equal(ws.undo, undefined)
  assert.equal(JSON.stringify(ws).includes('dateMention'), false)
  assert.deepEqual(words(ws), expected)
  assert.equal(JSON.stringify(ws.pages.flatMap(p => p.sections)), blocks, 'blocks, ids and stored text unchanged')
  assert.deepEqual(chipsAsText(ws), { chips: 0, undoCleared: false })
})

test('a page in the trash is converted too, so restoring it opens', async () => {
  let ws = applyCommand(createEmptyWorkspace(), { operationId: 'd', expectedRevision: 0, action: { type: 'create-document', title: 'Trip', body: '', pageId: 'doc' } }).workspace
  const page = ws.pages.find(p => p.id === 'doc')!
  ws = applyCommand(ws, { operationId: 's', expectedRevision: ws.revision, action: { type: 'save-editor', pageId: 'doc', expectedContent: pageContentKey(page), document: JSON.stringify([...editorSeed(page, ws), line('f', [text('Flight '), chip('e9', '2026-12-01', '08:15')])]) } }).workspace
  ws = applyCommand(ws, { operationId: 't', expectedRevision: ws.revision, action: { type: 'delete-page', pageId: 'doc', at: '2026-10-25T00:00:00Z' } }).workspace
  assert.equal(chipsAsText(ws).chips, 1)
  assert.equal(JSON.stringify(ws).includes('dateMention'), false)
  assert.ok(ws.pages.find(p => p.id === 'doc')!.editorJSON!.includes('"text":"@Dec 1, 2026 8:15am"'))
})

test('a malformed chip keeps the date it holds; a document with no chips is left as the same string', () => {
  const doc = JSON.stringify([line('x', [text('A '), { type: 'dateMention', props: { eventId: 'e', date: '2026-02-30' } }])])
  const out = documentAsText(doc, '2026-10-22')
  assert.equal(out.chips, 1)
  assert.equal(JSON.parse(out.json!)[0].content[1].text, '@2026-02-30')
  const plain = JSON.stringify([line('y', [text('plain')])])
  assert.equal(documentAsText(plain, null).json, plain)
})

test('SQLite: the rollback rewrites the stored pages; the store reloads with text, and a second run changes nothing', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'daythread-b27-rollback-')), 'workspace.sqlite')
  const repo = new SqliteWorkspaceRepository(path)
  await withChips(async action => { const { revision } = await repo.load(); return (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: revision, action })).workspace })
  const revision = (await repo.load()).revision
  const db = new DatabaseSync(path)
  assert.equal(chipsAsTextSqlite(db, true).chips, 3, 'a dry run counts')
  assert.ok(JSON.stringify(await repo.load()).includes('dateMention'), 'and changes nothing')
  db.exec('BEGIN IMMEDIATE'); assert.equal(chipsAsTextSqlite(db).chips, 3); db.exec('COMMIT')
  db.exec('BEGIN IMMEDIATE'); assert.deepEqual(chipsAsTextSqlite(db), { chips: 0, undoCleared: false }); db.exec('COMMIT')
  db.close()
  const after = await new SqliteWorkspaceRepository(path).load()
  assert.equal(JSON.stringify(after).includes('dateMention'), false)
  assert.equal(after.revision, revision)
  assert.deepEqual(words(after), expected)
})

test('Postgres: the rollback rewrites the row in one locked transaction, hands the old document to the backup first, and is idempotent', async () => {
  const pg = await PGlite.create()
  const sql = pgliteClient(pg), repo = new PostgresWorkspaceRepository(sql)
  await withChips(async action => { const { revision } = await repo.load(); return (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: revision, action })).workspace })
  const revision = (await repo.load()).revision
  // A backup that fails stops everything: the row keeps its chips.
  await assert.rejects(chipsAsTextPostgres(sql, 'daythread.workspace', () => { throw new Error('disk full') }), /disk full/)
  assert.ok(JSON.stringify(await repo.load()).includes('dateMention'))
  let backup = ''
  assert.equal((await chipsAsTextPostgres(sql, 'daythread.workspace', data => { backup = data })).chips, 3)
  assert.ok(backup.includes('dateMention'), 'the backup is the row as it was')
  const again = await chipsAsTextPostgres(sql, 'daythread.workspace')
  assert.deepEqual([again.chips, again.undoCleared], [0, false])
  const after = await new PostgresWorkspaceRepository(sql).load()
  assert.equal(JSON.stringify(after).includes('dateMention'), false)
  assert.equal(after.revision, revision)
  assert.deepEqual(words(after), expected)
  await pg.close()
})
