import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'
import { migrate, readMigrations } from '../src/server/db/migrate.ts'
import { postgresClient } from '../src/server/db/sql.ts'

// C1 on a real Postgres 17 (CI's service container, or embedded-postgres locally): what PGlite's single connection
// can't show. Skipped when DATABASE_TEST_URL is unset. The URL must point at a disposable database: it is reset.
const url = process.env.DATABASE_TEST_URL
const migrations = readMigrations(fileURLToPath(new URL('../db/migrations', import.meta.url)))
const skip = url ? false : 'DATABASE_TEST_URL not set'
let admin: Sql
const connect = (u = url!) => postgres(u, { max: 1, prepare: false, onnotice: () => {} })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** A request transaction as the server will run it: role and verified owner set first, reset at the end. */
const asOwner = <T>(sql: Sql, owner: string, fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(async tx => {
  await tx`set local role daythread_app`
  await tx`select set_config('app.owner_id', ${owner}, true)`
  return fn(tx)
}) as Promise<T>

before(async () => {
  if (!url) return
  admin = connect()
  // A Supabase-like connecting user: can create roles and schemas, but is not a superuser.
  await admin.unsafe(`drop schema if exists app cascade; drop table if exists public.daythread_migrations;
    do $$ begin if exists (select 1 from pg_roles where rolname = 'daythread_app') then drop owned by daythread_app; drop role daythread_app; end if; end $$;
    do $$ begin if not exists (select 1 from pg_roles where rolname = 'supa_owner') then create role supa_owner login password 'test' createrole nosuperuser; end if; end $$;
    grant create on database ${(await admin`select current_database() as d`)[0]!.d} to supa_owner; grant create on schema public to supa_owner;`)
})
after(async () => { await admin?.end() })

const ownerUrl = () => { const u = new URL(url!); u.username = 'supa_owner'; u.password = 'test'; return u.toString() }

test('migrations apply as a non-superuser, which can then act as the restricted role', { skip }, async () => {
  const sql = connect(ownerUrl())
  try {
    assert.deepEqual(await migrate(postgresClient(sql), migrations), migrations.map(m => m.version))
    const ws = await asOwner(sql, 'alice', async tx => (await tx`select app.create_workspace('alice', 'America/Vancouver') as id`)[0]!.id as string)
    assert.ok(ws)
    const [{ role, owner }] = await sql`select current_user as role, current_setting('app.owner_id', true) as owner`
    assert.equal(role, 'supa_owner', 'the role is reset after the transaction')
    assert.ok(!owner, 'the owner claim is reset after the transaction')
  } finally { await sql.end() }
})

test('role and owner are reset after a failed request transaction too', { skip }, async () => {
  const sql = connect(ownerUrl())
  try {
    await assert.rejects(asOwner(sql, 'alice', async tx => { await tx`select 1/0` }))
    const [{ role, owner }] = await sql`select current_user as role, current_setting('app.owner_id', true) as owner`
    assert.equal(role, 'supa_owner'); assert.ok(!owner)
  } finally { await sql.end() }
})

test('the workspace lock serializes two writers: the second waits until the first commits', { skip }, async () => {
  const a = connect(ownerUrl()), b = connect(ownerUrl())
  try {
    const ws = (await asOwner(a, 'alice', tx => tx`select id from app.workspaces`))[0]!.id as string
    const order: string[] = []
    const first = asOwner(a, 'alice', async tx => {
      await tx`select id from app.workspaces where id = ${ws} for update`
      order.push('a locked'); await sleep(400); order.push('a commits')
    })
    await sleep(100)
    const second = asOwner(b, 'alice', async tx => {
      await tx`select id from app.workspaces where id = ${ws} for update`
      order.push('b locked')
    })
    await Promise.all([first, second])
    assert.deepEqual(order, ['a locked', 'a commits', 'b locked'])
  } finally { await a.end(); await b.end() }
})

test('two transactions reserving the same unique value: exactly one wins, nothing stale is left', { skip }, async () => {
  const a = connect(ownerUrl()), b = connect(ownerUrl())
  try {
    const [{ ws, coll, prop }] = await asOwner(a, 'alice', tx => tx`select c.workspace_id as ws, c.id as coll, p.id as prop from app.collections c join app.properties p on p.workspace_id = c.workspace_id and p.collection_id = c.id and p.system_key = 'date' where c.system_key = 'days'`)
    const day = (conn: Sql, id: string) => asOwner(conn, 'alice', async tx => {
      await tx`insert into app.blocks (workspace_id, id, type, collection_id) values (${ws}, ${id}, 'page', ${coll})`
      await sleep(150)
      await tx`insert into app.unique_values (workspace_id, property_id, value, block_id) values (${ws}, ${prop}, '2026-10-30', ${id})`
    })
    const results = await Promise.allSettled([day(a, 'race-a'), day(b, 'race-b')])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.match(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), /duplicate key/)
    const rows = await asOwner(a, 'alice', tx => tx`select b.id, (select count(*)::int from app.unique_values u where u.block_id = b.id) as n from app.blocks b where b.id in ('race-a', 'race-b')`)
    assert.equal(rows.length, 1, 'the loser left no block')
    assert.equal(rows[0]!.n, 1, 'and no stale reservation')
  } finally { await a.end(); await b.end() }
})

test('RLS on the real server path: another owner sees and changes nothing', { skip }, async () => {
  const sql = connect(ownerUrl())
  try {
    await asOwner(sql, 'bob', tx => tx`select app.create_workspace('bob', 'UTC')`)
    const seen = await asOwner(sql, 'bob', tx => tx`select distinct workspace_id from app.blocks`)
    assert.equal(seen.length, 1)
    const alice = (await asOwner(sql, 'alice', tx => tx`select id from app.workspaces`))[0]!.id as string
    assert.equal((await asOwner(sql, 'bob', tx => tx`update app.blocks set content = '[]' where workspace_id = ${alice} returning id`)).length, 0)
    await assert.rejects(asOwner(sql, 'bob', tx => tx`insert into app.history (workspace_id, id, kind) values (${alice}, 'h', 'x')`), /row-level security/)
  } finally { await sql.end() }
})
