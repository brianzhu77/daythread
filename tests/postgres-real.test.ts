import { test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { postgresClient } from '../src/server/db/sql.ts'

// The Postgres store (rows, shot 2) through postgres-js on a real Postgres, as Vercel runs it: separate connections, prepare: false.
// Skipped unless DATABASE_TEST_URL points at a disposable database (its `daythread_test_*` schemas are dropped).
const url = process.env.DATABASE_TEST_URL
const skip = url ? false : 'DATABASE_TEST_URL not set'
const connect = () => postgres(url!, { prepare: false, max: 4, onnotice: () => {} })

test('real Postgres: two processes racing at the same revision, one wins and nothing is lost', { skip }, async () => {
  const schema = `daythread_test_${process.pid}`
  const [a, b] = [connect(), connect()]
  try {
    const [ra, rb] = [new PostgresWorkspaceRepository(postgresClient(a), schema), new PostgresWorkspaceRepository(postgresClient(b), schema)]
    // Both start up at once: the schema is created once, the row exists once.
    await Promise.all([ra.load(), rb.load()])
    const results = await Promise.allSettled([ra, rb].map((r, i) => r.execute({ operationId: `race-${i}`, expectedRevision: 0, action: { type: 'ensure-day', date: `2026-10-2${i}` } })))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, String(results.map(r => r.status === 'rejected' ? r.reason : 'ok')))
    const after = await rb.load()
    assert.equal(after.revision, 1)
    await rb.execute({ operationId: 'next', expectedRevision: 1, action: { type: 'ensure-day', date: '2026-10-25' } })
    assert.equal((await ra.load()).pages.length, 2)
    const text = 'nul \u0000 · 🧵 · 中文'
    const page = (await ra.load()).pages[0]!
    await ra.execute({ operationId: 't', expectedRevision: 2, action: { type: 'add-task', pageId: page.id, title: text, plannedOn: page.date } })
    assert.equal((await rb.load()).tasks[0]!.title, text.replace('\u0000', ''), 'everything but U+0000, which a text column refuses')
  } finally {
    await a.unsafe(`drop schema if exists daythread_test_${process.pid} cascade`)
    await Promise.all([a.end(), b.end()])
  }
})

test('real Postgres: two processes starting on a schema without the database columns add them once; values round-trip', { skip }, async () => {
  const schema = `daythread_test_db_${process.pid}`
  const [a, b] = [connect(), connect()]
  try {
    await new PostgresWorkspaceRepository(postgresClient(a), schema).load()
    await a.unsafe(`alter table ${schema}.pages drop column database_json, drop column row_values, drop column created_at, drop column edited_at`)
    const [ra, rb] = [new PostgresWorkspaceRepository(postgresClient(a), schema), new PostgresWorkspaceRepository(postgresClient(b), schema)]
    await Promise.all([ra.load(), rb.load()])
    const at = '2026-10-22T18:00:00.000Z'
    await ra.execute({ operationId: 'd1', expectedRevision: 0, action: { type: 'create-database', pageId: 'list', homeBlockId: null, title: 'Reading list' } })
    await ra.execute({ operationId: 'd2', expectedRevision: 1, action: { type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'due', name: 'Due', type: 'date' } } } })
    await ra.execute({ operationId: 'd3', expectedRevision: 2, action: { type: 'add-row', databaseId: 'list', pageId: 'dune', title: 'Dune', values: { due: { start: '2026-10-25', end: '2026-10-27' } }, at } })
    const row = (await rb.load()).pages.find(p => p.id === 'dune')!
    assert.deepEqual(row.values, { due: { start: '2026-10-25', end: '2026-10-27' } })
    assert.equal(row.createdAt, at)
    assert.equal((await rb.load()).pages.find(p => p.id === 'list')!.database!.properties[0]!.name, 'Due')
  } finally {
    await a.unsafe(`drop schema if exists daythread_test_db_${process.pid} cascade`)
    await Promise.all([a.end(), b.end()])
  }
})

test('real Postgres: a row number is never used twice, past an Undo', { skip }, async () => {
  const schema = `daythread_test_ids_${process.pid}`
  const a = connect()
  try {
    const r = new PostgresWorkspaceRepository(postgresClient(a), schema)
    let ws = await r.load()
    const run = async (operationId: string, action: never) => { const out = await r.execute({ operationId, expectedRevision: ws.revision, action }); ws = await r.load(); return out }
    await run('i1', { type: 'create-database', pageId: 'list', homeBlockId: null, title: 'List' } as never)
    await run('i2', { type: 'add-row', databaseId: 'list', pageId: 'one', title: 'One', at: '2026-10-22T18:00:00.000Z' } as never)
    await run('i3', { type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'num', name: 'No.', type: 'id' } } } as never)
    await run('i4', { type: 'add-row', databaseId: 'list', pageId: 'two', title: 'Two', at: '2026-10-22T18:00:00.000Z' } as never)
    assert.equal(ws.pages.find(p => p.id === 'two')!.values!['@id'], 2)
    await run('i5', { type: 'undo', targetOperationId: 'i4' } as never)
    assert.equal(ws.pages.some(p => p.id === 'two'), false)
    assert.equal(ws.pages.find(p => p.id === 'list')!.database!.nextRowNumber, 3)
    await run('i6', { type: 'add-row', databaseId: 'list', pageId: 'three', title: 'Three', at: '2026-10-22T18:00:00.000Z' } as never)
    assert.equal(ws.pages.find(p => p.id === 'three')!.values!['@id'], 3)
    assert.equal(ws.pages.find(p => p.id === 'one')!.values!['@id'], 1)
  } finally {
    await a.unsafe(`drop schema if exists ${schema} cascade`)
    await a.end()
  }
})

test('real Postgres: moving a parent takes its tree in one operation, and one Undo puts all of it back', { skip }, async () => {
  const schema = `daythread_test_move_${process.pid}`
  const a = connect()
  try {
    const r = new PostgresWorkspaceRepository(postgresClient(a), schema), at = '2026-10-22T18:00:00.000Z'
    let ws = await r.load()
    const run = async (operationId: string, action: never) => { await r.execute({ operationId, expectedRevision: ws.revision, action }); ws = await r.load() }
    const values = (id: string) => ws.pages.find(p => p.id === id)!.values
    await run('m1', { type: 'create-database', pageId: 'from', homeBlockId: null, title: 'From' } as never)
    await run('m2', { type: 'create-database', pageId: 'to', homeBlockId: null, title: 'To' } as never)
    await run('m3', { type: 'change-database', pageId: 'from', change: { kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } } } as never)
    for (const id of ['top', 'kid', 'grand']) await run(`add-${id}`, { type: 'add-row', databaseId: 'from', pageId: id, title: id, at } as never)
    await run('m4', { type: 'set-values', pageId: 'kid', values: { par: ['top'] }, expected: {}, at } as never)
    await run('m5', { type: 'set-values', pageId: 'grand', values: { par: ['kid'] }, expected: {}, at } as never)
    const before = ['top', 'kid', 'grand'].map(values)
    await run('move', { type: 'move-row', pageId: 'top', databaseId: 'to', at } as never)
    assert.deepEqual(['top', 'kid', 'grand'].map(id => ws.pages.find(p => p.id === id)!.parentId), ['to', 'to', 'to'])
    const { parent, sub } = ws.pages.find(p => p.id === 'to')!.database!.subItems!
    assert.deepEqual(values('grand')![parent], ['kid'])
    assert.deepEqual(values('top')![sub], ['kid'])
    await run('back', { type: 'undo', targetOperationId: 'move' } as never)
    assert.deepEqual(['top', 'kid', 'grand'].map(id => ws.pages.find(p => p.id === id)!.parentId), ['from', 'from', 'from'])
    assert.deepEqual(['top', 'kid', 'grand'].map(values), before)
    assert.equal(ws.pages.find(p => p.id === 'to')!.database!.subItems, undefined)
  } finally {
    await a.unsafe(`drop schema if exists ${schema} cascade`)
    await a.end()
  }
})

