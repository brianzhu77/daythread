import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { pgliteClient } from '../src/server/db/sql.ts'
import { SessionStore, absoluteMs, freeFailures, maxWaitMs, renewEveryMs, slidingMs } from '../src/server/auth/sessions.ts'
import { verifyPassword } from '../src/server/auth/supabase.ts'
import { authRequired } from '../src/server/auth/config.ts'

// Sign-in (Brian 247ee3f3; Ratchet f6dc9688, d1ec5845; Bumblebee 869d3f42). The gate itself is checked end to end
// against a running server in tests/evidence/sign-in/.
const t0 = new Date('2026-10-22T17:00:00.000Z')
const at = (ms: number) => new Date(t0.getTime() + ms)
const config = { supabaseUrl: 'https://auth.test', publishableKey: 'pk', ownerEmail: 'owner@example.com' }

test('sessions: only the token hash is stored; sign-out deletes it, so the same cookie is refused afterwards', async () => {
  const db = await PGlite.create()
  const store = new SessionStore(pgliteClient(db))
  const { token, expiresAt } = await store.create('u1', 'owner@example.com', t0)
  assert.equal(expiresAt.getTime(), t0.getTime() + slidingMs)
  const rows = (await db.query<{ token_hash: string }>('select token_hash from daythread.sessions')).rows
  assert.equal(rows.length, 1); assert.notEqual(rows[0]!.token_hash, token); assert.match(rows[0]!.token_hash, /^[0-9a-f]{64}$/)
  assert.equal((await db.query<{ rowsecurity: boolean }>("select rowsecurity from pg_tables where tablename = 'sessions'")).rows[0]!.rowsecurity, true)
  assert.equal((await store.check(token, at(1000)))?.email, 'owner@example.com')
  await store.delete(token)
  assert.equal(await store.check(token, at(2000)), null)
  for (const bad of [undefined, '', 'x', `${token}x`, "' or 1=1 --"]) assert.equal(await store.check(bad, at(3000)), null)
  await db.close()
})

test('sessions: 30-day sliding window renewed at most hourly, never past 180 days from sign-in', async () => {
  const db = await PGlite.create()
  const store = new SessionStore(pgliteClient(db))
  const { token } = await store.create('u1', 'owner@example.com', t0)
  assert.equal((await store.check(token, at(renewEveryMs - 1)))!.renewed, false, 'within the hour: no write')
  const r = (await store.check(token, at(renewEveryMs)))!
  assert.equal(r.renewed, true); assert.equal(r.expiresAt.getTime(), t0.getTime() + renewEveryMs + slidingMs)
  // Idle 7+ days still opens (Bumblebee's check); idle past 30 days doesn't.
  assert.ok(await store.check(token, at(renewEveryMs + 8 * 86_400_000)))
  let now = renewEveryMs + 8 * 86_400_000
  while (now + 20 * 86_400_000 < absoluteMs) { now += 20 * 86_400_000; assert.ok(await store.check(token, at(now)), `day ${now / 86_400_000}`) }
  assert.equal(await store.check(token, at(absoluteMs)), null, '180 days after sign-in it ends whatever the use')
  const idle = await store.create('u1', 'owner@example.com', t0)
  assert.equal(await store.check(idle.token, at(slidingMs)), null, '30 days idle')
  await db.close()
})

type Reply = { status: number; body: unknown }
const fakeFetch = (reply: (path: string, body: Record<string, unknown>) => Reply, calls: string[] = []) =>
  (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace('/auth/v1/', '') + new URL(String(url)).search
    calls.push(path)
    const r = reply(path, JSON.parse(String(init?.body ?? '{}')))
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as typeof fetch

test('password: wrong, unknown and non-owner are the same refusal; Supabase down throws; its session is ended', async () => {
  const calls: string[] = []
  const ok = (email: string) => () => ({ status: 200, body: { access_token: 'at', user: { id: 'u-' + email, email } } })
  assert.deepEqual(await verifyPassword(config, ' Owner@Example.com ', 'pw', fakeFetch(ok('owner@example.com'), calls)), { ok: true, userId: 'u-owner@example.com', email: 'owner@example.com' })
  assert.deepEqual(calls, ['token?grant_type=password', 'logout?scope=local'])
  assert.deepEqual(await verifyPassword(config, 'other@example.com', 'pw', fakeFetch(ok('other@example.com'))), { ok: false })
  assert.deepEqual(await verifyPassword(config, 'owner@example.com', 'bad', fakeFetch(() => ({ status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } }))), { ok: false })
  for (const status of [429, 500, 503]) await assert.rejects(verifyPassword(config, 'owner@example.com', 'pw', fakeFetch(() => ({ status, body: {} }))))
  const none: string[] = []
  for (const password of ['', 'x'.repeat(1025)]) assert.deepEqual(await verifyPassword(config, 'owner@example.com', password, fakeFetch(ok('owner@example.com'), none)), { ok: false })
  assert.equal(none.length, 0, 'an empty or oversized password never reaches Supabase')
})

test('brake: after 5 failures each try waits, doubling to 15 min; refused tries never push it out; success clears', async () => {
  const db = await PGlite.create()
  const store = new SessionStore(pgliteClient(db))
  let clock = t0.getTime(), calls = 0
  const now = () => new Date(clock)
  const wrong = async () => { calls++; return false }, right = async () => { calls++; return true }
  for (let i = 0; i < freeFailures; i++) assert.deepEqual(await store.attempt(wrong, now), { ok: false, waitMs: 0 })
  assert.deepEqual(await store.attempt(wrong, now), { ok: false, waitMs: 30_000 }, '6th try waits 30 s')
  assert.equal(calls, freeFailures, 'a braked try never reaches Supabase')
  clock += 10_000
  assert.equal((await store.attempt(right, now)).waitMs, 20_000, 'refused tries record nothing: still 20 s left, not 30')
  clock += 20_000
  assert.deepEqual(await store.attempt(wrong, now), { ok: false, waitMs: 0 })
  assert.equal((await store.attempt(wrong, now)).waitMs, 60_000, 'doubles')
  for (let i = 0; i < 10; i++) { clock += maxWaitMs; await store.attempt(wrong, now) }
  assert.ok((await store.attempt(wrong, now)).waitMs <= maxWaitMs, 'never more than 15 min')
  clock += maxWaitMs
  assert.deepEqual(await store.attempt(right, now), { ok: true, waitMs: 0 })
  assert.deepEqual(await store.attempt(wrong, now), { ok: false, waitMs: 0 }, 'a success cleared the count')
  await db.close()
})

test('brake: simultaneous tries are taken one at a time, so only the free ones reach Supabase', async () => {
  const db = await PGlite.create()
  const store = new SessionStore(pgliteClient(db))
  let calls = 0
  const results = await Promise.all(Array.from({ length: 20 }, () => store.attempt(async () => { calls++; await new Promise(r => setTimeout(r, 5)); return false })))
  assert.equal(calls, freeFailures)
  assert.equal(results.filter(r => r.waitMs > 0).length, 20 - freeFailures)
  await db.close()
})

test('brake: a signed-in session keeps working while new sign-ins wait', async () => {
  const db = await PGlite.create()
  const store = new SessionStore(pgliteClient(db))
  const { token } = await store.create('u1', 'owner@example.com', t0)
  for (let i = 0; i <= freeFailures; i++) await store.attempt(async () => false, () => at(1000))
  assert.ok((await store.attempt(async () => true, () => at(2000))).waitMs > 0)
  assert.equal((await store.check(token, at(3000)))?.email, 'owner@example.com')
  await db.close()
})

test('sign-in can be switched off only off a hosting platform', () => {
  assert.equal(authRequired({}), true)
  assert.equal(authRequired({ DAYTHREAD_AUTH: 'off' }), false)
  assert.throws(() => authRequired({ DAYTHREAD_AUTH: 'off', VERCEL: '1' }), /refused on a hosting platform/)
  assert.equal(authRequired({ DAYTHREAD_AUTH: 'anything-else' }), true)
})

test('with sign-in off, only connections from this machine are served', async () => {
  const { fromThisMachine } = await import('../src/server/auth/server.ts')
  const req = (headers: Record<string, string> = {}) => new Request('http://127.0.0.1:3000/', { headers })
  for (const ip of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) assert.equal(fromThisMachine(req(), ip), true, ip)
  for (const ip of [undefined, '', '192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', '1127.0.0.1', '127.0.0.1.evil']) assert.equal(fromThisMachine(req(), ip), false, String(ip))
  assert.equal(fromThisMachine(req({ 'x-forwarded-for': '127.0.0.1' }), '127.0.0.1'), false, 'behind a proxy')
  assert.equal(fromThisMachine(req({ forwarded: 'for=1.2.3.4' }), '127.0.0.1'), false)
})

test('after sign-in, only a path on this site: nothing the browser would resolve to another origin', async () => {
  const { safeNext } = await import('../src/lib/safe-next.ts')
  const origin = 'https://daythread.example'
  for (const bad of [undefined, '', 'evil.example', '//evil.example', '/\\evil.example', '/\\/evil.example', '\\\\evil.example', 'https://evil.example/x', '/sign-in', '/sign-in?next=/x', 'javascript:alert(1)'])
    assert.equal(safeNext(bad, origin), '/', String(bad))
  assert.equal(safeNext('/tasks?view=today#x', origin), '/tasks?view=today#x')
  assert.equal(safeNext('/day/2026-10-22', origin), '/day/2026-10-22')
})

test('a session issued to an earlier owner is ended, not honoured, once OWNER_EMAIL changes', async () => {
  const { ownerSession, useSessionStore } = await import('../src/server/auth/server.ts')
  const db = await PGlite.create()
  const store = new SessionStore(pgliteClient(db))
  useSessionStore(store)
  const saved = { ...process.env }
  Object.assign(process.env, { SUPABASE_URL: 'https://auth.test', SUPABASE_PUBLISHABLE_KEY: 'pk', OWNER_EMAIL: 'owner@example.com' })
  try {
    const { token } = await store.create('u1', 'owner@example.com')
    assert.equal((await ownerSession(token))?.email, 'owner@example.com')
    process.env.OWNER_EMAIL = 'new-owner@example.com'
    assert.equal(await ownerSession(token), null)
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from daythread.sessions')).rows[0]!.n, 0, 'the old session row is gone')
  } finally { process.env = saved; useSessionStore(undefined); await db.close() }
})
