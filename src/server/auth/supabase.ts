// Supabase Auth's emailed code, called from the server only (Brian c821ad7b: nothing Supabase in the browser). Only
// the code is Supabase's: once it checks out, the server issues its own session (sessions.ts) and drops Supabase's.
import { normalizeEmail, type AuthConfig } from './config.ts'

export type SendResult = 'sent' | 'failed'
export type VerifyResult = { ok: true; userId: string; email: string } | { ok: false }

interface AuthError { status: number; code?: string; message: string }
async function call(config: AuthConfig, path: string, body: unknown, fetchImpl: typeof fetch, token?: string): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: AuthError }> {
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const json = await response.json().catch(() => ({})) as Record<string, unknown>
  if (response.ok) return { ok: true, json }
  const message = String(json.msg ?? json.message ?? json.error_description ?? json.error ?? '')
  return { ok: false, error: { status: response.status, code: typeof json.error_code === 'string' ? json.error_code : undefined, message } }
}

/**
 * Errors only some addresses can get must look like a send, or the screen would tell which address owns the
 * workspace (Roadbuster 7cf86f2b, Lead 0c458a44): an address with no account (sign-ups are off) and the per-address
 * cooldown. Failures that hit every address alike (the project's email limit, network, Supabase down) are 'failed'.
 */
export function isAddressSpecific(error: AuthError): boolean {
  if (/only request this after/i.test(error.message)) return true
  if (['otp_disabled', 'signup_disabled', 'user_not_found', 'email_address_not_authorized'].includes(error.code ?? '')) return true
  return /signups? not allowed|user not found/i.test(error.message)
}

export async function sendCode(config: AuthConfig, email: string, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  try {
    const r = await call(config, 'otp', { email: normalizeEmail(email), create_user: false }, fetchImpl)
    return r.ok || isAddressSpecific(r.error) ? 'sent' : 'failed'
  } catch { return 'failed' }
}

/** A wrong, expired or reused code, or a verified account that isn't the owner, are all the same `{ ok: false }`. */
export async function verifyCode(config: AuthConfig, email: string, code: string, fetchImpl: typeof fetch = fetch): Promise<VerifyResult> {
  if (!/^\d{6}$/.test(code.trim())) return { ok: false }
  const r = await call(config, 'verify', { type: 'email', email: normalizeEmail(email), token: code.trim() }, fetchImpl)
  if (!r.ok) return { ok: false }
  const user = r.json.user as { id?: unknown; email?: unknown } | undefined
  const accessToken = typeof r.json.access_token === 'string' ? r.json.access_token : undefined
  // Supabase's own session isn't used: end it right away, best effort.
  if (accessToken) void call(config, 'logout?scope=local', {}, fetchImpl, accessToken).catch(() => undefined)
  if (typeof user?.id !== 'string' || typeof user.email !== 'string') return { ok: false }
  if (normalizeEmail(user.email) !== config.ownerEmail) return { ok: false }
  return { ok: true, userId: user.id, email: normalizeEmail(user.email) }
}
