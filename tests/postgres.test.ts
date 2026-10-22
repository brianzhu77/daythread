import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { PostgresWorkspaceRepository, schemaName } from '../src/server/postgres-repository.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import { repositoryContract } from './repository-contract.ts'

// The Postgres store on PGlite (Postgres 17 in WebAssembly): the same contract as SQLite, plus what's specific to it.
const fixture = async () => {
  const db = await PGlite.create()
  return {
    create: () => new PostgresWorkspaceRepository(pgliteClient(db)),
    failBeforeCommit: async (operationId: string) => {
      assert.equal(operationId, 'injected-failure')
      await db.exec(`create function daythread.inject_failure() returns trigger language plpgsql as $$
        begin if (new.data::jsonb -> 'receipts') ? 'injected-failure' then raise exception 'injected SQL failure'; end if; return new; end $$;
        create trigger inject_failure before update on daythread.workspace for each row execute function daythread.inject_failure();`)
      return () => { void db.exec('drop trigger inject_failure on daythread.workspace') }
    },
    cleanup: () => db.close(),
  }
}
repositoryContract('Postgres (PGlite)', fixture)

const day = (operationId: string, expectedRevision: number, date = '2026-10-22') => ({ operationId, expectedRevision, action: { type: 'ensure-day' as const, date } })

test('Postgres: starts empty, in its own schema with RLS on, and a second process neither resets nor duplicates it', async () => {
  const db = await PGlite.create()
  const first = new PostgresWorkspaceRepository(pgliteClient(db))
  assert.equal((await first.load()).pages.length, 0)
  await first.execute(day('d1', 0))
  const second = new PostgresWorkspaceRepository(pgliteClient(db))
  assert.equal((await second.load()).revision, 1)
  const tables = await db.query<{ schemaname: string; rowsecurity: boolean }>("select schemaname, rowsecurity from pg_tables where tablename = 'workspace'")
  assert.deepEqual(tables.rows, [{ schemaname: 'daythread', rowsecurity: true }])
  assert.equal((await db.query<{ n: number }>('select count(*)::int as n from daythread.workspace')).rows[0]!.n, 1)
  await db.close()
})

test('Postgres: DAYTHREAD_PG_SCHEMA picks the schema and must be a plain identifier', async () => {
  assert.equal(schemaName(undefined), 'daythread')
  assert.equal(schemaName('daythread_check'), 'daythread_check')
  for (const bad of ['public; drop table x', 'Daythread', '1x', '']) assert.throws(() => schemaName(bad))
  const db = await PGlite.create()
  await new PostgresWorkspaceRepository(pgliteClient(db), 'daythread_check').execute(day('d1', 0))
  assert.equal((await db.query<{ n: number }>('select count(*)::int as n from daythread_check.workspace')).rows[0]!.n, 1)
  assert.equal((await db.query("select to_regclass('daythread.workspace') as t")).rows[0]!.t as unknown, null)
  await db.close()
})

test('Postgres: text is stored exactly, including characters jsonb would refuse or rewrite', async () => {
  const db = await PGlite.create()
  const repo = new PostgresWorkspaceRepository(pgliteClient(db))
  await repo.execute(day('d1', 0))
  const page = (await repo.load()).pages[0]!
  const title = 'nul \u0000 · emoji 🧵 · quote " \\ · 中文'
  await repo.execute({ operationId: 't1', expectedRevision: 1, action: { type: 'add-task', pageId: page.id, sectionId: page.sections[0]!.id, title } })
  const reopened = await new PostgresWorkspaceRepository(pgliteClient(db)).load()
  assert.equal(reopened.tasks[0]!.title, title)
  await db.close()
})

test('Postgres: the model ledger lives outside the workspace, keeps micro-USD exact, and rolls back with its result', async () => {
  const db = await PGlite.create()
  const repo = new PostgresWorkspaceRepository(pgliteClient(db))
  await repo.execute(day('d1', 0))
  const reserve = (id: string, upperBoundUsd: number) => repo.reserveModelAttempt({ id, subject: { kind: 'draft', date: '2026-10-22', run: 1 }, day: '2026-10-22', upperBoundUsd, model: 'm', requestHash: 'h', now: '2026-10-22T05:00:00Z' })
  assert.equal((await reserve('ledger-only-attempt', 0.000003)).replayed, false)
  assert.equal((await reserve('ledger-only-attempt', 0.000003)).replayed, true)
  await assert.rejects(reserve('ledger-only-attempt', 0.004), /different input/)
  // A result that fails after its write leaves neither the charge nor the workspace change behind.
  const before = await repo.load()
  await assert.rejects(repo.recordModelResult({ attemptId: 'ledger-only-attempt', actualUsd: 0.000002, generationId: 'g', now: '2026-10-22T05:01:00Z' }, w => ({ operationId: 'r1', expectedRevision: w.revision, action: { type: 'ensure-day', date: '2026-10-23' } }), { failAfterWrite: true }), /injected/)
  assert.deepEqual(await repo.load(), before)
  assert.equal((await repo.modelAttempts())[0]!.state, 'reserved')
  const settled = await repo.recordModelResult({ attemptId: 'ledger-only-attempt', actualUsd: 0.000002, generationId: 'g', now: '2026-10-22T05:01:00Z' }, w => ({ operationId: 'r1', expectedRevision: w.revision, action: { type: 'ensure-day', date: '2026-10-23' } }))
  assert.equal(settled.attempt.state, 'settled')
  assert.equal(settled.result?.workspace.revision, 2)
  const [attempt] = await new PostgresWorkspaceRepository(pgliteClient(db)).modelAttempts()
  assert.equal(attempt!.reservedUsd, 0.000003)
  assert.equal(attempt!.actualUsd, 0.000002)
  // The spend is beside the workspace document, never inside it, so restoring a workspace copy can't bring it back.
  assert.equal(JSON.stringify(await repo.load()).includes('ledger-only-attempt'), false)
  assert.equal(await repo.markInterruptedModelAttempts('2026-10-22T06:00:00Z'), 0)
  await db.close()
})

test('Postgres: a reservation younger than the cutoff is left to the process still working on it', async () => {
  const db = await PGlite.create()
  const repo = new PostgresWorkspaceRepository(pgliteClient(db))
  await repo.reserveModelAttempt({ id: 'live', subject: { kind: 'capture', id: 'c', revision: 1 }, day: '2026-10-22', upperBoundUsd: 0.004, model: 'fake/model', requestHash: 'h', now: '2026-10-22T05:00:00.000Z' })
  assert.equal(await repo.markInterruptedModelAttempts('2026-10-22T05:01:00.000Z', '2026-10-22T04:56:00.000Z'), 0)
  assert.equal((await repo.modelAttempts())[0]!.state, 'reserved')
  assert.equal(await repo.markInterruptedModelAttempts('2026-10-22T05:06:00.000Z', '2026-10-22T05:01:00.000Z'), 1)
  assert.equal((await repo.modelAttempts())[0]!.state, 'estimated')
  await db.close()
})

test('storage: Postgres by default on Vercel; an explicit DAYTHREAD_STORAGE still wins', async () => {
  const { storageKind } = await import('../src/server/storage.ts')
  const saved = { VERCEL: process.env.VERCEL, DAYTHREAD_STORAGE: process.env.DAYTHREAD_STORAGE }
  try {
    delete process.env.DAYTHREAD_STORAGE; delete process.env.VERCEL
    assert.equal(storageKind(), undefined)
    process.env.VERCEL = '1'
    assert.equal(storageKind(), 'postgres')
    process.env.DAYTHREAD_STORAGE = 'sqlite'
    assert.equal(storageKind(), 'sqlite')
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
})
