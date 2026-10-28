// Supabase Auth, called from the server only (Brian c821ad7b: nothing Supabase in the browser; af84514f: the code
// email needs custom SMTP, so passwords, Lead). Only the checks are Supabase's: once a password passes, the server
// issues its own session (sessions.ts) and ends Supabase's. Who may come in is the server's call (the invite list).
import { normalizeEmail, type AuthConfig } from './config.ts'

export type VerifyResult = { ok: true; userId: string; email: string } | { ok: false; reason?: 'unconfirmed' }
/** `confirm`: Supabase sent a confirmation email, sign-in works once it is clicked; `session`: the login is usable now. */
export type ResetResult = { ok: true; userId: string; email: string } | { ok: false; reason: 'expired' | 'same' } | { ok: false; reason: 'weak'; message: string }
export type SignUpResult = { outcome: 'confirm' } | { outcome: 'session'; userId: string; email: string } | { outcome: 'exists' } | { outcome: 'weak'; message: string }

/** Supabase limiting how often: callers that can say "wait a minute" catch this; to the rest it is any other failure. */
export class SupabaseRateLimit extends Error {}

async function call(config: AuthConfig, path: string, body: unknown, fetchImpl: typeof fetch, token?: string, method = 'POST'): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/${path}`, {
    method,
    headers: { apikey: token && token !== config.publishableKey ? token : config.publishableKey, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  })
  const json = await response.json().catch(() => ({})) as Record<string, unknown>
  // Supabase is down or limiting us: that's "couldn't sign in", not a wrong password.
  if (response.status === 429) throw new SupabaseRateLimit('Supabase Auth 429')
  if (response.status >= 500) throw new Error(`Supabase Auth ${response.status}`)
  return { ok: response.ok, status: response.status, json }
}
const endSession = (config: AuthConfig, json: Record<string, unknown>, fetchImpl: typeof fetch) => {
  const accessToken = typeof json.access_token === 'string' ? json.access_token : undefined
  if (accessToken) void call(config, 'logout?scope=local', {}, fetchImpl, accessToken).catch(() => undefined)
}
const userOf = (json: Record<string, unknown>): { id: string; email: string } | null => {
  const user = (json.user ?? json) as { id?: unknown; email?: unknown } | undefined
  return typeof user?.id === 'string' && typeof user.email === 'string' ? { id: user.id, email: normalizeEmail(user.email) } : null
}

/** A wrong password and an unknown address are the same `{ ok: false }`; an unconfirmed address says so. Throws when Supabase can't answer. */
export async function verifyPassword(config: AuthConfig, email: string, password: string, fetchImpl: typeof fetch = fetch): Promise<VerifyResult> {
  if (!password || password.length > 1024) return { ok: false }
  const r = await call(config, 'token?grant_type=password', { email: normalizeEmail(email), password }, fetchImpl)
  if (!r.ok) return r.json.error_code === 'email_not_confirmed' ? { ok: false, reason: 'unconfirmed' } : { ok: false }
  endSession(config, r.json, fetchImpl)
  const user = userOf(r.json)
  return user ? { ok: true, userId: user.id, email: user.email } : { ok: false }
}

/**
 * A new login. With email confirmation on in Supabase the answer is the user without a session (`confirm`); off, a
 * session (`session`, ended right away). The time zone rides along as user metadata, for the record.
 */
export async function signUp(config: AuthConfig, email: string, password: string, timezone: string | undefined, fetchImpl: typeof fetch = fetch): Promise<SignUpResult> {
  if (!password || password.length > 1024) return { outcome: 'weak', message: 'Use a longer password' }
  const r = await call(config, 'signup', { email: normalizeEmail(email), password, data: { timezone } }, fetchImpl)
  if (!r.ok) {
    const code = r.json.error_code, message = typeof r.json.msg === 'string' ? r.json.msg : 'That password is too weak'
    if (code === 'user_already_exists' || code === 'email_exists') return { outcome: 'exists' }
    if (code === 'weak_password' || code === 'validation_failed') return { outcome: 'weak', message }
    throw new Error(`Supabase Auth sign-up ${r.status}`)
  }
  const user = userOf(r.json)
  if (typeof r.json.access_token === 'string' && user) { endSession(config, r.json, fetchImpl); return { outcome: 'session', userId: user.id, email: user.email } }
  return { outcome: 'confirm' }
}

/** Removes the login itself (Supabase's admin API, the secret key). Only called when `secretKey` is set. */
export async function deleteUser(config: AuthConfig, userId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!config.secretKey) throw new Error('SUPABASE_SECRET_KEY is not set')
  const r = await call(config, `admin/users/${encodeURIComponent(userId)}`, undefined, fetchImpl, config.secretKey, 'DELETE')
  if (!r.ok && r.status !== 404) throw new Error(`Supabase Auth delete ${r.status}`)
}

/** Asks Supabase to send its recovery email. A 200 says nothing about whether the address exists; a 4xx other than a rate limit is treated the same. */
export async function recover(config: AuthConfig, email: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const r = await call(config, 'recover', { email: normalizeEmail(email) }, fetchImpl)
  if (!r.ok && r.status !== 400 && r.status !== 422) throw new Error(`Supabase Auth recover ${r.status}`)
}

/**
 * Sends the sign-up confirmation again, for an address that signed in with the right password but hasn't confirmed.
 * Supabase sends only to an unconfirmed login and answers 200 for any other address, so this says nothing about who
 * exists; `wait` is its once-a-minute limit for that address.
 */
export async function resendConfirmation(config: AuthConfig, email: string, fetchImpl: typeof fetch = fetch): Promise<'sent' | 'wait'> {
  try {
    const r = await call(config, 'resend', { type: 'signup', email: normalizeEmail(email) }, fetchImpl)
    if (!r.ok && r.status !== 400 && r.status !== 422) throw new Error(`Supabase Auth resend ${r.status}`)
    return 'sent'
  } catch (error) {
    if (error instanceof SupabaseRateLimit) return 'wait'
    throw error
  }
}

/** The new password, set with the access token the recovery link carried; Supabase's own sessions are then ended everywhere. */
export async function resetPassword(config: AuthConfig, accessToken: string, password: string, fetchImpl: typeof fetch = fetch): Promise<ResetResult> {
  if (!password || password.length > 1024) return { ok: false, reason: 'weak', message: 'Use a longer password' }
  if (!accessToken || accessToken.length > 4096) return { ok: false, reason: 'expired' }
  const r = await call(config, 'user', { password }, fetchImpl, accessToken, 'PUT')
  if (!r.ok) {
    const code = r.json.error_code, message = typeof r.json.msg === 'string' ? r.json.msg : 'That password is too weak'
    // An invitee sent here by "Forgot password?" often types the password they signed up with: not weak, just theirs.
    if (code === 'same_password') return { ok: false, reason: 'same' }
    if (code === 'weak_password' || code === 'validation_failed') return { ok: false, reason: 'weak', message }
    return { ok: false, reason: 'expired' }
  }
  const user = userOf(r.json)
  if (!user) return { ok: false, reason: 'expired' }
  void call(config, 'logout?scope=global', {}, fetchImpl, accessToken).catch(() => undefined)
  return { ok: true, userId: user.id, email: user.email }
}

/** Who an access token (from the confirmation link) belongs to; null when it is stale or not a token. */
export async function userFromToken(config: AuthConfig, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<{ userId: string; email: string } | null> {
  if (!accessToken || accessToken.length > 4096) return null
  const r = await call(config, 'user', undefined, fetchImpl, accessToken, 'GET')
  if (!r.ok) return null
  const user = userOf(r.json)
  return user ? { userId: user.id, email: user.email } : null
}
