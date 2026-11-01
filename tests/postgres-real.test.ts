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
