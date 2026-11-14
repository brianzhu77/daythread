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
// The Postgres store's own suite (rows, accounts, the migration from shot 1) is tests/shot2-storage.test.ts.
import { repositoryContract } from './repository-contract.ts'
import { outboxContract } from './outbox-contract.ts'

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

// B98: the outbox's row rule on the local store (outbox.md §5).
outboxContract('SQLite v2', async () => {
  const f = await sqliteFixture()
  const edit = (change: (data: { revision: number; receipts: Record<string, unknown> }) => void) => {
    const db = new DatabaseSync(f.path), row = db.prepare('SELECT data FROM workspace WHERE id = 1').get() as { data: string }
    const data = JSON.parse(row.data); change(data)
    db.prepare('UPDATE workspace SET revision = ?, data = ? WHERE id = 1').run(data.revision, JSON.stringify(data)); db.close()
  }
  return {
    create: f.create,
    // A build without the outbox writes without stamping: the revision moves past what was stamped.
    olderBuildWrote: async () => edit(data => { data.revision += 1 }),
    // Past the 500 + 3,000 receipt window: the next command compacts the old receipts out for good.
    forgetOperations: async repo => {
      edit(data => { for (let i = 0; i < 3600; i++) data.receipts[`old-${i}`] = { operationId: `old-${i}`, message: '', fingerprint: 'x' } })
      const ws = await repo.load()
      await repo.execute({ operationId: 'compacts', expectedRevision: ws.revision, action: { type: 'ensure-day', date: '2026-10-30' } })
    },
    cleanup: f.cleanup,
  }
})

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

test('Postgres: text survives exactly across a reopen (emoji, quotes, CJK); U+0000 alone is dropped', async () => {
  const db = await PGlite.create()
  try {
    const repo = new PostgresWorkspaceRepository(pgliteClient(db))
    await repo.execute({ operationId: 'd1', expectedRevision: 0, action: { type: 'ensure-day', date: today } })
    const title = 'emoji 🧵 · quote " \\ · 中文'
    await repo.execute({ operationId: 't1', expectedRevision: 1, action: { type: 'add-task', pageId: `day:${today}`, title: `nul \u0000 · ${title}`, plannedOn: today } })
    const reopened = await new PostgresWorkspaceRepository(pgliteClient(db)).load()
    assert.equal(reopened.tasks[0]!.title, `nul  · ${title}`)
    assert.equal(reopened.schemaVersion, 2)
  } finally { await db.close() }
})
