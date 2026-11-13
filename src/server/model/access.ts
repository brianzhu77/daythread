// Who has the model: the server must have it configured and, with sign-in on, the account's email must be allowed.
import { currentAccount } from '../auth/server.ts'
import { modelConfig, type ModelConfig } from './openrouter.ts'

/** The model for this request's account: configured, and with sign-in on, the email is in DAYTHREAD_DRAFT_EMAILS. */
export async function accountModel(): Promise<ModelConfig | null> {
  const account = await currentAccount()
  const allowed = (process.env.DAYTHREAD_DRAFT_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  return modelConfig() && (!account || allowed.includes(account.email.toLowerCase())) ? modelConfig() : null
}
