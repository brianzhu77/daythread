// Supabase Auth's email + password check, called from the server only (Brian c821ad7b: nothing Supabase in the
// browser; af84514f: the code email needs custom SMTP, so passwords, Lead). Only the check is Supabase's: once it
// passes, the server issues its own session (sessions.ts) and ends Supabase's.
import { normalizeEmail, type AuthConfig } from './config.ts'

export type VerifyResult = { ok: true; userId: string; email: string } | { ok: false }

async function call(config: AuthConfig, path: string, body: unknown, fetchImpl: typeof fetch, token?: string): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const json = await response.json().catch(() => ({})) as Record<string, unknown>
  // Supabase is down or limiting us: that's "couldn't sign in", not a wrong password.
  if (response.status >= 500 || response.status === 429) throw new Error(`Supabase Auth ${response.status}`)
  return { ok: response.ok, json }
}

/**
 * A wrong password, an unknown address and a verified account that isn't the owner are all the same `{ ok: false }`.
 * Throws when Supabase can't answer.
 */
export async function verifyPassword(config: AuthConfig, email: string, password: string, fetchImpl: typeof fetch = fetch): Promise<VerifyResult> {
  if (!password || password.length > 1024) return { ok: false }
  const r = await call(config, 'token?grant_type=password', { email: normalizeEmail(email), password }, fetchImpl)
  if (!r.ok) return { ok: false }
  const user = r.json.user as { id?: unknown; email?: unknown } | undefined
  const accessToken = typeof r.json.access_token === 'string' ? r.json.access_token : undefined
  // Supabase's own session isn't used: end it right away, best effort.
  if (accessToken) void call(config, 'logout?scope=local', {}, fetchImpl, accessToken).catch(() => undefined)
  if (typeof user?.id !== 'string' || typeof user.email !== 'string') return { ok: false }
  if (normalizeEmail(user.email) !== config.ownerEmail) return { ok: false }
  return { ok: true, userId: user.id, email: normalizeEmail(user.email) }
}
