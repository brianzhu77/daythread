import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { pgliteClient, type SqlClient } from '../src/server/db/sql.ts'
import { asOwner } from '../src/server/auth/request-owner.ts'
import { convertV1 } from '../src/domain/convert-v1.ts'
import { repositoryContract } from './repository-contract.ts'
import type { Workspace } from '../src/domain/types.ts'

// Shot 2 (docs: "Shot 2 in detail"): the workspace on Postgres as rows (workspaces, pages, tasks, deleted_tasks,
// operations), one workspace per account, Undo from each operation's inverse instead of a second copy of the
// workspace, and the migration from shot 1's single row. The domain is untouched: these tests drive the store.
const today = '2026-10-22'
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333'
const v1 = () => JSON.parse(readFileSync(new URL('./fixtures/v1/workspace.json', import.meta.url), 'utf8')) as Record<string, unknown>
const stored = (ws: Workspace) => ({ revision: ws.revision, timezone: ws.timezone, pages: ws.pages, tasks: ws.tasks, deletedTasks: ws.deletedTasks })

const pgFixture = async () => {
  const db = await PGlite.create()
  return {
    create: () => new PostgresWorkspaceRepository(pgliteClient(db)),
    failBeforeCommit: async (operationId: string) => {
      assert.equal(operationId, 'injected-failure')
      await db.exec(`create function daythread.inject_failure() returns trigger language plpgsql as $$
        begin if new.operation_id = 'injected-failure' then raise exception 'injected SQL failure'; end if; return new; end $$;
        create trigger inject_failure before insert on daythread.operations for each row execute function daythread.inject_failure();`)
      return () => { void db.exec('drop trigger inject_failure on daythread.operations') }
    },
    cleanup: () => db.close(),
  }
}
// With sign-in off (no owner), the store serves the one local workspace, as the Mac's Postgres mode does.
repositoryContract('Postgres rows (PGlite), no owner', pgFixture)

async function withWorkspaces(db: PGlite, users: [string, string][]): Promise<{ sql: SqlClient; repo: PostgresWorkspaceRepository }> {
  const sql = pgliteClient(db), repo = new PostgresWorkspaceRepository(sql, undefined, { today })
  await repo.prepare()
  for (const [user, timezone] of users) await sql.transaction(tx => repo.createWorkspace(tx, user, timezone))
  return { sql, repo }
}

test('one workspace per account: each account reads and writes only its own rows; the same page id in two workspaces never clashes', async () => {
  const db = await PGlite.create()
  try {
    const { sql, repo } = await withWorkspaces(db, [[A, 'America/Vancouver'], [B, 'Asia/Shanghai']])
    await asOwner(A, () => repo.execute({ operationId: 'a1', expectedRevision: 0, action: { type: 'ensure-day', date: today } }))
    await asOwner(A, () => repo.execute({ operationId: 'a2', expectedRevision: 1, action: { type: 'add-task', pageId: `day:${today}`, title: 'A only', plannedOn: today } }))
    const b = await asOwner(B, () => repo.load())
    assert.deepEqual([b.revision, b.pages, b.tasks, b.timezone], [0, [], [], 'Asia/Shanghai'])
    await assert.rejects(asOwner(B, () => repo.execute({ operationId: 'b1', expectedRevision: 0, action: { type: 'add-task', pageId: `day:${today}`, title: 'into A?' } })), /Page not found/)
    await asOwner(B, () => repo.execute({ operationId: 'b2', expectedRevision: 0, action: { type: 'ensure-day', date: today } }))
    await asOwner(B, () => repo.execute({ operationId: 'b3', expectedRevision: 1, action: { type: 'add-task', pageId: `day:${today}`, title: 'B only', plannedOn: today } }))
    const a = await asOwner(A, () => repo.load()), b2 = await asOwner(B, () => repo.load())
    assert.deepEqual(a.tasks.map(t => t.title), ['A only'])
    assert.deepEqual(b2.tasks.map(t => t.title), ['B only'])
    assert.equal(a.pages.length, 1); assert.equal(b2.pages.length, 1)
    // A replay is per workspace too: B reusing A's operation id is a new operation for B.
    await asOwner(B, () => repo.execute({ operationId: 'a1', expectedRevision: 2, action: { type: 'ensure-day', date: '2026-10-23' } }))
    assert.equal((await asOwner(B, () => repo.load())).pages.length, 2)
    assert.equal((await asOwner(A, () => repo.load())).pages.length, 1)
    // An account without a workspace is refused, and the local (no-owner) workspace is separate from every account.
    await assert.rejects(asOwner(C, () => repo.load()), /No workspace/)
    assert.equal(await repo.workspaceOf(C), null)
    assert.ok(await repo.workspaceOf(A))
    assert.deepEqual((await repo.load()).pages, [])
    // Every row carries its workspace id; the tables are under RLS with no policies.
    const [{ n }] = await sql.query<{ n: number }>("select count(*)::int as n from daythread.pages where workspace_id is null")
    assert.equal(n, 0)
    const rls = await sql.query<{ relname: string }>(`select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'daythread' and c.relkind = 'r' and c.relrowsecurity order by 1`)
    for (const t of ['workspaces', 'pages', 'tasks', 'deleted_tasks', 'operations']) assert.ok(rls.some(r => r.relname === t), `${t} has row-level security on`)
  } finally { await db.close() }
})

test('Undo comes from the operation\'s inverse, survives a restart, and is refused once anything changed since; no second copy of the workspace is stored', async () => {
  const db = await PGlite.create()
  try {
    const { sql, repo } = await withWorkspaces(db, [[A, 'America/Vancouver']])
    const run = (operationId: string, expectedRevision: number, action: Parameters<typeof repo.execute>[0]['action']) => asOwner(A, () => repo.execute({ operationId, expectedRevision, action }))
    await run('d', 0, { type: 'ensure-day', date: today })
    await run('d2', 1, { type: 'ensure-day', date: '2026-10-23' })
    await run('keep', 2, { type: 'add-task', pageId: `day:${today}`, title: 'Keep', plannedOn: today })
    const r = await run('u', 3, { type: 'add-task', pageId: `day:${today}`, title: 'Undo me', plannedOn: today })
    const undoMe = r.receipt.entityId!
    // A new process (a new store instance) still sees the Undo marker, and can undo.
    const fresh = new PostgresWorkspaceRepository(sql, undefined, { today })
    const loaded = await asOwner(A, () => fresh.load())
    assert.deepEqual(loaded.undo, { operationId: 'u', revision: 4 })
    const undone = await asOwner(A, () => fresh.execute({ operationId: 'undo-u', expectedRevision: 4, action: { type: 'undo', targetOperationId: 'u' } }))
    assert.deepEqual(undone.workspace.tasks.map(t => t.title), ['Keep'])
    assert.equal(undone.workspace.revision, 5)
    assert.equal(undone.workspace.undo, undefined)
    const after = await asOwner(A, () => fresh.load())
    assert.deepEqual(after.tasks.map(t => t.title), ['Keep'])
    assert.ok(!after.pages[0]!.document.includes(undoMe), 'the row left the page with the task')
    assert.equal(after.undo, undefined)
    // Later change: the older operation can't be undone any more (the same rule as the domain's one slot).
    await run('later', 5, { type: 'add-task', pageId: `day:${today}`, title: 'Later', plannedOn: today })
    await assert.rejects(run('undo-u-again', 6, { type: 'undo', targetOperationId: 'u' }), /Cannot undo/)
    // What is stored per operation: the receipt and an inverse touching only what changed; never the whole workspace.
    const ops = await sql.query<{ operation_id: string; revision: number; inverse: string | null; receipt: string }>(
      'select operation_id, revision, inverse::text as inverse, receipt::text as receipt from daythread.operations order by revision')
    assert.deepEqual(ops.map(o => [o.operation_id, o.revision]), [['d', 1], ['d2', 2], ['keep', 3], ['u', 4], ['undo-u', 5], ['later', 6]])
    const inverse = JSON.parse(ops.find(o => o.operation_id === 'u')!.inverse!) as { pages: { upsert: { id: string }[]; remove: string[] }; tasks: { upsert: unknown[]; remove: string[] } }
    assert.deepEqual(inverse.tasks.remove, [undoMe])
    assert.deepEqual(inverse.pages.upsert.map(p => p.id), [`day:${today}`], 'only the page the row was added to, not the other day page')
    assert.equal(ops.find(o => o.operation_id === 'd')!.inverse, null, 'ensure-day was never undoable')
    assert.equal(ops.find(o => o.operation_id === 'undo-u')!.inverse, null)
    assert.equal((JSON.parse(ops.find(o => o.operation_id === 'u')!.receipt) as { operationId: string }).operationId, 'u')
    // A replay of an old operation returns its receipt and changes nothing, at any later revision.
    const replay = await run('keep', 2, { type: 'add-task', pageId: `day:${today}`, title: 'Keep', plannedOn: today })
    assert.equal(replay.workspace.revision, 6)
    assert.equal(replay.receipt.message, 'Task added')
  } finally { await db.close() }
})

test('a page save stores the page\'s previous document as its inverse, and undoing it restores that document exactly', async () => {
  const db = await PGlite.create()
  try {
    const { sql, repo } = await withWorkspaces(db, [[A, 'America/Vancouver']])
    const { pageContentKey } = await import('../src/domain/editor-document.ts')
    const run = (operationId: string, expectedRevision: number, action: Parameters<typeof repo.execute>[0]['action']) => asOwner(A, () => repo.execute({ operationId, expectedRevision, action }))
    await run('d', 0, { type: 'ensure-day', date: today })
    await run('d2', 1, { type: 'ensure-day', date: '2026-10-23' })
    const page = (await asOwner(A, () => repo.load())).pages.find(p => p.id === `day:${today}`)!
    const text = 'emoji 🧵 · quote " \\ · 中文 · tab\t'
    const doc = [{ id: 'l1', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }]
    await run('s', 2, { type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify(doc), today })
    const saved = (await asOwner(A, () => repo.load())).pages.find(p => p.id === page.id)!
    assert.equal(saved.document, JSON.stringify(doc), 'stored as written, every character')
    const [op] = await sql.query<{ inverse: string }>("select inverse::text as inverse from daythread.operations where operation_id = 's'")
    const inverse = JSON.parse(op!.inverse) as { pages: { upsert: { id: string; document: string }[] }; tasks: { upsert: unknown[]; remove: string[] } }
    assert.deepEqual(inverse.pages.upsert.map(p => p.id), [page.id])
    assert.equal(inverse.pages.upsert[0]!.document, page.document)
    assert.deepEqual([inverse.tasks.upsert, inverse.tasks.remove], [[], []])
    await run('undo-s', 3, { type: 'undo', targetOperationId: 's' })
    assert.equal((await asOwner(A, () => repo.load())).pages.find(p => p.id === page.id)!.document, page.document)
  } finally { await db.close() }
})

test('set-timezone changes the workspace\'s time zone row; an unknown zone is refused', async () => {
  const db = await PGlite.create()
  try {
    const { sql, repo } = await withWorkspaces(db, [[A, 'America/Vancouver']])
    await asOwner(A, () => repo.execute({ operationId: 'tz', expectedRevision: 0, action: { type: 'set-timezone', timezone: 'Asia/Tokyo' } }))
    assert.equal((await asOwner(A, () => repo.load())).timezone, 'Asia/Tokyo')
    assert.deepEqual(await sql.query('select timezone from daythread.workspaces where user_id = $1', [A]), [{ timezone: 'Asia/Tokyo' }])
    await assert.rejects(asOwner(A, () => repo.execute({ operationId: 'tz2', expectedRevision: 1, action: { type: 'set-timezone', timezone: 'Mars/Olympus' } })), /time zone/i)
    assert.equal(await repo.timezoneOf(A), 'Asia/Tokyo')
  } finally { await db.close() }
})

test('createWorkspace is idempotent; deleteWorkspace removes every row of that workspace and nothing of another', async () => {
  const db = await PGlite.create()
  try {
    const { sql, repo } = await withWorkspaces(db, [[A, 'America/Vancouver'], [B, 'Europe/Paris']])
    const first = await repo.workspaceOf(A)
    await sql.transaction(tx => repo.createWorkspace(tx, A, 'Asia/Tokyo'))
    assert.deepEqual(await repo.workspaceOf(A), first, 'a second create keeps the workspace and its time zone')
    for (const [user, who] of [[A, 'a'], [B, 'b']] as const) {
      await asOwner(user, () => repo.execute({ operationId: `${who}1`, expectedRevision: 0, action: { type: 'ensure-day', date: today } }))
      await asOwner(user, () => repo.execute({ operationId: `${who}2`, expectedRevision: 1, action: { type: 'add-task', pageId: `day:${today}`, title: who, plannedOn: today } }))
    }
    await sql.transaction(tx => repo.deleteWorkspace(tx, A))
    assert.equal(await repo.workspaceOf(A), null)
    await assert.rejects(asOwner(A, () => repo.load()), /No workspace/)
    for (const table of ['pages', 'tasks', 'operations', 'deleted_tasks', 'workspaces']) {
      const [{ n }] = await sql.query<{ n: number }>(`select count(*)::int as n from daythread.${table}`)
      assert.equal(n, table === 'deleted_tasks' ? 0 : table === 'workspaces' ? 1 : table === 'operations' ? 2 : 1, `${table}: only B's rows remain`)
    }
    assert.deepEqual((await asOwner(B, () => repo.load())).tasks.map(t => t.title), ['b'])
  } finally { await db.close() }
})

/** Shot 1's table, as the live database has it: one row, the document as json, linked to an account. */
async function shot1Table(sql: SqlClient, data: unknown, revision: number, userId: string | null): Promise<void> {
  await sql.exec(`create schema if not exists daythread;
    create table daythread.workspace (id integer primary key check (id = 1), revision integer not null, data json not null, updated_at timestamptz not null default now(), user_id uuid unique);
    alter table daythread.workspace enable row level security;
    create or replace function daythread.workspace_user_id_guard() returns trigger language plpgsql as $g$ begin
      if old.user_id is not null and new.user_id is distinct from old.user_id and coalesce(current_setting('daythread.allow_relink', true), '') <> 'on' then raise exception 'relink refused'; end if; return new; end $g$;
    create trigger workspace_user_id_guard before update of user_id on daythread.workspace for each row execute function daythread.workspace_user_id_guard();`)
  await sql.query('insert into daythread.workspace (id, revision, data, user_id) values (1, $1, $2::text::json, $3::uuid)', [revision, JSON.stringify(data), userId])
}

test('a stray shot 1 table after the cutover (an old build ran against the database): set aside, never migrated over live rows, the start completes', async () => {
  const db = await PGlite.create()
  try {
    const sql = pgliteClient(db), expected = convertV1(v1(), today)
    await shot1Table(sql, expected, expected.revision, A)
    await new PostgresWorkspaceRepository(sql, undefined, { today }).prepare()
    const before = stored(await asOwner(A, () => new PostgresWorkspaceRepository(sql, undefined, { today }).load()))
    // The shot 1 build's own schema setup, run again after the cutover, with a row it wrote meanwhile.
    await shot1Table(sql, { ...expected, pages: [], tasks: [], revision: 3 }, 3, A)
    const repo = new PostgresWorkspaceRepository(sql, undefined, { today })
    await repo.prepare()
    const tables = (await sql.query<{ relname: string }>("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'daythread' and c.relkind = 'r' order by relname")).map(r => r.relname)
    assert.ok(!tables.includes('workspace'), 'the stray table is out of the way: ' + tables.join(','))
    assert.ok(tables.includes('workspace_shot1'), 'the rollback copy stays')
    assert.equal(tables.filter(t => t.startsWith('workspace_stray_')).length, 1, 'the stray table is kept aside, not dropped: ' + tables.join(','))
    assert.deepEqual(stored(await asOwner(A, () => repo.load())), before, 'the live rows are untouched')
    // A second stray, a minute later, is kept too.
    await shot1Table(sql, { ...expected, pages: [], tasks: [], revision: 4 }, 4, A)
    await new PostgresWorkspaceRepository(sql, undefined, { today }).prepare()
    assert.equal((await sql.query<{ relname: string }>("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'daythread' and c.relname like 'workspace_stray_%'")).length, 2)
  } finally { await db.close() }
})

test('migration: shot 1\'s linked row becomes the account\'s workspace, rows for rows, revision and receipts kept, the old table kept as workspace_shot1', async () => {
  const db = await PGlite.create()
  try {
    const sql = pgliteClient(db), expected = convertV1(v1(), today)
    await shot1Table(sql, expected, expected.revision, A)
    const repo = new PostgresWorkspaceRepository(sql, undefined, { today })
    await repo.prepare()
    const loaded = await asOwner(A, () => repo.load())
    assert.deepEqual(stored(loaded), stored(expected))
    assert.equal(loaded.undo, undefined, 'shot 1\'s undo copy is not carried over')
    const receiptIds = Object.keys(expected.receipts)
    assert.ok(receiptIds.length > 0)
    const [{ n }] = await sql.query<{ n: number }>('select count(*)::int as n from daythread.operations')
    assert.equal(n, receiptIds.length)
    // A receipt that came over still guards its operation id: the same id with other input is refused.
    const reused = receiptIds.find(id => expected.receipts[id]!.fingerprint !== 'expired')!
    await assert.rejects(asOwner(A, () => repo.execute({ operationId: reused, expectedRevision: loaded.revision, action: { type: 'ensure-day', date: '2031-01-01' } })), /reused with different input/)
    // The next command writes rows and bumps the revision; a second start finds nothing to migrate.
    const r = await asOwner(A, () => repo.execute({ operationId: 'after-migration', expectedRevision: loaded.revision, action: { type: 'handoff-done', date: '2026-10-21' } }))
    assert.equal(r.workspace.revision, expected.revision + 1)
    const again = new PostgresWorkspaceRepository(sql, undefined, { today })
    await again.prepare()
    assert.equal((await asOwner(A, () => again.load())).revision, expected.revision + 1)
    const tables = (await sql.query<{ relname: string }>("select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'daythread' and c.relkind = 'r'")).map(t => t.relname)
    assert.ok(tables.includes('workspace_shot1') && !tables.includes('workspace'), String(tables))
    const [old] = await sql.query<{ revision: number; user_id: string }>('select revision, user_id::text as user_id from daythread.workspace_shot1')
    assert.deepEqual(old, { revision: expected.revision, user_id: A }, 'the backup row is untouched')
    assert.equal((await sql.query<{ timezone: string }>('select timezone from daythread.workspaces where user_id = $1', [A]))[0]!.timezone, expected.timezone)
  } finally { await db.close() }
})

test('migration: a shot 1 row still in the v1 shape is converted first; an unlinked row with content becomes the local workspace', async () => {
  for (const linked of [A, null]) {
    const db = await PGlite.create()
    try {
      const sql = pgliteClient(db), raw = v1(), expected = convertV1(raw, today)
      await shot1Table(sql, raw, expected.revision, linked)
      const repo = new PostgresWorkspaceRepository(sql, undefined, { today })
      await repo.prepare()
      const loaded = linked ? await asOwner(linked, () => repo.load()) : await repo.load()
      assert.deepEqual(stored(loaded), stored(expected))
    } finally { await db.close() }
  }
})

test('migration: an unlinked, never-written row (revision 0) migrates to nothing; the first account starts empty', async () => {
  const db = await PGlite.create()
  try {
    const sql = pgliteClient(db)
    const { createEmptyWorkspace } = await import('../src/domain/workspace.ts')
    await shot1Table(sql, createEmptyWorkspace(), 0, null)
    const repo = new PostgresWorkspaceRepository(sql, undefined, { today })
    await repo.prepare()
    assert.equal((await sql.query<{ n: number }>('select count(*)::int as n from daythread.workspaces'))[0]!.n, 0)
    await sql.transaction(tx => repo.createWorkspace(tx, A, 'America/Vancouver'))
    assert.deepEqual((await asOwner(A, () => repo.load())).pages, [])
  } finally { await db.close() }
})

test('text survives exactly in every column, emoji and quotes included; U+0000, which no text column holds, is dropped', async () => {
  const db = await PGlite.create()
  try {
    const { repo } = await withWorkspaces(db, [[A, 'America/Vancouver']])
    const { pageContentKey } = await import('../src/domain/editor-document.ts')
    const typed = 'nul \u0000 · emoji 🧵 · quote " \\ · 中文', title = typed.replace('\u0000', '')
    const run = (operationId: string, expectedRevision: number, action: Parameters<typeof repo.execute>[0]['action']) => asOwner(A, () => repo.execute({ operationId, expectedRevision, action }))
    await run('d', 0, { type: 'ensure-day', date: today })
    const t = await run('t', 1, { type: 'add-task', pageId: `day:${today}`, title: typed, plannedOn: today })
    const page = (await asOwner(A, () => repo.load())).pages[0]!
    assert.equal((await asOwner(A, () => repo.load())).tasks[0]!.title, title)
    assert.ok(page.document.includes('emoji 🧵') && !page.document.includes('\\u0000'), 'the row\'s words too')
    // Removing the task's only row tombstones it (deleted_tasks), title and all.
    const doc = JSON.parse(page.document) as { props?: { taskId?: string } }[]
    await run('s', 2, { type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify(doc.filter(n => n.props?.taskId !== t.receipt.entityId)), singleDeleteIds: [], today })
    const after = await asOwner(A, () => repo.load())
    assert.deepEqual(after.tasks, [])
    assert.equal(after.deletedTasks[0]!.title, title)
  } finally { await db.close() }
})

test('the operations log is pruned every 25th revision: operations older than 30 days go, the newest one and the recent ones stay, Undo and replay unaffected', async () => {
  const db = await PGlite.create()
  try {
    const { sql, repo } = await withWorkspaces(db, [[A, 'America/Vancouver']])
    const { operationKeepMs, pruneEvery } = await import('../src/server/postgres-repository.ts')
    assert.equal(pruneEvery, 25); assert.equal(operationKeepMs, 30 * 24 * 3600_000)
    const run = (operationId: string, expectedRevision: number, action: Parameters<typeof repo.execute>[0]['action']) => asOwner(A, () => repo.execute({ operationId, expectedRevision, action }))
    await run('d', 0, { type: 'ensure-day', date: today })
    for (let i = 1; i < 23; i++) await run(`t${i}`, i, { type: 'add-task', pageId: `day:${today}`, title: `Task ${i}`, plannedOn: today })
    // Revision 23 now. Age everything but the last two operations by 31 days.
    await sql.query("update daythread.operations set created_at = now() - interval '31 days' where revision <= 21")
    await run('t23', 23, { type: 'add-task', pageId: `day:${today}`, title: 'Task 23', plannedOn: today })
    assert.equal((await sql.query<{ n: number }>('select count(*)::int as n from daythread.operations'))[0]!.n, 24, 'revision 24: nothing pruned yet')
    const r = await run('t24', 24, { type: 'add-task', pageId: `day:${today}`, title: 'Task 24', plannedOn: today })
    assert.equal(r.workspace.revision, 25)
    const left = (await sql.query<{ operation_id: string }>('select operation_id from daythread.operations order by revision')).map(o => o.operation_id)
    assert.deepEqual(left, ['t21', 't22', 't23', 't24'], 'the old ones are gone, the recent ones stay (t21 is revision 22, not aged)')
    // A replay of a pruned operation is a new operation now (its receipt is gone), refused at its old revision like any stale command.
    await assert.rejects(run('t5', 5, { type: 'add-task', pageId: `day:${today}`, title: 'Task 5', plannedOn: today }), /Saved elsewhere/)
    // Undo still works on the newest.
    const undone = await run('u', 25, { type: 'undo', targetOperationId: 't24' })
    assert.ok(!undone.workspace.tasks.some(t => t.title === 'Task 24'))
    // The newest operation is kept even when it is old: age everything, write 25 more, the one just before the prune survives only if recent.
    await sql.query("update daythread.operations set created_at = now() - interval '31 days'")
    const before = (await asOwner(A, () => repo.load())).revision
    for (let i = 0; i < pruneEvery; i++) await run(`m${i}`, before + i, { type: 'ensure-day', date: `2027-01-${String(i + 1).padStart(2, '0')}` })
    const after = (await sql.query<{ operation_id: string }>('select operation_id from daythread.operations order by revision')).map(o => o.operation_id)
    assert.ok(after.every(id => id.startsWith('m')), 'only the recent ones remain: ' + after.join(','))
    assert.equal(after.length, pruneEvery)
    // pruneOperations itself: the newest stays whatever its age.
    await sql.query("update daythread.operations set created_at = now() - interval '31 days'")
    const ws = await repo.workspaceOf(A)
    await sql.transaction(tx => repo.pruneOperations(tx, ws!.id, new Date()))
    const last = (await sql.query<{ operation_id: string }>('select operation_id from daythread.operations')).map(o => o.operation_id)
    assert.deepEqual(last, [`m${pruneEvery - 1}`])
  } finally { await db.close() }
})
