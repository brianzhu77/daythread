// A smart note is stored as one hidden row in `pages`, the way a synced block's record is; it never appears among the pages.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { applyChanges, changesBetween } from '../src/domain/workspace-changes.ts'
import type { applyCommand } from '../src/domain/workspace.ts'
import type { SmartNote, SmartResult } from '../src/domain/smart-note.ts'
import { planWrites, rowsOf, workspaceOf } from '../src/server/workspace-rows.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harness } from './v2-helpers.ts'

const result = (over: Partial<SmartResult> = {}): SmartResult => ({ blocks: [{ kind: 'bullet', text: 'Guest checkout is out', sources: [{ pageId: 'doc', blockId: 'l1' }] }], at: '2026-11-12T09:00:00.000Z', inputKey: 'k1', pagesRead: 1, pagesLeftOut: 0, from: '2026-11-12', to: '2026-11-12', ...over })
const note = (over: Partial<SmartNote> = {}): SmartNote => ({ id: 'n1', name: 'Checkout', prompt: 'What do my notes say about checkout?', range: { where: { kind: 'workspace' }, days: 0 }, refresh: 'manual', result: result(), ...over })
function withNote() {
  const h = harness()
  h.run({ type: 'create-document', title: 'Doc', body: '', pageId: 'doc' })
  h.run({ type: 'save-smart-note', note: note() })
  return h
}

test('rows: a note round-trips through rowsOf and workspaceOf, and is not a page', () => {
  const { ws } = withNote()
  const back = workspaceOf(rowsOf(ws))
  assert.deepEqual(back.smartNotes, ws.smartNotes)
  assert.ok(back.pages.length > 0)
  assert.ok(back.pages.every(p => !p.id.startsWith('smart:')))
  assert.deepEqual(back.pages.map(p => p.id), ws.pages.map(p => p.id))
})

test('rows: the smart row is { id: "smart:n1", type: "smart", title: "Checkout", edited_at: result.at } with every other optional column null', () => {
  const { ws } = withNote()
  const rows = rowsOf(ws).pages
  const row = rows.at(-1)!
  assert.equal(rows.length, ws.pages.length + 1)
  assert.deepEqual(row, {
    id: 'smart:n1', position: rows.length - 1, type: 'smart', date: null, title: 'Checkout', url: null, parent_id: null, trashed_at: null, trash_id: null,
    document: JSON.stringify({ prompt: ws.smartNotes![0]!.prompt, range: ws.smartNotes![0]!.range, refresh: 'manual', result: ws.smartNotes![0]!.result }),
    handoff_done: false, review_saved: false, database_json: null, row_values: null, created_at: null, edited_at: '2026-11-12T09:00:00.000Z', icon: null, cover: null, cover_position: null,
  })
})

test('schema: a store that already has its tables runs no DDL when the first smart note is saved', async () => {
  const db = await PGlite.create()
  try {
    const repo = new PostgresWorkspaceRepository(pgliteClient(db))
    let ws = await repo.load()
    const columns = async () => (await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'daythread' and table_name = 'pages' order by ordinal_position`)).rows
    const before = await columns()
    assert.ok(before.length > 0)
    ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'save-smart-note', note: note() } })).workspace
    assert.deepEqual(await columns(), before)
    assert.equal((await db.query(`select id from daythread.pages where id = 'smart:n1'`)).rows.length, 1)
  } finally { await db.close() }
})

test('rows: a result write changes one row, and its inverse puts the old result back', () => {
  const h = withNote()
  const before = rowsOf(h.ws)
  const old = h.ws.smartNotes![0]!.result
  h.run({ type: 'set-smart-note-result', noteId: 'n1', result: result({ at: '2026-11-13T09:00:00.000Z', inputKey: 'k2' }) })
  const { write, inverse } = planWrites(before, h.ws)
  assert.deepEqual(write.pages.upsert.map(r => r.id), ['smart:n1'])
  assert.deepEqual(inverse.pages.upsert.map(r => r.id), ['smart:n1'])
  assert.deepEqual(workspaceOf({ ...before, pages: before.pages.map(r => r.id === 'smart:n1' ? inverse.pages.upsert[0]! : r) }).smartNotes![0]!.result, old)
})

test('rows: a smart row that cannot be read is skipped and the workspace still loads', () => {
  const rows = rowsOf(withNote().ws)
  const broken = { ...rows, pages: rows.pages.map(r => r.id === 'smart:n1' ? { ...r, document: '{' } : r) }
  const warn = console.warn, warnings: string[] = []
  console.warn = (m: unknown) => { warnings.push(String(m)) }
  try {
    const ws = workspaceOf(broken)
    assert.equal(ws.smartNotes, undefined)
    assert.ok(ws.pages.every(p => !p.id.startsWith('smart:')))
  } finally { console.warn = warn }
  assert.equal(warnings.length, 1)
  assert.deepEqual(JSON.parse(warnings[0]!), { level: 'warn', event: 'smart.unreadable' })
})

test('changes: a saved note reaches a tab through changesBetween and applyChanges', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Doc', body: '', pageId: 'doc' })
  const before = h.ws
  h.run({ type: 'save-smart-note', note: note() })
  const changes = changesBetween(before, h.ws)
  assert.deepEqual(changes.smartNotes, h.ws.smartNotes)
  assert.deepEqual(applyChanges(before, changes)!.smartNotes, h.ws.smartNotes)
  assert.equal(changesBetween(h.ws, h.ws).smartNotes, undefined)
})

test('changes: an empty list after a change travels as [] and is dropped on apply', () => {
  const full = withNote().ws
  const emptied = { ...full, revision: full.revision + 1, smartNotes: undefined }
  const changes = changesBetween(full, emptied)
  assert.deepEqual(changes.smartNotes, [])
  assert.equal(applyChanges(full, changes)!.smartNotes, undefined)
})

test('stores: Postgres (PGlite) and SQLite keep a note across load, and Undo removes it', async () => {
  const exercise = async (open: () => { load(): Promise<ReturnType<typeof workspaceOf>>; execute(c: { operationId: string; expectedRevision: number; action: Parameters<typeof applyCommand>[1]['action'] }): Promise<{ workspace: ReturnType<typeof workspaceOf>; receipt: { operationId: string } }> }) => {
    let ws = await open().load()
    ws = (await open().execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'create-document', title: 'Doc', body: '', pageId: 'doc' } })).workspace
    const r = await open().execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'save-smart-note', note: note() } })
    ws = r.workspace
    assert.deepEqual((await open().load()).smartNotes, [note()])
    assert.ok((await open().load()).pages.every(p => !p.id.startsWith('smart:')))
    await open().execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'undo', targetOperationId: r.receipt.operationId } })
    assert.equal((await open().load()).smartNotes, undefined)
  }
  const db = await PGlite.create()
  try { await exercise(() => new PostgresWorkspaceRepository(pgliteClient(db)) as never) } finally { await db.close() }
  const dir = mkdtempSync(join(tmpdir(), 'smart-'))
  try { await exercise(() => new SqliteWorkspaceRepository(join(dir, 'ws.sqlite'), undefined, { allowMissingLegacy: true }) as never) } finally { rmSync(dir, { recursive: true, force: true }) }
})
