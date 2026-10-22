import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { pgliteClient } from '../src/server/db/sql.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { SessionStore } from '../src/server/auth/sessions.ts'
import { asOwner } from '../src/server/auth/request-owner.ts'

// The workspace linked to his account (Brian 9985cf62, Lead, Ratchet's pre-review, Bumblebee fb275f23).
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const ensureDay = (operationId: string, expectedRevision: number) => ({ operationId, expectedRevision, action: { type: 'ensure-day' as const, date: '2026-10-22' } })
async function setup(withAuthUsers = false) {
  const db = await PGlite.create()
  if (withAuthUsers) await db.exec(`create schema auth; create table auth.users (id uuid primary key, email text); insert into auth.users values ('${A}', 'owner@example.com');`)
  const sql = pgliteClient(db)
  const repo = new PostgresWorkspaceRepository(sql)
  await repo.prepare()
  return { db, sql, repo, linked: async () => (await db.query<{ u: string | null }>('select user_id::text as u from daythread.workspace')).rows[0]!.u }
}

test('link: an unlinked workspace takes the first owner account; the same account again is fine; another is refused', async () => {
  const { db, sql, repo, linked } = await setup()
  await repo.execute(ensureDay('d1', 0))
  const before = (await db.query<{ revision: number; data: string; ledger: string }>('select revision, data::text as data, ledger::text as ledger from daythread.workspace')).rows[0]
  assert.equal(await linked(), null)
  assert.equal(await sql.transaction(tx => repo.link(tx, A)), 'linked')
  assert.equal(await linked(), A)
  assert.equal(await sql.transaction(tx => repo.link(tx, A)), 'linked')
  assert.equal(await sql.transaction(tx => repo.link(tx, B)), 'not-linked')
  assert.equal(await linked(), A)
  const after = (await db.query<{ revision: number; data: string; ledger: string }>('select revision, data::text as data, ledger::text as ledger from daythread.workspace')).rows[0]
  assert.deepEqual(after, before, 'linking touches nothing but user_id')
  await db.close()
})

test('the database refuses changing the link, except in one transaction an admin flags on purpose', async () => {
  const { db, sql, repo, linked } = await setup()
  await sql.transaction(tx => repo.link(tx, A))
  await assert.rejects(db.query(`update daythread.workspace set user_id = '${B}'`), /linked to another account/)
  await assert.rejects(db.query('update daythread.workspace set user_id = null'), /linked to another account/)
  await db.exec(`begin; set local daythread.allow_relink = 'on'; update daythread.workspace set user_id = '${B}' where id = 1; commit;`)
  assert.equal(await linked(), B)
  await assert.rejects(db.query(`update daythread.workspace set user_id = '${A}'`), /linked to another account/, 'the flag ended with its transaction')
  // An older build's writes don't name user_id, so the trigger never fires for them.
  await db.query(`update daythread.workspace set revision = revision + 1, data = data where id = 1`)
  await db.query(`insert into daythread.workspace (id, revision, data) values (1, 0, '{}') on conflict (id) do nothing`)
  await db.close()
})

test('signed in, the store reads and writes only the row linked to that account; with sign-in off, the one row', async () => {
  const { db, sql, repo } = await setup()
  await sql.transaction(tx => repo.link(tx, A))
  assert.equal((await asOwner(A, () => repo.execute(ensureDay('d1', 0)))).workspace.revision, 1)
  await assert.rejects(asOwner(B, () => repo.load()), /not linked to this account/)
  await assert.rejects(asOwner(B, () => repo.execute(ensureDay('d2', 1))), /not linked to this account/)
  await assert.rejects(asOwner(B, () => repo.modelAttempts()), /not linked to this account/)
  assert.equal((await repo.load()).revision, 1, 'sign-in off (3000) opens the row whatever its link')
  await db.close()
})

test('on Supabase the link must be a real account, which then can\'t be deleted while linked', async () => {
  const { db, sql, repo } = await setup(true)
  await assert.rejects(sql.transaction(tx => repo.link(tx, B)), /foreign key/)
  assert.equal(await sql.transaction(tx => repo.link(tx, A)), 'linked')
  await assert.rejects(db.query(`delete from auth.users where id = '${A}'`), /foreign key/)
  const fk = (await db.query<{ n: number }>("select count(*)::int as n from pg_constraint where conname = 'workspace_user_id_fkey'")).rows[0]!.n
  assert.equal(fk, 1)
  // A second start leaves the schema alone (no ALTER on every cold start) and adds no second constraint.
  await new PostgresWorkspaceRepository(sql).prepare()
  assert.equal((await db.query<{ n: number }>("select count(*)::int as n from pg_constraint where conname = 'workspace_user_id_fkey'")).rows[0]!.n, 1)
  await db.close()
})

test('a store with more than one workspace row refuses to start and says why', async () => {
  const { db, sql } = await setup()
  await db.exec(`alter table daythread.workspace drop constraint workspace_id_check; insert into daythread.workspace (id, revision, data) values (2, 0, '{}');`)
  await assert.rejects(new PostgresWorkspaceRepository(sql).prepare(), /Expected one workspace row.*found 2/)
  await db.close()
})

test('sign-in: the right password links and issues a session in one go; another account gets not-linked, counted neither way', async () => {
  const server = await import('../src/server/auth/server.ts')
  const { db, sql, repo, linked } = await setup()
  const store = new SessionStore(sql, 'daythread', { workspace: 'daythread.workspace' })
  server.useSessionStore(store); server.useWorkspaceStore(repo)
  const saved = { ...process.env }, realFetch = globalThis.fetch
  Object.assign(process.env, { SUPABASE_URL: 'https://auth.test', SUPABASE_PUBLISHABLE_KEY: 'pk', OWNER_EMAIL: 'owner@example.com' })
  let account = A
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('logout')) return new Response(null, { status: 204 })
    const body = JSON.parse(String(init?.body))
    return body.password === 'right'
      ? Response.json({ access_token: 'at', user: { id: account, email: 'owner@example.com' } })
      : Response.json({ error_code: 'invalid_credentials' }, { status: 400 })
  }) as typeof fetch
  const signIn = (password: string, ip: string) => server.handleSignIn(new Request('http://127.0.0.1/api/auth/sign-in', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1', 'x-forwarded-for': ip }, body: JSON.stringify({ email: 'owner@example.com', password }) }))
  const failures = async () => (await db.query<{ n: number }>('select count(*)::int as n from daythread.sign_in_failures')).rows[0]!.n
  try {
    const first = await signIn('right', '10.1.0.1')
    assert.equal(first.status, 200)
    assert.equal(await linked(), A, 'first sign-in linked the workspace')
    const token = (first.headers.get('set-cookie') ?? '').split(';')[0]!.split('=')[1]!
    assert.equal((await server.ownerSession(token))?.userId, A)
    assert.equal((await signIn('nope', '10.1.0.2')).status, 401)
    assert.equal(await failures(), 1)
    account = B // his Supabase account recreated: right password, new id
    const other = await signIn('right', '10.1.0.3')
    assert.equal(other.status, 403); assert.deepEqual(await other.json(), { ok: false, error: 'not-linked' })
    assert.equal(other.headers.get('set-cookie'), null, 'no session for the unlinked account')
    assert.equal(await failures(), 1, 'not-linked neither counts as a failure nor clears the count')
    assert.equal(await linked(), A)
    // An admin relinks to the new account: the old account's session ends at its next request.
    await db.exec(`begin; set local daythread.allow_relink = 'on'; update daythread.workspace set user_id = '${B}' where id = 1; commit;`)
    assert.equal(await server.ownerSession(token), null)
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from daythread.sessions where user_id = '${A}'`)).rows[0]!.n, 0)
    assert.equal((await signIn('right', '10.1.0.4')).status, 200, 'the new account now signs in')
  } finally {
    globalThis.fetch = realFetch; process.env = saved; server.useSessionStore(undefined); server.useWorkspaceStore(undefined); await db.close()
  }
})

test('a session from before the workspace was linked waits for one sign-in; it is not deleted', async () => {
  const server = await import('../src/server/auth/server.ts')
  const { db, sql, repo } = await setup()
  const store = new SessionStore(sql, 'daythread', { workspace: 'daythread.workspace' })
  server.useSessionStore(store); server.useWorkspaceStore(repo)
  const saved = { ...process.env }
  Object.assign(process.env, { SUPABASE_URL: 'https://auth.test', SUPABASE_PUBLISHABLE_KEY: 'pk', OWNER_EMAIL: 'owner@example.com' })
  try {
    const { token } = await store.create(A, 'owner@example.com')
    assert.equal(await server.ownerSession(token), null)
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from daythread.sessions')).rows[0]!.n, 1)
    await sql.transaction(tx => repo.link(tx, A))
    assert.equal((await server.ownerSession(token))?.userId, A, 'once linked to the same account, it works again')
  } finally { process.env = saved; server.useSessionStore(undefined); server.useWorkspaceStore(undefined); await db.close() }
})
