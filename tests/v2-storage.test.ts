import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PGlite } from '@electric-sql/pglite'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import { convertV1 } from '../src/domain/convert-v1.ts'
import { repositoryContract } from './repository-contract.ts'

const v1Dir = new URL('./fixtures/v1/', import.meta.url)
const today = '2026-10-22'

const sqliteFixture = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-v2-sqlite-')), path = join(dir, 'workspace.sqlite')
  return {
    dir, path,
    create: () => new SqliteWorkspaceRepository(path),
    failBeforeCommit: async (operationId: string) => {
      assert.equal(operationId, 'injected-failure')
      const db = new DatabaseSync(path); db.prepare('SELECT 1').get()
      db.exec("CREATE TRIGGER inject_failure BEFORE UPDATE ON workspace WHEN NEW.data LIKE '%injected-failure%' BEGIN SELECT RAISE(ABORT,'injected SQL failure'); END"); db.close()
      return () => { const db = new DatabaseSync(path); db.exec('DROP TRIGGER inject_failure'); db.close() }
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}
repositoryContract('SQLite v2', sqliteFixture)

const pgFixture = async () => {
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
repositoryContract('Postgres v2 (PGlite)', pgFixture)

test('SQLite: a v1 store (layout 7, entity tables) is upgraded in place to the v2 document; the next command writes v2', async () => {
  const f = await sqliteFixture()
  try {
    await copyFile(new URL('workspace.sqlite', v1Dir), f.path)
    const expected = convertV1(JSON.parse(await readFile(new URL('workspace.json', v1Dir), 'utf8')), today)
    const repo = new SqliteWorkspaceRepository(f.path, undefined, { today })
    const loaded = await repo.load()
    assert.equal(loaded.schemaVersion, 2)
    assert.equal(loaded.revision, expected.revision)
    assert.deepEqual(loaded.pages.map(p => p.id).sort(), expected.pages.map(p => p.id).sort())
    assert.deepEqual(loaded.tasks, expected.tasks)
    assert.deepEqual(loaded.pages.map(p => p.document), expected.pages.map(p => p.document))
    const r = await repo.execute({ operationId: 'after-upgrade', expectedRevision: loaded.revision, action: { type: 'handoff-done', date: '2026-10-21' } })
    assert.equal(r.workspace.revision, loaded.revision + 1)
    const db = new DatabaseSync(f.path)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name)
    assert.ok(tables.includes('workspace'))
    assert.ok(!tables.includes('placements') && !tables.includes('materials') && !tables.includes('captures'))
    db.close()
    assert.deepEqual((await new SqliteWorkspaceRepository(f.path).load()).revision, loaded.revision + 1)
  } finally { await f.cleanup() }
})

test('Postgres: a v1 row (data json at schema 1) is converted on read and stored as v2 by the next command', async () => {
  const db = await PGlite.create()
  try {
    const repo = new PostgresWorkspaceRepository(pgliteClient(db), undefined, { today })
    await repo.load()
    const raw = await readFile(new URL('workspace.json', v1Dir), 'utf8')
    const expected = convertV1(JSON.parse(raw), today)
    await db.query('update daythread.workspace set data = $1::json, revision = $2 where id = 1', [raw, expected.revision])
    const loaded = await new PostgresWorkspaceRepository(pgliteClient(db), undefined, { today }).load()
    assert.equal(loaded.schemaVersion, 2)
    assert.deepEqual(loaded.tasks, expected.tasks)
    assert.deepEqual(loaded.pages.map(p => p.document), expected.pages.map(p => p.document))
    const r = await repo.execute({ operationId: 'after-upgrade', expectedRevision: loaded.revision, action: { type: 'handoff-done', date: '2026-10-21' } })
    assert.equal(r.workspace.revision, expected.revision + 1)
    const stored = (await db.query<{ data: string }>('select data::text as data from daythread.workspace where id = 1')).rows[0]!.data
    assert.equal((JSON.parse(stored) as { schemaVersion: number }).schemaVersion, 2)
  } finally { await db.close() }
})

test('Postgres: a workspace row that is already v2 is read as is; text survives exactly', async () => {
  const db = await PGlite.create()
  try {
    const repo = new PostgresWorkspaceRepository(pgliteClient(db))
    await repo.execute({ operationId: 'd1', expectedRevision: 0, action: { type: 'ensure-day', date: today } })
    const title = 'nul \u0000 · emoji 🧵 · quote " \\ · 中文'
    await repo.execute({ operationId: 't1', expectedRevision: 1, action: { type: 'add-task', pageId: `day:${today}`, title, plannedOn: today } })
    const reopened = await new PostgresWorkspaceRepository(pgliteClient(db)).load()
    assert.equal(reopened.tasks[0]!.title, title)
    assert.equal(reopened.schemaVersion, 2)
  } finally { await db.close() }
})
