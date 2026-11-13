// Who has the model: the server must have it configured and, with sign-in on, the account's email must be allowed.
import { authRequired } from '../auth/config.ts'
import { currentAccount } from '../auth/server.ts'
import { modelConfig, type ModelConfig } from './openrouter.ts'

/**
 * With sign-in off, this machine's one user has the model. With sign-in on, only an account whose email is in
 * `emails` (DAYTHREAD_DRAFT_EMAILS, comma-separated). The account is the one the gate let in (auth/server.ts reads
 * the session cookie one way for both), and a request with no account has none: the list fails closed.
 */
export function modelAllowed(signInOn: boolean, account: { email: string } | null, emails: string | undefined): boolean {
  if (!signInOn) return true
  const allowed = (emails ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  return account !== null && allowed.includes(account.email.toLowerCase())
}

/** The model for this request's account, or null. */
export async function accountModel(): Promise<ModelConfig | null> {
  const config = modelConfig()
  if (!config) return null
  const signInOn = authRequired()
  return modelAllowed(signInOn, signInOn ? await currentAccount() : null, process.env.DAYTHREAD_DRAFT_EMAILS) ? config : null
}
