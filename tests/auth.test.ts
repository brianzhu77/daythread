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
const config = { supabaseUrl: 'https://auth.test', publishableKey: 'pk', secretKey: undefined, signUp: 'invite' as const, envInvites: [] as string[] }
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'

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

test('password: wrong and unknown are the same refusal; an unconfirmed address is told apart; Supabase down throws; its session is ended', async () => {
  const calls: string[] = []
  const ok = (email: string) => () => ({ status: 200, body: { access_token: 'at', user: { id: 'u-' + email, email } } })
  assert.deepEqual(await verifyPassword(config, ' Owner@Example.com ', 'pw', fakeFetch(ok('owner@example.com'), calls)), { ok: true, userId: 'u-owner@example.com', email: 'owner@example.com' })
  assert.deepEqual(calls, ['token?grant_type=password', 'logout?scope=local'])
  assert.deepEqual(await verifyPassword(config, 'other@example.com', 'pw', fakeFetch(ok('other@example.com'))), { ok: true, userId: 'u-other@example.com', email: 'other@example.com' }, 'any verified account passes the password check; the invite list is the server\'s')
  assert.deepEqual(await verifyPassword(config, 'owner@example.com', 'bad', fakeFetch(() => ({ status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } }))), { ok: false })
  assert.deepEqual(await verifyPassword(config, 'new@example.com', 'pw', fakeFetch(() => ({ status: 400, body: { error_code: 'email_not_confirmed', msg: 'Email not confirmed' } }))), { ok: false, reason: 'unconfirmed' })
  for (const status of [429, 500, 503]) await assert.rejects(verifyPassword(config, 'owner@example.com', 'pw', fakeFetch(() => ({ status, body: {} }))))
  const none: string[] = []
  for (const password of ['', 'x'.repeat(1025)]) assert.deepEqual(await verifyPassword(config, 'owner@example.com', password, fakeFetch(ok('owner@example.com'), none)), { ok: false })
  assert.equal(none.length, 0, 'an empty or oversized password never reaches Supabase')
})

test('sign-up call: a confirmation email, a session right away, an address already taken, a weak password; Supabase down throws', async () => {
  const { signUp } = await import('../src/server/auth/supabase.ts')
  const calls: string[] = []
  // Confirmation on: Supabase answers with the user and no session.
  assert.deepEqual(await signUp(config, ' New@Example.com ', 'pw-long-enough', 'Asia/Tokyo', fakeFetch(() => ({ status: 200, body: { id: 'u-new', email: 'new@example.com', confirmation_sent_at: '2026-10-26T00:00:00Z' } }), calls)), { outcome: 'confirm' })
  assert.deepEqual(calls, ['signup'])
  // Confirmation off: a session comes back; it is ended, ours is issued by the server.
  const withSession: string[] = []
  assert.deepEqual(await signUp(config, 'new@example.com', 'pw-long-enough', 'Asia/Tokyo', fakeFetch(() => ({ status: 200, body: { access_token: 'at', user: { id: 'u-new', email: 'new@example.com' } } }), withSession)), { outcome: 'session', userId: 'u-new', email: 'new@example.com' })
  assert.deepEqual(withSession, ['signup', 'logout?scope=local'])
  assert.deepEqual(await signUp(config, 'new@example.com', 'pw-long-enough', 'Asia/Tokyo', fakeFetch(() => ({ status: 422, body: { error_code: 'user_already_exists', msg: 'User already registered' } }))), { outcome: 'exists' })
  assert.deepEqual(await signUp(config, 'new@example.com', 'short', 'Asia/Tokyo', fakeFetch(() => ({ status: 422, body: { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' } }))), { outcome: 'weak', message: 'Password should be at least 6 characters.' })
  for (const status of [429, 500, 503]) await assert.rejects(signUp(config, 'new@example.com', 'pw-long-enough', 'Asia/Tokyo', fakeFetch(() => ({ status, body: {} }))))
  const none: string[] = []
  for (const password of ['', 'x'.repeat(1025)]) assert.deepEqual(await signUp(config, 'new@example.com', password, 'Asia/Tokyo', fakeFetch(() => ({ status: 200, body: {} }), none)), { outcome: 'weak', message: 'Use a longer password' })
  assert.equal(none.length, 0)
})

test('brake: after 5 failures each try waits, doubling to 15 min; refused tries never push it out; success clears', async () => {
  const db = await PGlite.create()
  const store = new SessionStore(pgliteClient(db))
  let clock = t0.getTime(), calls = 0
  const now = () => new Date(clock)
  const wrong = async () => { calls++; return 'fail' as const }, right = async () => { calls++; return 'ok' as const }
  for (let i = 0; i < freeFailures; i++) assert.deepEqual(await store.attempt(wrong, now), { outcome: 'fail', waitMs: 0 })
  assert.deepEqual(await store.attempt(wrong, now), { outcome: 'fail', waitMs: 30_000 }, '6th try waits 30 s')
  assert.equal(calls, freeFailures, 'a braked try never reaches Supabase')
  clock += 10_000
  assert.equal((await store.attempt(right, now)).waitMs, 20_000, 'refused tries record nothing: still 20 s left, not 30')
  clock += 20_000
  assert.deepEqual(await store.attempt(wrong, now), { outcome: 'fail', waitMs: 0 })
  assert.equal((await store.attempt(wrong, now)).waitMs, 60_000, 'doubles')
  for (let i = 0; i < 10; i++) { clock += maxWaitMs; await store.attempt(wrong, now) }
  assert.ok((await store.attempt(wrong, now)).waitMs <= maxWaitMs, 'never more than 15 min')
  clock += maxWaitMs
  assert.deepEqual(await store.attempt(right, now), { outcome: 'ok', waitMs: 0 })
  assert.deepEqual(await store.attempt(wrong, now), { outcome: 'fail', waitMs: 0 }, 'a success cleared the count')
  await db.close()
})

test('brake: simultaneous tries are taken one at a time, so only the free ones reach Supabase', async () => {
  const db = await PGlite.create()
  const store = new SessionStore(pgliteClient(db))
  let calls = 0
  const results = await Promise.all(Array.from({ length: 20 }, () => store.attempt(async () => { calls++; await new Promise(r => setTimeout(r, 5)); return 'fail' as const })))
  assert.equal(calls, freeFailures)
  assert.equal(results.filter(r => r.waitMs > 0).length, 20 - freeFailures)
  await db.close()
})

test('brake: a signed-in session keeps working while new sign-ins wait', async () => {
  const db = await PGlite.create()
  const store = new SessionStore(pgliteClient(db))
  const { token } = await store.create('u1', 'owner@example.com', t0)
  for (let i = 0; i <= freeFailures; i++) await store.attempt(async () => 'fail' as const, () => at(1000))
  assert.ok((await store.attempt(async () => 'ok' as const, () => at(2000))).waitMs > 0)
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

// The handlers, with the stores on PGlite and Supabase's answers injected (useSupabase). Requests are built as the
// browser sends them: a same-origin POST with a JSON body.
async function handlers(env: Record<string, string> = {}) {
  const server = await import('../src/server/auth/server.ts')
  const { PostgresWorkspaceRepository } = await import('../src/server/postgres-repository.ts')
  const { AccountStore } = await import('../src/server/auth/accounts.ts')
  const db = await PGlite.create(), sql = pgliteClient(db)
  const repo = new PostgresWorkspaceRepository(sql), sessions = new SessionStore(sql, 'daythread', { workspaces: 'daythread.workspaces' }), accounts = new AccountStore(sql)
  server.useSessionStore(sessions); server.useWorkspaceStore(repo); server.useAccountStore(accounts)
  const saved = { ...process.env }
  for (const key of ['OWNER_EMAIL', 'DAYTHREAD_SIGNUP', 'DAYTHREAD_INVITES', 'SUPABASE_SECRET_KEY']) delete process.env[key]
  Object.assign(process.env, { SUPABASE_URL: 'https://auth.test', SUPABASE_PUBLISHABLE_KEY: 'pk', ...env })
  const supabase = { verified: new Map<string, string>(), signUpOutcome: { outcome: 'confirm' } as Awaited<ReturnType<typeof import('../src/server/auth/supabase.ts')['signUp']>>, deleted: [] as string[], signUpCalls: 0 }
  server.useSupabase({
    verifyPassword: async (_c, email, password) => password === 'right' && supabase.verified.has(email.trim().toLowerCase()) ? { ok: true, userId: supabase.verified.get(email.trim().toLowerCase())!, email: email.trim().toLowerCase() } : { ok: false },
    signUp: async () => { supabase.signUpCalls++; return supabase.signUpOutcome },
    deleteUser: async (_c, userId) => { supabase.deleted.push(userId) },
  })
  const post = (path: string, body: unknown, cookie?: string) => new Request(`https://app.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie: `__Host-daythread_session=${cookie}` } : {}) }, body: JSON.stringify(body) })
  const cookieOf = (r: Response) => /__Host-daythread_session=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1]
  const count = async (table: string) => (await sql.query<{ n: number }>(`select count(*)::int as n from daythread.${table}`))[0]!.n
  const close = async () => { process.env = saved; server.useSessionStore(undefined); server.useWorkspaceStore(undefined); server.useAccountStore(undefined); server.useSupabase(undefined); await db.close() }
  return { server, repo, sessions, accounts, sql, supabase, post, cookieOf, count, close }
}

test('sign-in: an invited address gets its account and workspace on first sign-in, in the browser\'s time zone; a second sign-in reuses them; the invite is marked used', async () => {
  const h = await handlers()
  try {
    h.supabase.verified.set('brian@example.com', A)
    await h.accounts.invite('Brian@Example.com ')
    const r = await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'brian@example.com', password: 'right', timezone: 'America/Vancouver' }))
    assert.equal(r.status, 200)
    const token = h.cookieOf(r)!
    assert.ok(token)
    assert.equal((await h.server.ownerSession(token))?.email, 'brian@example.com')
    assert.equal(await h.count('workspaces'), 1); assert.equal(await h.count('accounts'), 1)
    assert.equal(await h.repo.timezoneOf(A), 'America/Vancouver')
    assert.ok((await h.sql.query<{ used_at: string | null }>("select used_at from daythread.invites where email = 'brian@example.com'"))[0]!.used_at)
    const again = await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'brian@example.com', password: 'right', timezone: 'Asia/Tokyo' }))
    assert.equal(again.status, 200)
    assert.equal(await h.count('workspaces'), 1, 'the same workspace')
    assert.equal(await h.repo.timezoneOf(A), 'America/Vancouver', 'the time zone is set at the first sign-in only')
    assert.equal(await h.count('sessions'), 2)
    const wrong = await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'brian@example.com', password: 'wrong' }))
    assert.equal(wrong.status, 401); assert.equal(((await wrong.json()) as { error: string }).error, 'wrong')
  } finally { await h.close() }
})

test('sign-in: a verified address that is not invited is refused and nothing is created; the invite list also reads DAYTHREAD_INVITES; DAYTHREAD_SIGNUP=open lets anyone in', async () => {
  const h = await handlers()
  try {
    h.supabase.verified.set('other@example.com', B)
    const r = await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'other@example.com', password: 'right' }))
    assert.equal(r.status, 403); assert.equal(((await r.json()) as { error: string }).error, 'not-invited')
    assert.equal(h.cookieOf(r), undefined)
    assert.equal(await h.count('workspaces'), 0); assert.equal(await h.count('sessions'), 0)
    process.env.DAYTHREAD_INVITES = 'someone@example.com, Other@Example.com'
    assert.equal((await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'other@example.com', password: 'right' }))).status, 200)
    assert.equal(await h.count('workspaces'), 1)
    delete process.env.DAYTHREAD_INVITES
    h.supabase.verified.set('anyone@example.com', A)
    assert.equal((await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'anyone@example.com', password: 'right' }))).status, 403)
    process.env.DAYTHREAD_SIGNUP = 'open'
    assert.equal((await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'anyone@example.com', password: 'right' }))).status, 200)
    assert.equal(await h.count('workspaces'), 2)
  } finally { await h.close() }
})

test('sign-in: an account whose email is not confirmed yet is told so, not "wrong"; Supabase down is 503', async () => {
  const h = await handlers()
  try {
    h.server.useSupabase({ verifyPassword: async () => ({ ok: false, reason: 'unconfirmed' }), signUp: async () => ({ outcome: 'confirm' }), deleteUser: async () => undefined })
    const r = await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'new@example.com', password: 'right' }))
    assert.equal(r.status, 401); assert.equal(((await r.json()) as { error: string }).error, 'unconfirmed')
    h.server.useSupabase({ verifyPassword: async () => { throw new Error('Supabase Auth 503') }, signUp: async () => ({ outcome: 'confirm' }), deleteUser: async () => undefined })
    assert.equal((await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'new@example.com', password: 'right' }))).status, 503)
  } finally { await h.close() }
})

test('sign-up: an uninvited address never reaches Supabase; invited: a confirmation to wait for, or a session and the workspace right away; taken and weak are told apart', async () => {
  const h = await handlers()
  try {
    const r = await h.server.handleSignUp(h.post('/api/auth/sign-up', { email: 'new@example.com', password: 'pw-long-enough', timezone: 'Asia/Tokyo' }))
    assert.equal(r.status, 403); assert.equal(((await r.json()) as { error: string }).error, 'not-invited'); assert.equal(h.supabase.signUpCalls, 0)
    await h.accounts.invite('new@example.com')
    const confirm = await h.server.handleSignUp(h.post('/api/auth/sign-up', { email: 'new@example.com', password: 'pw-long-enough', timezone: 'Asia/Tokyo' }))
    assert.equal(confirm.status, 200); assert.deepEqual(await confirm.json(), { ok: true, confirm: true })
    assert.equal(h.cookieOf(confirm), undefined); assert.equal(await h.count('workspaces'), 0, 'the workspace is made at the first sign-in')
    h.supabase.signUpOutcome = { outcome: 'session', userId: A, email: 'new@example.com' }
    const now = await h.server.handleSignUp(h.post('/api/auth/sign-up', { email: 'new@example.com', password: 'pw-long-enough', timezone: 'Asia/Tokyo' }))
    assert.equal(now.status, 200); assert.deepEqual(await now.json(), { ok: true })
    assert.ok(h.cookieOf(now)); assert.equal(await h.count('workspaces'), 1); assert.equal(await h.repo.timezoneOf(A), 'Asia/Tokyo')
    h.supabase.signUpOutcome = { outcome: 'exists' }
    const taken = await h.server.handleSignUp(h.post('/api/auth/sign-up', { email: 'new@example.com', password: 'pw-long-enough' }))
    assert.equal(taken.status, 409); assert.equal(((await taken.json()) as { error: string }).error, 'exists')
    h.supabase.signUpOutcome = { outcome: 'weak', message: 'Password should be at least 6 characters.' }
    const weak = await h.server.handleSignUp(h.post('/api/auth/sign-up', { email: 'new@example.com', password: 'x' }))
    assert.equal(weak.status, 400); assert.deepEqual(await weak.json(), { ok: false, error: 'weak', message: 'Password should be at least 6 characters.' })
    const bad = await h.server.handleSignUp(h.post('/api/auth/sign-up', { email: 'not an address', password: 'pw-long-enough' }))
    assert.equal(bad.status, 400)
    process.env.DAYTHREAD_SIGNUP = 'open'
    h.supabase.signUpOutcome = { outcome: 'confirm' }
    assert.equal((await h.server.handleSignUp(h.post('/api/auth/sign-up', { email: 'anyone@example.com', password: 'pw-long-enough' }))).status, 200)
  } finally { await h.close() }
})

test('sessions: a session whose account has no workspace any more is ended, not honoured', async () => {
  const h = await handlers()
  try {
    h.supabase.verified.set('brian@example.com', A)
    await h.accounts.invite('brian@example.com')
    const token = h.cookieOf(await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'brian@example.com', password: 'right' })))!
    assert.equal((await h.server.ownerSession(token))?.workspaceId, (await h.repo.workspaceOf(A))!.id)
    await h.sql.transaction(tx => h.repo.deleteWorkspace(tx, A))
    assert.equal(await h.server.ownerSession(token), null)
    assert.equal(await h.count('sessions'), 0, 'the session row is gone')
  } finally { await h.close() }
})

test('delete account: the wrong password changes nothing; the right one removes the workspace, the account and every session, and the Supabase login when the secret key is set', async () => {
  const h = await handlers()
  try {
    h.supabase.verified.set('brian@example.com', A); h.supabase.verified.set('other@example.com', B)
    await h.accounts.invite('brian@example.com'); await h.accounts.invite('other@example.com')
    const token = h.cookieOf(await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'brian@example.com', password: 'right' })))!
    const second = h.cookieOf(await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'brian@example.com', password: 'right' })))!
    const otherToken = h.cookieOf(await h.server.handleSignIn(h.post('/api/auth/sign-in', { email: 'other@example.com', password: 'right' })))!
    const { asOwner } = await import('../src/server/auth/request-owner.ts')
    await asOwner(A, () => h.repo.execute({ operationId: 'd', expectedRevision: 0, action: { type: 'ensure-day', date: '2026-10-22' } }))
    const wrong = await h.server.handleDeleteAccount(h.post('/api/auth/delete-account', { password: 'wrong' }, token))
    assert.equal(wrong.status, 401)
    assert.equal(await h.count('workspaces'), 2); assert.equal(await h.count('pages'), 1); assert.equal(await h.count('sessions'), 3)
    const signedOut = await h.server.handleDeleteAccount(h.post('/api/auth/delete-account', { password: 'right' }))
    assert.equal(signedOut.status, 401, 'no session, nothing to delete')
    const r = await h.server.handleDeleteAccount(h.post('/api/auth/delete-account', { password: 'right' }, token))
    assert.equal(r.status, 200)
    assert.match(r.headers.get('set-cookie') ?? '', /Max-Age=0/)
    assert.equal(await h.count('workspaces'), 1); assert.equal(await h.count('pages'), 0); assert.equal(await h.count('accounts'), 1)
    assert.equal(await h.server.ownerSession(second), null, 'every session of the account is gone')
    assert.ok(await h.server.ownerSession(otherToken), 'the other account is untouched')
    assert.deepEqual(h.supabase.deleted, [], 'no secret key: the login stays')
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
    const r2 = await h.server.handleDeleteAccount(h.post('/api/auth/delete-account', { password: 'right' }, otherToken))
    assert.equal(r2.status, 200)
    assert.deepEqual(h.supabase.deleted, [B])
    assert.equal(await h.count('workspaces'), 0)
  } finally { await h.close() }
})
