import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { pgliteClient } from '../src/server/db/sql.ts'
import { SessionStore, absoluteMs, renewEveryMs, slidingMs } from '../src/server/auth/sessions.ts'
import { sendCode, verifyCode } from '../src/server/auth/supabase.ts'
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

test('send: an unknown address and the per-address cooldown look like a send; failures for everyone are failures', async () => {
  const cases: [Reply, 'sent' | 'failed'][] = [
    [{ status: 200, body: {} }, 'sent'],
    [{ status: 422, body: { error_code: 'otp_disabled', msg: 'Signups not allowed for otp' } }, 'sent'],
    [{ status: 429, body: { error_code: 'over_request_rate_limit', msg: 'For security purposes, you can only request this after 41 seconds.' } }, 'sent'],
    [{ status: 429, body: { error_code: 'over_email_send_rate_limit', msg: 'Email rate limit exceeded' } }, 'failed'],
    [{ status: 500, body: {} }, 'failed'],
  ]
  for (const [reply, expected] of cases) assert.equal(await sendCode(config, 'x@example.com', fakeFetch(() => reply)), expected, JSON.stringify(reply))
  assert.equal(await sendCode(config, 'x@example.com', (async () => { throw new Error('network') }) as typeof fetch), 'failed')
  let sent: Record<string, unknown> = {}
  await sendCode(config, ' Owner@Example.com ', fakeFetch((_p, b) => { sent = b; return { status: 200, body: {} } }))
  assert.deepEqual(sent, { email: 'owner@example.com', create_user: false }, 'never creates an account')
})

test('verify: wrong, expired, malformed and non-owner codes are all the same refusal; Supabase\'s session is ended', async () => {
  const calls: string[] = []
  const ok = (email: string) => () => ({ status: 200, body: { access_token: 'at', user: { id: 'u-' + email, email } } })
  assert.deepEqual(await verifyCode(config, 'owner@example.com', '123456', fakeFetch(ok('Owner@example.com'), calls)), { ok: true, userId: 'u-Owner@example.com', email: 'owner@example.com' })
  assert.ok(calls.includes('logout?scope=local'))
  assert.deepEqual(await verifyCode(config, 'other@example.com', '123456', fakeFetch(ok('other@example.com'))), { ok: false })
  assert.deepEqual(await verifyCode(config, 'owner@example.com', '123456', fakeFetch(() => ({ status: 403, body: { error_code: 'otp_expired', msg: 'Token has expired or is invalid' } }))), { ok: false })
  const none: string[] = []
  for (const code of ['12345', '1234567', 'abcdef', '']) assert.deepEqual(await verifyCode(config, 'owner@example.com', code, fakeFetch(ok('owner@example.com'), none)), { ok: false })
  assert.equal(none.length, 0, 'a malformed code never reaches Supabase')
})

test('sign-in can be switched off only off a hosting platform', () => {
  assert.equal(authRequired({}), true)
  assert.equal(authRequired({ DAYTHREAD_AUTH: 'off' }), false)
  assert.throws(() => authRequired({ DAYTHREAD_AUTH: 'off', VERCEL: '1' }), /refused on a hosting platform/)
  assert.equal(authRequired({ DAYTHREAD_AUTH: 'anything-else' }), true)
})
