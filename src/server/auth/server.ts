// Server side of sign-in: the gate's checks, the session cookie, and the /api/auth handlers.
import { getCookie, appendResponseHeader, getRequestIP } from '@tanstack/react-start/server'
import { z } from 'zod'
import { postgresSql } from '../storage.ts'
import { authConfig, authRequired } from './config.ts'
import { SessionStore, type CheckedSession } from './sessions.ts'
import { sendCode, verifyCode } from './supabase.ts'

/** Reachable without a session: the sign-in screen and the calls it makes; build assets are public code. */
const publicPaths = new Set(['/sign-in', '/api/auth/send', '/api/auth/verify', '/api/auth/sign-out'])
const isPublic = (path: string) => publicPaths.has(path) || path.startsWith('/assets/') || /^\/[\w-]+\.(ico|png|svg|webmanifest)$/.test(path)

let store: SessionStore | undefined
export const sessions = () => store ??= new SessionStore(postgresSql())
/** For tests: a store on another database. */
export function useSessionStore(next: SessionStore | undefined): void { store = next }

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

/** A response that stops the request, or undefined to let it through. */
export async function checkRequest(request: Request, handlerType: 'serverFn' | 'router'): Promise<Response | undefined> {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 })
  if (!authRequired()) return fromThisMachine(request, getRequestIP()) ? undefined : new Response('Sign-in is off: this machine only', { status: 403 })
  const url = new URL(request.url)
  if (isPublic(url.pathname)) return undefined
  const session = await ownerSession(tokenOf(request))
  if (session) {
    if (session.renewed) appendResponseHeader('set-cookie', sessionCookie(request, tokenOf(request)!, session.expiresAt))
    return undefined
  }
  if (handlerType === 'serverFn' || url.pathname.startsWith('/api/') || request.method !== 'GET')
    return Response.json({ error: 'signed-out' }, { status: 401 })
  return new Response(null, { status: 302, headers: { location: `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`, 'cache-control': 'no-store' } })
}

/**
 * A live session that still belongs to the current owner. If OWNER_EMAIL has changed since it was issued, the session
 * is ended rather than honoured (Ratchet 4f235d84).
 */
export async function ownerSession(token: string | undefined): Promise<CheckedSession | null> {
  const session = await sessions().check(token)
  if (!session) return null
  if (session.email === authConfig().ownerEmail) return session
  await sessions().delete(token)
  return null
}

/** The signed-in address, for "{email} · Sign out"; null when sign-in is off or the session is gone. */
export async function currentEmail(): Promise<string | null> {
  if (!authRequired()) return null
  const name = secureCookieNames.find(n => getCookie(n))
  const session = name ? await ownerSession(getCookie(name)) : null
  return session?.email ?? null
}
const secureCookieNames = ['__Host-daythread_session', 'daythread_session']

// Per-instance brake on code requests from one address; Supabase's own limits stay the real ones.
const sends = new Map<string, number[]>()
function tooMany(ip: string, now = Date.now()): boolean {
  const recent = (sends.get(ip) ?? []).filter(t => now - t < 10 * 60_000)
  recent.push(now); sends.set(ip, recent)
  return recent.length > 5
}
const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local'

const emailBody = z.object({ email: z.string().trim().email().max(320) })
const verifyBody = emailBody.extend({ code: z.string().trim().regex(/^\d{6}$/) })
const noStore = { 'cache-control': 'no-store' }

export async function handleSend(request: Request): Promise<Response> {
  const body = emailBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ ok: false, error: 'invalid-email' }, { status: 400, headers: noStore })
  if (tooMany(clientIp(request))) return Response.json({ ok: false, error: 'send-failed' }, { status: 429, headers: noStore })
  const result = await sendCode(authConfig(), body.data.email)
  return result === 'sent' ? Response.json({ ok: true }, { headers: noStore }) : Response.json({ ok: false, error: 'send-failed' }, { status: 503, headers: noStore })
}

export async function handleVerify(request: Request): Promise<Response> {
  const body = verifyBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ ok: false, error: 'wrong-code' }, { status: 401, headers: noStore })
  let result
  try { result = await verifyCode(authConfig(), body.data.email, body.data.code) }
  catch { return Response.json({ ok: false, error: 'unavailable' }, { status: 503, headers: noStore }) }
  if (!result.ok) return Response.json({ ok: false, error: 'wrong-code' }, { status: 401, headers: noStore })
  const { token, expiresAt } = await sessions().create(result.userId, result.email)
  return Response.json({ ok: true }, { headers: { ...noStore, 'set-cookie': sessionCookie(request, token, expiresAt) } })
}

export async function handleSignOut(request: Request): Promise<Response> {
  await sessions().delete(tokenOf(request))
  return Response.json({ ok: true }, { headers: { ...noStore, 'set-cookie': sessionCookie(request, '', null) } })
}
