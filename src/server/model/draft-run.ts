// A6b step 1: one real run of Draft my day (docs/plan/a6b-model-step2.md §3–§7). Same shape as organizeCapture: the
// model call is never inside a database transaction — record request → reserve → call → record (ledger + draft in one
// transaction). Only the run still drafting under its runId is ever changed; everything else just settles its cost.
import type { DraftFailure, LocalDate, Workspace } from '../../domain/types.ts'
import type { SqliteWorkspaceRepository } from '../sqlite-repository.ts'
import { dailyCapUsd, sha256 } from '../model-ledger.ts'
import { callStructured, ModelError, type ModelConfig } from './openrouter.ts'
import { recoverUnknownCosts } from './cost-lookup.ts'
import { modelPrice, worstCaseUsd } from './pricing.ts'
import { buildDraftRequest, draftMaxTokens, draftSchema, readDraftAnswer } from './draft-prompt.ts'

/** Plan §3.5: a run still drafting 90 s after the tap ends as failed, by a persisted server transition. */
export const draftExpiryMs = 90_000

export interface DraftDeps {
  repository: SqliteWorkspaceRepository
  config: ModelConfig
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
  lookupDelaysMs?: readonly number[]
  /** Context budget in bytes (tests); default `draftBudgetBytes`. */
  budgetBytes?: number
}
export type DraftOutcome = 'drafted' | 'failed' | 'stale'

const runOf = (ws: Workspace, date: LocalDate) => ws.pages.find(p => p.type === 'daily' && p.date === date)?.draft?.run

/** Ends the run as failed (only if it's still drafting under this runId); a refusal means it already moved on. */
async function failRun(repository: SqliteWorkspaceRepository, date: LocalDate, runId: string, failure: DraftFailure, extra: { expired?: boolean; costUnknown?: boolean } = {}) {
  try { await repository.executeOnLatest(`draft-failed:${runId}`, { type: 'model-draft-failed', date, runId, failure, ...extra }) } catch { /* moved on */ }
}

/** Runs going on in this process: a replay of one of them follows it instead of starting again (Ratchet #80). */
const active = new Set<string>()

export async function draftDayRun(deps: DraftDeps, date: LocalDate, runId: string): Promise<DraftOutcome> {
  if (active.has(runId)) return 'stale'
  active.add(runId)
  try { return await draftOnce(deps, date, runId) } finally { active.delete(runId) }
}

async function draftOnce(deps: DraftDeps, date: LocalDate, runId: string): Promise<DraftOutcome> {
  const { repository, config } = deps, now = deps.now ?? (() => new Date())
  const ws = await repository.load()
  const run = runOf(ws, date)
  if (!run || run.runId !== runId || run.status !== 'drafting') return 'stale'
  // The same run already reserved (by another process, or before a replay): it's that run's to finish, not a new one.
  if ((await repository.modelAttempts()).some(a => a.id === run.attemptId)) return 'stale'
  const request = buildDraftRequest(ws, date, config, deps.budgetBytes)
  // Must-send part over the budget: nothing is sent, no Retry (it would fail the same way).
  if (request.tooLarge) { await failRun(repository, date, runId, 'too-large'); return 'failed' }
  const requestHash = sha256(request.body)
  try { await repository.executeOnLatest(`draft-request:${runId}`, { type: 'record-draft-request', date, runId, requestHash, manifest: request.manifest }) } catch { return 'stale' }

  const price = await modelPrice(config.model, config.apiKey, config.baseUrl, deps.fetchImpl, now().getTime())
  if (!price) { await failRun(repository, date, runId, 'unavailable'); return 'failed' }
  const attemptId = run.attemptId
  const spendDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(now())
  // One paid call at a time, shared with capture (Ratchet ae9c7b87): another call in flight is "busy", nothing reserved.
  if ((await repository.modelAttempts()).some(a => a.state === 'reserved' && a.id !== attemptId)) { await failRun(repository, date, runId, 'busy'); return 'failed' }
  const reserve = () => repository.reserveModelAttempt({ id: attemptId, subject: { kind: 'draft', date, run: run.run }, day: spendDay, upperBoundUsd: worstCaseUsd(request.body, draftMaxTokens, price), model: config.model, requestHash, now: now().toISOString(), capUsd: dailyCapUsd() })
  try {
    let reserved
    try { reserved = await reserve() } catch (error) {
      if (!/in-flight or unknown/.test(error instanceof Error ? error.message : '') || !(await recoverUnknownCosts(repository, config, { fetchImpl: deps.fetchImpl, now: deps.now, timeoutMs: 3000 }))) throw error
      reserved = await reserve()
    }
    if (reserved.replayed) return 'stale'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Daily budget reached/.test(message)) { await failRun(repository, date, runId, 'budget'); return 'failed' }
    if (/in-flight or unknown/.test(message)) {
      const busy = (await repository.modelAttempts()).some(a => a.state === 'reserved' && a.id !== attemptId)
      await failRun(repository, date, runId, busy ? 'busy' : 'paused'); return 'failed'
    }
    throw error
  }

  // The ledger settles whatever happens; the draft changes only while this run is still drafting.
  const record = (actualUsd: number | null, generationId: string | null, action: (w: Workspace) => Parameters<SqliteWorkspaceRepository['executeOnLatest']>[1], note?: string) =>
    repository.recordModelResult({ attemptId, actualUsd, generationId, now: now().toISOString(), ...(note ? { note } : {}) },
      w => ({ operationId: `draft-result:${runId}`, expectedRevision: w.revision, action: action(w) }))
  const failed = (failure: DraftFailure, costUnknown = false) => () => ({ type: 'model-draft-failed' as const, date, runId, failure, ...(costUnknown ? { costUnknown } : {}) })

  let answer: unknown, cost: number | null = null, generationId: string | null = null
  try {
    const r = await callStructured<unknown>(config, request.messages, draftSchema, { maxTokens: draftMaxTokens, timeoutMs: deps.timeoutMs ?? 60_000, fetchImpl: deps.fetchImpl })
    answer = r.value; cost = r.costUsd; generationId = r.generationId
  } catch (error) {
    const e = error instanceof ModelError ? error : null
    const failure: DraftFailure = e?.kind === 'auth' ? 'key-rejected' : 'unavailable'
    if (e?.costUsd != null) await record(e.costUsd, e.generationId, failed(failure))
    else if (e?.generationId) { await record(null, e.generationId, failed(failure, true)); await lookup(deps, attemptId) }
    else if (e?.httpStatus === 401 || e?.httpStatus === 403) await record(0, null, failed(failure), `provider refused before routing (HTTP ${e.httpStatus}); no generation id or cost reported`)
    else await record(null, null, failed(failure, true))
    return 'failed'
  }

  const reading = readDraftAnswer(answer, request, date)
  const action = reading.ok
    ? () => ({ type: 'set-model-draft' as const, date, runId, taskIds: reading.taskIds, materialIds: reading.materialIds, proposals: reading.proposals })
    : failed('unavailable')
  const r = await record(cost, generationId, action)
  if (cost === null && generationId) await lookup(deps, attemptId)
  return r.refused ? 'stale' : reading.ok ? 'drafted' : 'failed'
}

async function lookup(deps: DraftDeps, attemptId: string) {
  await recoverUnknownCosts(deps.repository, deps.config, { fetchImpl: deps.fetchImpl, now: deps.now, attemptId, delaysMs: deps.lookupDelaysMs ?? [1000, 3000, 10_000, 20_000] })
}

/**
 * Plan §3.5 (Jazz 0c16159, Ratchet 676b6ad1, Lead c1ba8868): runs still drafting 90 s after the tap — or any run left
 * drafting by an earlier server process (`all`) — end as failed. Expiry and a late result race in one transaction on
 * runId + drafting, so only one changes the draft; a losing result still settles its cost. The attempt ends under the
 * ledger's rules: still reserved (no reply, no id) → estimated at the reservation, freed, "Model unavailable" + Retry;
 * an id without a cost (unknown) → "Model paused", no Retry.
 */
export async function expireStuckDrafts(repository: SqliteWorkspaceRepository, now: Date, options: { all?: boolean } = {}): Promise<number> {
  const ws = await repository.load()
  const stuck = ws.pages.filter(p => p.draft?.run?.status === 'drafting' && (options.all || now.getTime() - Date.parse(p.draft.run.startedAt) >= draftExpiryMs))
  let n = 0
  for (const p of stuck) {
    const run = p.draft!.run!, date = p.date!
    const attempt = (await repository.modelAttempts()).find(a => a.id === run.attemptId)
    const action = (failure: DraftFailure, costUnknown = false) => ({ type: 'model-draft-failed' as const, date, runId: run.runId, failure, expired: true, ...(costUnknown ? { costUnknown } : {}) })
    // The draft first: if the result already changed it, expiry is refused and changes nothing. Then a still-reserved
    // attempt is settled as estimated with no result bound, so a late answer can still settle its real cost.
    const paused = attempt?.state === 'unknown'
    try { await repository.executeOnLatest(`draft-expired:${run.runId}`, action(paused ? 'paused' : 'unavailable', Boolean(attempt) && attempt!.state !== 'settled')) } catch { continue }
    n++
    if (attempt?.state === 'reserved')
      try { await repository.recordModelResult({ attemptId: attempt.id, actualUsd: null, generationId: null, now: now.toISOString(), note: 'draft run expired after 90 s; counted at the reserved upper bound' }) } catch { /* settled meanwhile */ }
  }
  return n
}
