import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { migrate, readMigrations, type Migration } from '../src/server/db/migrate.ts'
import { pgliteClient, type SqlClient } from '../src/server/db/sql.ts'

// C1 on PGlite (docs/plan/core-build.md): the schema, the restricted role under forced RLS, the seed and the
// constraints. Concurrency between connections is in core-postgres.test.ts, on a real Postgres 17.
const migrations = readMigrations(fileURLToPath(new URL('../db/migrations', import.meta.url)))

async function fresh(): Promise<{ db: PGlite; admin: SqlClient }> {
  const db = await PGlite.create()
  const admin = pgliteClient(db)
  await migrate(admin, migrations)
  return { db, admin }
}
/** Runs `fn` as the server role with `owner` as the verified owner, as the server will per transaction. */
function asOwner<T>(db: PGlite, owner: string | null, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  return db.transaction(async raw => {
    const tx = pgliteClient(raw)
    await tx.exec('set local role daythread_app')
    if (owner) await tx.query("select set_config('app.owner_id', $1, true)", [owner])
    return fn(tx)
  })
}
const seed = (db: PGlite, owner: string) => asOwner(db, owner, async tx => (await tx.query<{ id: string }>("select app.create_workspace($1, 'America/Vancouver') as id", [owner]))[0]!.id)
const rejects = (p: Promise<unknown>, pattern: RegExp) => assert.rejects(p, (e: Error) => pattern.test(e.message))

test('migrations apply once, record a checksum, and refuse a changed file', async () => {
  const { admin } = await fresh()
  assert.deepEqual(await migrate(admin, migrations), [])
  const changed: Migration[] = migrations.map((m, i) => i === 0 ? { ...m, checksum: 'edited' } : m)
  await rejects(migrate(admin, changed), /changed after it was applied/)
  await rejects(migrate(admin, migrations.slice(1)), /has no file/)
})

test('a failed migration leaves nothing behind', async () => {
  const { admin } = await fresh()
  const broken: Migration = { version: '9999_broken', sql: 'create table app.half (id text); select 1/0;', checksum: 'x' }
  await rejects(migrate(admin, [...migrations, broken]), /division by zero/)
  assert.equal((await admin.query("select to_regclass('app.half') as t"))[0]!.t, null)
  assert.equal((await admin.query("select count(*)::int as n from public.daythread_migrations where version = '9999_broken'"))[0]!.n, 0)
})

test('the seed: five collections with system properties and the day template, nothing else', async () => {
  const { db } = await fresh()
  const ws = await seed(db, 'alice')
  await asOwner(db, 'alice', async tx => {
    const collections = await tx.query<{ system_key: string }>('select system_key from app.collections where workspace_id = $1 order by system_key', [ws])
    assert.deepEqual(collections.map(c => c.system_key), ['days', 'events', 'links', 'tasks', 'templates'])
    const keys = await tx.query<{ c: string; k: string; u: string }>('select c.system_key as c, p.system_key as k, p.unique_scope as u from app.properties p join app.collections c on c.workspace_id = p.workspace_id and c.id = p.collection_id where p.workspace_id = $1', [ws])
    const has = (c: string, k: string) => keys.some(x => x.c === c && x.k === k)
    for (const k of ['status', 'plan_on', 'last_planned_on', 'due_on', 'start_on', 'paused', 'done_on', 'created_on', 'source_page']) assert.ok(has('tasks', k), k)
    assert.deepEqual(keys.filter(x => x.u !== 'none').map(x => `${x.c}.${x.k}:${x.u}`).sort(), ['days.date:all', 'links.url_key:all'])
    const pages = await tx.query<{ type: string }>("select type from app.blocks where workspace_id = $1 and parent_id is null", [ws])
    assert.deepEqual(pages.map(p => p.type), ['page'], 'only the template page: no sample page, task or welcome text')
    const rows = await tx.query<{ type: string; text: string | null; role: string | null }>(
      "select b.type, b.content -> 0 ->> 'text' as text, b.props ->> 'role' as role from app.blocks b join app.collections c on c.workspace_id = b.workspace_id and c.id = (select settings ->> 'template_page_id' from app.collections where workspace_id = $1 and system_key = 'days') where false", [ws])
    assert.deepEqual(rows, [])
    const template = await tx.query<{ type: string; text: string | null; role: string | null }>(
      "select type, content -> 0 ->> 'text' as text, props ->> 'role' as role from app.blocks where workspace_id = $1 and parent_id = (select settings ->> 'template_page_id' from app.collections where workspace_id = $1 and system_key = 'days') order by position", [ws])
    assert.deepEqual(template.map(r => [r.type, r.text, r.role]), [
      ['heading', 'TODO - Top 3', 'plan-top3'], ['todo', null, null],
      ['heading', 'TODO - Other', 'plan-other'], ['todo', null, null],
      ['heading', 'Events', null], ['bulletListItem', null, null],
      ['heading', 'Good Stuffs', 'collect-links'], ['bulletListItem', null, null],
      ['heading', 'Notes', null], ['bulletListItem', null, null],
    ])
  })
})

test('a workspace can only be created for the signed-in owner', async () => {
  const { db } = await fresh()
  await rejects(asOwner(db, 'alice', tx => tx.query("select app.create_workspace('mallory', 'UTC')")), /only be created for the signed-in owner/)
  await rejects(asOwner(db, null, tx => tx.query("select app.create_workspace('alice', 'UTC')")), /only be created for the signed-in owner/)
})

test('RLS: the owner sees only their workspace, writes elsewhere are refused, and no owner sees nothing', async () => {
  const { db } = await fresh()
  const a = await seed(db, 'alice'), b = await seed(db, 'bob')
  await asOwner(db, 'alice', async tx => {
    assert.deepEqual((await tx.query<{ id: string }>('select id from app.workspaces')).map(r => r.id), [a])
    assert.equal((await tx.query<{ n: number }>('select count(distinct workspace_id)::int as n from app.blocks'))[0]!.n, 1)
  })
  await rejects(asOwner(db, 'alice', tx => tx.query("insert into app.blocks (workspace_id, id, type) values ($1, 'x', 'paragraph')", [b])), /row-level security/)
  await rejects(asOwner(db, 'alice', tx => tx.query("insert into app.history (workspace_id, id, kind) values ($1, 'h', 'moved_off')", [b])), /row-level security/)
  // An update aimed at bob's rows matches nothing for alice.
  const touched = await asOwner(db, 'alice', tx => tx.query("update app.blocks set content = '[]' where workspace_id = $1 returning id", [b]))
  assert.deepEqual(touched, [])
  for (const table of ['workspaces', 'collections', 'properties', 'blocks', 'history', 'operations', 'model_attempts', 'jobs']) {
    const n = await asOwner(db, null, tx => tx.query<{ n: number }>(`select count(*)::int as n from app.${table}`))
    assert.equal(n[0]!.n, 0, `${table} with no owner`)
  }
})

test('grants: history is append-only, nothing is deletable that keeps facts, bookkeeping is out of reach', async () => {
  const { db } = await fresh()
  const ws = await seed(db, 'alice')
  await asOwner(db, 'alice', tx => tx.query("insert into app.history (workspace_id, id, kind, day) values ($1, 'h1', 'moved_off', '2026-10-18')", [ws]))
  await rejects(asOwner(db, 'alice', tx => tx.query("update app.history set kind = 'x' where workspace_id = $1", [ws])), /permission denied/)
  await rejects(asOwner(db, 'alice', tx => tx.query('delete from app.history where workspace_id = $1', [ws])), /permission denied/)
  await rejects(asOwner(db, 'alice', tx => tx.query('delete from app.blocks where workspace_id = $1', [ws])), /permission denied/)
  await rejects(asOwner(db, 'alice', tx => tx.query('delete from app.operations where workspace_id = $1', [ws])), /permission denied/)
  await rejects(asOwner(db, 'alice', tx => tx.query('select * from public.daythread_migrations')), /permission denied/)
})

test('constraints: no cycles, no cross-workspace references, closed property types, one value per unique key', async () => {
  const { db } = await fresh()
  const ws = await seed(db, 'alice'), other = await seed(db, 'bob')
  await asOwner(db, 'alice', async tx => {
    await tx.query("insert into app.blocks (workspace_id, id, type) values ($1, 'p1', 'page'), ($1, 'p2', 'page')", [ws])
    await tx.query("update app.blocks set parent_id = 'p1' where workspace_id = $1 and id = 'p2'", [ws])
  })
  await rejects(asOwner(db, 'alice', tx => tx.query("update app.blocks set parent_id = 'p2' where workspace_id = $1 and id = 'p1'", [ws])), /its own ancestor/)
  await rejects(asOwner(db, 'alice', tx => tx.query("update app.blocks set parent_id = 'p1' where workspace_id = $1 and id = 'p1'", [ws])), /check constraint|its own ancestor/)
  // A parent id that exists only in bob's workspace doesn't satisfy the composite key.
  const bobPage = await asOwner(db, 'bob', async tx => (await tx.query<{ id: string }>("select id from app.blocks where workspace_id = $1 and type = 'page'", [other]))[0]!.id)
  await rejects(asOwner(db, 'alice', tx => tx.query("insert into app.blocks (workspace_id, id, parent_id, type) values ($1, 'c', $2, 'paragraph')", [ws, bobPage])), /foreign key/)
  const days = await asOwner(db, 'alice', async tx => (await tx.query<{ id: string; date: string }>("select c.id, p.id as date from app.collections c join app.properties p on p.workspace_id = c.workspace_id and p.collection_id = c.id and p.system_key = 'date' where c.workspace_id = $1 and c.system_key = 'days'", [ws]))[0]!)
  await rejects(asOwner(db, 'alice', tx => tx.query("insert into app.properties (workspace_id, id, collection_id, name, type) values ($1, 'bad', $2, 'Bad', 'json')", [ws, days.id])), /check constraint/)
  await rejects(asOwner(db, 'alice', tx => tx.query("insert into app.properties (workspace_id, id, collection_id, name, type, cardinality, unique_scope) values ($1, 'many', $2, 'Many', 'date', 'many', 'all')", [ws, days.id])), /check constraint/)
  await rejects(asOwner(db, 'alice', tx => tx.query("insert into app.blocks (workspace_id, id, type, properties) values ($1, 'arr', 'page', '[]')", [ws])), /check constraint/)
  await asOwner(db, 'alice', async tx => {
    await tx.query("insert into app.blocks (workspace_id, id, type, collection_id, properties) values ($1, 'd1', 'page', $2, jsonb_build_object($3::text, jsonb_build_array('2026-10-22')))", [ws, days.id, days.date])
    await tx.query("insert into app.unique_values (workspace_id, property_id, value, block_id) values ($1, $2, '2026-10-22', 'd1')", [ws, days.date])
  })
  await asOwner(db, 'alice', tx => tx.query("insert into app.blocks (workspace_id, id, type, collection_id) values ($1, 'd2', 'page', $2)", [ws, days.id]))
  await rejects(asOwner(db, 'alice', tx => tx.query("insert into app.unique_values (workspace_id, property_id, value, block_id) values ($1, $2, '2026-10-22', 'd2')", [ws, days.date])), /duplicate key/)
  // Another workspace's property id can't be used for alice's block.
  const bobDate = await asOwner(db, 'bob', async tx => (await tx.query<{ id: string }>("select id from app.properties where workspace_id = $1 and system_key = 'date' limit 1", [other]))[0]!.id)
  await rejects(asOwner(db, 'alice', tx => tx.query("insert into app.unique_values (workspace_id, property_id, value, block_id) values ($1, $2, 'x', 'd2')", [ws, bobDate])), /foreign key/)
})

test('a failed write rolls back the block and its unique value together', async () => {
  const { db } = await fresh()
  const ws = await seed(db, 'alice')
  const days = await asOwner(db, 'alice', async tx => (await tx.query<{ id: string; date: string }>("select c.id, p.id as date from app.collections c join app.properties p on p.workspace_id = c.workspace_id and p.collection_id = c.id and p.system_key = 'date' where c.workspace_id = $1 and c.system_key = 'days'", [ws]))[0]!)
  await rejects(asOwner(db, 'alice', async tx => {
    await tx.query("insert into app.blocks (workspace_id, id, type, collection_id) values ($1, 'd1', 'page', $2)", [ws, days.id])
    await tx.query("insert into app.unique_values (workspace_id, property_id, value, block_id) values ($1, $2, '2026-10-22', 'd1')", [ws, days.date])
    await tx.query('select 1/0')
  }), /division by zero/)
  await asOwner(db, 'alice', async tx => {
    assert.equal((await tx.query("select 1 from app.blocks where workspace_id = $1 and id = 'd1'", [ws])).length, 0)
    assert.equal((await tx.query('select 1 from app.unique_values where workspace_id = $1', [ws])).length, 0, 'no stale reservation')
  })
})

test('property queries: containment on the one GIN index, ranges by a scan of the collection', async () => {
  const { db } = await fresh()
  const ws = await seed(db, 'alice')
  await asOwner(db, 'alice', async tx => {
    const [tasks] = await tx.query<{ id: string; plan: string }>("select c.id, p.id as plan from app.collections c join app.properties p on p.workspace_id = c.workspace_id and p.collection_id = c.id and p.system_key = 'plan_on' where c.workspace_id = $1 and c.system_key = 'tasks'", [ws])
    for (const [id, day] of [['t1', '2026-10-20'], ['t2', '2026-10-22'], ['t3', '2026-10-25']] as const)
      await tx.query("insert into app.blocks (workspace_id, id, type, collection_id, properties) values ($1, $2, 'page', $3, jsonb_build_object($4::text, jsonb_build_array($5::text)))", [ws, id, tasks!.id, tasks!.plan, day])
    const on = await tx.query<{ id: string }>('select id from app.blocks where workspace_id = $1 and properties @> jsonb_build_object($2::text, jsonb_build_array($3::text))', [ws, tasks!.plan, '2026-10-22'])
    assert.deepEqual(on.map(r => r.id), ['t2'])
    const before = await tx.query<{ id: string }>("select id from app.blocks where workspace_id = $1 and collection_id = $2 and properties -> $3 ->> 0 < $4 order by id", [ws, tasks!.id, tasks!.plan, '2026-10-22'])
    assert.deepEqual(before.map(r => r.id), ['t1'])
  })
})
