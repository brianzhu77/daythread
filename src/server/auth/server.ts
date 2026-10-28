// Server side of sign-in: the gate's checks, the session cookie, and the /api/auth handlers (sign-in, sign-up,
// sign-out, delete-account). Shot 2: any account on the invite list (or anyone, with DAYTHREAD_SIGNUP=open) may come
// in; the first sign-in makes its account row and its workspace.
import { getCookie, appendResponseHeader, getRequestIP } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getRepository, postgresSql } from '../storage.ts'
import { PostgresWorkspaceRepository, schemaName } from '../postgres-repository.ts'
import type { SqlClient } from '../db/sql.ts'
import { validTimezone } from '../../domain/workspace.ts'
import { authConfig, authRequired, normalizeEmail, type AuthConfig } from './config.ts'
import { AccountStore } from './accounts.ts'
import { SessionStore, type CheckedSession, type Outcome } from './sessions.ts'
import * as supabaseAuth from './supabase.ts'
import type { ResetResult, SignUpResult, VerifyResult } from './supabase.ts'

/** Reachable without a session: the sign-in and sign-up screens and the calls they make; build assets are public code. */
// /api/push/tick is the scheduler's, let in by CRON_SECRET; /sw.js is the service worker, fetched by the browser itself.
const publicPaths = new Set(['/sign-in', '/sign-up', '/api/auth/sign-in', '/api/auth/sign-up', '/api/auth/sign-out', '/api/auth/recover', '/api/auth/resend', '/api/auth/reset-password', '/api/auth/confirm', '/api/push/tick'])
const isPublic = (path: string) => publicPaths.has(path) || path.startsWith('/assets/') || path.startsWith('/splash/') || /^\/[\w-]+\.(ico|png|svg|webmanifest|js|html)$/.test(path)

let store: SessionStore | undefined
export const sessions = () => store ??= new SessionStore(postgresSql(), schemaName(), { workspaces: `${schemaName()}.workspaces` })
let accountStore: AccountStore | undefined
export const accounts = () => accountStore ??= new AccountStore(postgresSql(), schemaName())
let repo: PostgresWorkspaceRepository | undefined
/** Sign-in needs the Postgres store: sessions and accounts sit beside the workspaces. */
function workspaceStore(): PostgresWorkspaceRepository {
  if (repo) return repo
  const r = getRepository()
  if (!(r instanceof PostgresWorkspaceRepository)) throw new Error('Sign-in needs DAYTHREAD_STORAGE=postgres')
  return repo = r
}
/** Supabase's calls, replaceable in tests. */
interface Supabase {
  verifyPassword(config: AuthConfig, email: string, password: string): Promise<VerifyResult>
  signUp(config: AuthConfig, email: string, password: string, timezone: string | undefined): Promise<SignUpResult>
  deleteUser(config: AuthConfig, userId: string): Promise<void>
  recover(config: AuthConfig, email: string): Promise<void>
  resendConfirmation(config: AuthConfig, email: string): Promise<'sent' | 'wait'>
  resetPassword(config: AuthConfig, accessToken: string, password: string): Promise<ResetResult>
  userFromToken(config: AuthConfig, accessToken: string): Promise<{ userId: string; email: string } | null>
}
let supabase: Supabase = supabaseAuth
/** For tests: a workspace store on another database. */
export function useWorkspaceStore(next: PostgresWorkspaceRepository | undefined): void { repo = next }
/** For tests: a session store on another database. */
export function useSessionStore(next: SessionStore | undefined): void { store = next }
/** For tests: an account store on another database. */
export function useAccountStore(next: AccountStore | undefined): void { accountStore = next }
/** For tests: Supabase's answers. */
export function useSupabase(next: Supabase | undefined): void { supabase = next ?? supabaseAuth }

const secure = (request: Request) => new URL(request.url).protocol === 'https:'
/** `__Host-` pins the cookie to this exact host over HTTPS; plain http (the Mac's 127.0.0.1) can't use it. */
export const cookieName = (request: Request) => secure(request) ? '__Host-daythread_session' : 'daythread_session'
export function sessionCookie(request: Request, token: string, expiresAt: Date | null): string {
  const maxAge = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) : 0
  return `${cookieName(request)}=${expiresAt ? token : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(request) ? '; Secure' : ''}`
}
function tokenOf(request: Request): string | undefined {
  const name = cookieName(request)
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}

/**
 * Writes only from this site: a browser always sends Sec-Fetch-Site or Origin on a POST, so a write with neither, or
 * from another site, is refused. SameSite=Lax already keeps the cookie off cross-site POSTs; this is the second lock.
 */
export function sameOrigin(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true
  const site = request.headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin'
  const origin = request.headers.get('origin')
  return origin !== null && origin === new URL(request.url).origin
}

/**
 * With sign-in off (DAYTHREAD_AUTH=off, the Mac's 3000), only connections from this machine are served, whatever
 * address the server was started on; anything through a proxy or from another device is refused (Bumblebee 71719581).
 * Fails closed when the connection's address is unknown.
 */
export function fromThisMachine(request: Request, ip: string | undefined): boolean {
  if (request.headers.has('x-forwarded-for') || request.headers.has('forwarded')) return false
  return !!ip && /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/.test(ip)
}

/**
 * A response that stops the request, or what to let it through with: the account it was signed in as, under which
 * the workspace store reads and writes (none with sign-in off, or on the public sign-in paths).
 */
export async function checkRequest(request: Request, handlerType: 'serverFn' | 'router'): Promise<Response | { owner?: string }> {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 })
  if (!authRequired()) return fromThisMachine(request, getRequestIP()) ? {} : new Response('Sign-in is off: this machine only', { status: 403 })
  const url = new URL(request.url)
  if (isPublic(url.pathname)) return {}
  const session = await ownerSession(tokenOf(request))
  if (session) {
    if (session.renewed) appendResponseHeader('set-cookie', sessionCookie(request, tokenOf(request)!, session.expiresAt))
    return { owner: session.userId }
  }
  if (handlerType === 'serverFn' || url.pathname.startsWith('/api/') || request.method !== 'GET')
    return Response.json({ error: 'signed-out' }, { status: 401 })
  return new Response(null, { status: 302, headers: { location: `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`, 'cache-control': 'no-store' } })
}

/**
 * A live session whose account still has its workspace, read in the same query. A session of an account whose
 * workspace is gone (the account was deleted) is ended rather than honoured.
 */
export async function ownerSession(token: string | undefined): Promise<CheckedSession | null> {
  if (!token) return null
  await Promise.all([workspaceStore().prepare(), accounts().prepare(), sessions().prepare()])
  const session = await sessions().check(token)
  if (!session) return null
  if (session.workspaceId !== null) return session
  await sessions().delete(token)
  return null
}

/** The signed-in account for the account row: its address and time zone; null when sign-in is off or the session is gone. */
export async function currentAccount(): Promise<{ email: string; timezone: string } | null> {
  if (!authRequired()) return null
  const name = secureCookieNames.find(n => getCookie(n))
  const session = name ? await ownerSession(getCookie(name)) : null
  if (!session) return null
  return { email: session.email, timezone: (await workspaceStore().timezoneOf(session.userId)) ?? 'UTC' }
}
const secureCookieNames = ['__Host-daythread_session', 'daythread_session']

// Per-address brake on sign-in tries (failed or not) within one instance; the global failure backoff is in the store.
const tries = new Map<string, number[]>()
const ipWindowMs = 10 * 60_000, ipLimit = 30
function ipWaitMs(ip: string, now = Date.now()): number {
  const recent = (tries.get(ip) ?? []).filter(t => now - t < ipWindowMs)
  if (recent.length >= ipLimit) { tries.set(ip, recent); return recent[0]! + ipWindowMs - now }
  recent.push(now); tries.set(ip, recent)
  return 0
}
/** For tests: the per-address brake starts over. */
export function resetTries(): void { tries.clear() }
const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local'

const email = z.string().trim().email().max(320), password = z.string().min(1).max(1024)
const timezone = z.string().max(100).optional()
const signInBody = z.object({ email, password, timezone })
const signUpBody = z.object({ email, password, timezone })
const deleteBody = z.object({ password })
const recoverBody = z.object({ email })
const tokenBody = z.object({ accessToken: z.string().min(1).max(4096), timezone })
const resetBody = z.object({ accessToken: z.string().min(1).max(4096), password, timezone })
const noStore = { 'cache-control': 'no-store' }
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ ok: false, error, ...extra }, { status, headers: noStore })
/**
 * "Couldn't sign in · Try again" on the screen is this 503: Supabase or Postgres could not be reached, or the
 * environment is missing a value. The cause goes to the server log (Vercel's runtime logs), never to the browser.
 */
const unavailable = (handler: string, error: unknown) => {
  console.error(JSON.stringify({ level: 'error', event: 'auth.unavailable', handler, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : String(error).slice(0, 300), cause: error instanceof Error && error.cause instanceof Error ? error.cause.message.slice(0, 200) : undefined }))
  return refuse(503, 'unavailable')
}
const tooMany = (ms: number) => refuse(429, 'too-many', { retryAfter: Math.ceil(ms / 1000) })
/** The browser's zone when it is one the runtime knows; UTC otherwise. */
function zoneOf(value: string | undefined): string { try { return validTimezone(value ?? '') } catch { return 'UTC' } }

/** Whether an address may come in: anyone with sign-up open, else the invite list. */
async function allowed(config: AuthConfig, address: string, tx?: SqlClient): Promise<boolean> {
  return config.signUp === 'open' || accounts().invited(address, config.envInvites, tx)
}
/** The account's row and workspace, made at its first sign-in; a session on top. */
async function admit(tx: SqlClient, userId: string, address: string, zone: string): Promise<{ token: string; expiresAt: Date }> {
  await accounts().ensureAccount(tx, userId, address)
  await workspaceStore().createWorkspace(tx, userId, zone)
  return sessions().create(userId, address, new Date(), tx)
}

/**
 * Email + password. A wrong password and an unknown address are one identical 401; an address whose email is not
 * confirmed yet is 401 'unconfirmed'; a verified login that is not invited is 403 'not-invited' (counted neither way);
 * a brake is 429 with the real wait; Supabase unreachable is 503. The password is never logged or echoed. The first
 * sign-in makes the account and its workspace, in the same transaction as the session, so nothing is left half done.
 */
export async function handleSignIn(request: Request): Promise<Response> {
  const body = signInBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return refuse(401, 'wrong')
  const ipWait = ipWaitMs(clientIp(request))
  if (ipWait > 0) return tooMany(ipWait)
  let issued: { token: string; expiresAt: Date } | undefined, refusal: 'unconfirmed' | 'not-invited' | undefined, attempt
  try {
    const config = authConfig()
    await Promise.all([workspaceStore().prepare(), accounts().prepare(), sessions().prepare()])
    attempt = await sessions().attempt(async (tx): Promise<Outcome> => {
      const result = await supabase.verifyPassword(config, body.data.email, body.data.password)
      if (!result.ok) { if (result.reason === 'unconfirmed') { refusal = 'unconfirmed'; return 'neutral' } return 'fail' }
      // Known: an account row, or a workspace without one (the one migrated from shot 1 gets its account row now).
      const known = (await accounts().account(result.userId, tx)) ?? (await workspaceStore().workspaceOf(result.userId, tx))
      if (!known && !(await allowed(config, result.email, tx))) { refusal = 'not-invited'; return 'neutral' }
      issued = await admit(tx, result.userId, result.email, zoneOf(body.data.timezone))
      return 'ok'
    })
  } catch (error) { return unavailable('handleSignIn', error) }
  if (attempt.waitMs > 0) return tooMany(attempt.waitMs)
  if (refusal === 'unconfirmed') return refuse(401, 'unconfirmed')
  if (refusal === 'not-invited') return refuse(403, 'not-invited')
  if (attempt.outcome !== 'ok' || !issued) return refuse(401, 'wrong')
  return Response.json({ ok: true }, { headers: { ...noStore, 'set-cookie': sessionCookie(request, issued.token, issued.expiresAt) } })
}

/**
 * A new login, for an invited address (or anyone, with sign-up open): the invite list is checked before Supabase is
 * called, so an uninvited address learns nothing and costs nothing. Supabase then either sends its confirmation
 * email (`confirm`: sign in after clicking it) or, with confirmation off, opens the login now, and the account,
 * workspace and session are made at once.
 */
export async function handleSignUp(request: Request): Promise<Response> {
  const body = signUpBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return refuse(400, 'invalid')
  const ipWait = ipWaitMs(clientIp(request))
  if (ipWait > 0) return tooMany(ipWait)
  const address = normalizeEmail(body.data.email)
  let result: SignUpResult, issued: { token: string; expiresAt: Date } | undefined
  try {
    const config = authConfig()
    await Promise.all([workspaceStore().prepare(), accounts().prepare(), sessions().prepare()])
    if (!(await allowed(config, address))) return refuse(403, 'not-invited')
    result = await supabase.signUp(config, address, body.data.password, body.data.timezone)
    if (result.outcome === 'session') {
      const { userId, email: verified } = result
      issued = await sessions().transaction(tx => admit(tx, userId, verified, zoneOf(body.data.timezone)))
    }
  } catch (error) { return unavailable('handleSignUp', error) }
  if (result.outcome === 'exists') return refuse(409, 'exists')
  if (result.outcome === 'weak') return refuse(400, 'weak', { message: result.message })
  if (result.outcome === 'confirm') return Response.json({ ok: true, confirm: true }, { headers: noStore })
  return Response.json({ ok: true }, { headers: { ...noStore, 'set-cookie': sessionCookie(request, issued!.token, issued!.expiresAt) } })
}
export async function handleSignOut(request: Request): Promise<Response> {
  await sessions().delete(tokenOf(request))
  return Response.json({ ok: true }, { headers: { ...noStore, 'set-cookie': sessionCookie(request, '', null) } })
}

/**
 * The account's own delete, with the password typed again: the workspace's rows, the account row and every session
 * go in one transaction; the Supabase login goes too when the secret key is set (best effort, after the rows).
 */
export async function handleDeleteAccount(request: Request): Promise<Response> {
  const session = await ownerSession(tokenOf(request))
  if (!session) return refuse(401, 'signed-out')
  const body = deleteBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return refuse(401, 'wrong')
  const ipWait = ipWaitMs(clientIp(request))
  if (ipWait > 0) return tooMany(ipWait)
  let attempt, config: AuthConfig
  try {
    config = authConfig()
    attempt = await sessions().attempt(async (tx): Promise<Outcome> => {
      const result = await supabase.verifyPassword(config, session.email, body.data.password)
      if (!result.ok || result.userId !== session.userId) return 'fail'
      await workspaceStore().deleteWorkspace(tx, session.userId)
      await accounts().deleteAccount(tx, session.userId)
      await sessions().deleteAll(session.userId, tx)
      return 'ok'
    })
  } catch (error) { return unavailable('handleDeleteAccount', error) }
  if (attempt.waitMs > 0) return tooMany(attempt.waitMs)
  if (attempt.outcome !== 'ok') return refuse(401, 'wrong')
  let login: 'deleted' | 'kept' = 'kept'
  if (config.secretKey) { try { await supabase.deleteUser(config, session.userId); login = 'deleted' } catch (error) { console.error(JSON.stringify({ level: 'error', event: 'auth.delete-login', error: error instanceof Error ? error.message : String(error) })) } }
  return Response.json({ ok: true, login }, { headers: { ...noStore, 'set-cookie': sessionCookie(request, '', null) } })
}

/**
 * Forgot password: Supabase sends its recovery email. The answer is the same whatever the address, so nothing is
 * learned here; the per-address brake applies as to a sign-in.
 */
export async function handleRecover(request: Request): Promise<Response> {
  const body = recoverBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return refuse(400, 'invalid')
  const ipWait = ipWaitMs(clientIp(request))
  if (ipWait > 0) return tooMany(ipWait)
  try { await supabase.recover(authConfig(), body.data.email) } catch (error) { return unavailable('handleRecover', error) }
  return Response.json({ ok: true }, { headers: noStore })
}

/**
 * "Send the link again", offered only after sign-in said the address is unconfirmed (so the right password was typed)
 * and on the sign-up wait. Supabase sends only to an unconfirmed login and answers the same for any other address;
 * 429 'too-soon' is its once-a-minute limit for that address, apart from this server's own brake.
 */
export async function handleResend(request: Request): Promise<Response> {
  const body = recoverBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return refuse(400, 'invalid')
  const ipWait = ipWaitMs(clientIp(request))
  if (ipWait > 0) return tooMany(ipWait)
  let sent: 'sent' | 'wait'
  try { sent = await supabase.resendConfirmation(authConfig(), body.data.email) } catch (error) { return unavailable('handleResend', error) }
  return sent === 'wait' ? refuse(429, 'too-soon') : Response.json({ ok: true }, { headers: noStore })
}

/** A login the emailed link vouched for comes in: the account and workspace on first entry (invite list permitting), every older session ended, a fresh one issued. */
async function enter(request: Request, userId: string, address: string, zone: string, endOthers: boolean): Promise<Response> {
  const config = authConfig()
  const known = (await accounts().account(userId)) ?? (await workspaceStore().workspaceOf(userId))
  if (!known && !(await allowed(config, address))) return refuse(403, 'not-invited')
  const issued = await sessions().transaction(async tx => {
    if (endOthers) await sessions().deleteAll(userId, tx)
    return admit(tx, userId, address, zone)
  })
  return Response.json({ ok: true }, { headers: { ...noStore, 'set-cookie': sessionCookie(request, issued.token, issued.expiresAt) } })
}

/**
 * The new password, with the token the recovery link carried in its fragment. Supabase sets it; the person is then
 * signed in here with every older session gone (a reset is the moment to drop any stray one). A stale link is 401
 * 'expired'; a password Supabase refuses is 400 'weak' with its reason.
 */
export async function handleResetPassword(request: Request): Promise<Response> {
  const body = resetBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return refuse(400, 'invalid')
  const ipWait = ipWaitMs(clientIp(request))
  if (ipWait > 0) return tooMany(ipWait)
  let result: ResetResult
  try {
    await Promise.all([workspaceStore().prepare(), accounts().prepare(), sessions().prepare()])
    result = await supabase.resetPassword(authConfig(), body.data.accessToken, body.data.password)
    if (!result.ok) return result.reason === 'weak' ? refuse(400, 'weak', { message: result.message }) : result.reason === 'same' ? refuse(400, 'same') : refuse(401, 'expired')
    return await enter(request, result.userId, result.email, zoneOf(body.data.timezone), true)
  } catch (error) { return unavailable('handleResetPassword', error) }
}

/** The confirmation link's landing: the token in its fragment names the login, which comes in without typing the password again. */
export async function handleConfirm(request: Request): Promise<Response> {
  const body = tokenBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return refuse(400, 'invalid')
  const ipWait = ipWaitMs(clientIp(request))
  if (ipWait > 0) return tooMany(ipWait)
  try {
    await Promise.all([workspaceStore().prepare(), accounts().prepare(), sessions().prepare()])
    const user = await supabase.userFromToken(authConfig(), body.data.accessToken)
    if (!user) return refuse(401, 'expired')
    return await enter(request, user.userId, user.email, zoneOf(body.data.timezone), false)
  } catch (error) { return unavailable('handleConfirm', error) }
}
