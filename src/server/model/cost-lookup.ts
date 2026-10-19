// Settles an "unknown" charge from OpenRouter's own record of the generation (GET /generation?id=). An unknown attempt
// has a generation id but no cost; this is the automatic recovery, `scripts/model-reconcile.ts` stays the manual one.
// Never an implicit zero: no answer, a non-number or an error leaves the attempt unknown and calls paused.
import type { SqliteWorkspaceRepository } from '../sqlite-repository.ts'
import type { ModelConfig } from './openrouter.ts'

export async function lookupGenerationCost(config: ModelConfig, generationId: string, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<number | null> {
  try {
    const response = await fetchImpl(`${config.baseUrl}/generation?id=${encodeURIComponent(generationId)}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    const body = await response.json().catch(() => null) as { data?: { total_cost?: unknown } } | null
    const cost = body?.data?.total_cost
    return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
  } catch {
    return null
  }
}

export interface RecoverOptions {
  fetchImpl?: typeof fetch
  now?: () => Date
  /** Waits before each lookup. OpenRouter may need a moment to publish a generation's cost. */
  delaysMs?: readonly number[]
  /** Only this attempt (right after it failed); otherwise every unknown attempt with a generation id. */
  attemptId?: string
  /** Upper bound for each lookup request (default 10 s). */
  timeoutMs?: number
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Returns how many unknown attempts were settled. */
export async function recoverUnknownCosts(repository: SqliteWorkspaceRepository, config: ModelConfig, options: RecoverOptions = {}): Promise<number> {
  const now = options.now ?? (() => new Date())
  const open = (await repository.modelAttempts()).filter(a => a.state === 'unknown' && a.generationId && (!options.attemptId || a.id === options.attemptId))
  let settled = 0
  for (const attempt of open) {
    for (const delay of options.delaysMs ?? [0]) {
      if (delay) await sleep(delay)
      const cost = await lookupGenerationCost(config, attempt.generationId!, options.fetchImpl, options.timeoutMs)
      if (cost === null) continue
      try {
        // Only an attempt still unknown is settled, in one transaction: a second lookup (in parallel or later) finds it
        // settled and changes nothing. Only the ledger is touched, never the result.
        await repository.reconcileModelAttempt(attempt.id, cost, now().toISOString(), 'settled from OpenRouter /generation', ['unknown'])
        settled++
      } catch {
        // Settled meanwhile by another path (a late result, the script): nothing left to do.
      }
      break
    }
  }
  return settled
}
