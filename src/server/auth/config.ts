// Who may use this server. Sign-in is on everywhere unless DAYTHREAD_AUTH=off, which is refused on a hosting
// platform: an off switch must never be able to reach the internet (Brian 247ee3f3, Ratchet f6dc9688).
import { readLocalEnv } from '../local-env.ts'
import { onHostingPlatform } from '../hosting.ts'

export interface AuthConfig {
  supabaseUrl: string
  publishableKey: string
  /** Supabase's secret (service role) key, server-only and optional: with it, deleting an account deletes its login too. */
  secretKey: string | undefined
  /** `invite` (the default): only addresses on the invite list come in; `open`: anyone (shot 2, Brian: ready, but invite for now). */
  signUp: 'invite' | 'open'
  /** Addresses invited through the environment (DAYTHREAD_INVITES, comma-separated), beside the `invites` table. */
  envInvites: string[]
}

export function authRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DAYTHREAD_AUTH !== 'off') return true
  if (onHostingPlatform(env)) throw new Error('DAYTHREAD_AUTH=off is refused on a hosting platform')
  return false
}

export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  if (env === process.env) loadAuthEnv()
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, ''), publishableKey = env.SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !publishableKey) throw new Error('Sign-in needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY')
  const signUp = env.DAYTHREAD_SIGNUP ?? 'invite'
  if (signUp !== 'invite' && signUp !== 'open') throw new Error('DAYTHREAD_SIGNUP must be invite or open')
  return {
    supabaseUrl, publishableKey, secretKey: env.SUPABASE_SECRET_KEY || undefined, signUp,
    envInvites: (env.DAYTHREAD_INVITES ?? '').split(',').map(normalizeEmail).filter(Boolean),
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

let envLoaded = false
/** The sign-in keys from .env.local on the Mac (local-env.ts); on Vercel they come from the project's env. */
function loadAuthEnv(): void {
  if (envLoaded) return
  envLoaded = true
  readLocalEnv(/^(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|DAYTHREAD_SIGNUP|DAYTHREAD_INVITES)$/)
}
