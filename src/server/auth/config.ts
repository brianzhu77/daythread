// Who may use this server. Sign-in is on everywhere unless DAYTHREAD_AUTH=off, which is refused on a hosting
// platform: an off switch must never be able to reach the internet (Brian 247ee3f3, Ratchet f6dc9688).
import { readLocalEnv } from '../local-env.ts'

export interface AuthConfig { supabaseUrl: string; publishableKey: string; ownerEmail: string }

export function authRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DAYTHREAD_AUTH !== 'off') return true
  if (env.VERCEL || env.NETLIFY) throw new Error('DAYTHREAD_AUTH=off is refused on a hosting platform')
  return false
}

/** The owner is the one account that may sign in; any other verified account is refused like a wrong code. */
export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  if (env === process.env) loadAuthEnv()
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, ''), publishableKey = env.SUPABASE_PUBLISHABLE_KEY, ownerEmail = env.OWNER_EMAIL
  if (!supabaseUrl || !publishableKey || !ownerEmail) throw new Error('Sign-in needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and OWNER_EMAIL')
  return { supabaseUrl, publishableKey, ownerEmail: normalizeEmail(ownerEmail) }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

let envLoaded = false
/** The sign-in keys from .env.local on the Mac (local-env.ts); on Vercel they come from the project's env. */
function loadAuthEnv(): void {
  if (envLoaded) return
  envLoaded = true
  readLocalEnv(/^(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|OWNER_EMAIL)$/)
}
