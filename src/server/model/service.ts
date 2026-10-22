// Server-side wiring for the model: key loading, start-up recovery, status for the browser, and kicking off organizing.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { waitUntil } from '@vercel/functions'
import { getRepository, storageKind } from '../storage.ts'
import { costUnknownCaptureIds, modelStatus } from '../model-ledger.ts'
import { modelConfig, type ModelConfig } from './openrouter.ts'
import { expireStuckCaptures, organizeCapture } from './organize.ts'
import { recoverUnknownCosts } from './cost-lookup.ts'
import { draftDayRun, expireStuckDrafts } from './draft-run.ts'

let envLoaded = false
/**
 * `vite preview` doesn't put .env.local into process.env, so the server reads the model settings itself. Only the
 * OPENROUTER_* and DAYTHREAD_CAPTURE_MODE keys are taken, values already set in the environment win, nothing is logged.
 */
export function loadModelEnv(path = resolve('.env.local')): void {
  if (envLoaded) return
  envLoaded = true
  if (!existsSync(path)) return
  const parsed = parseEnv(readFileSync(path, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) if (/^(OPENROUTER_|DAYTHREAD_CAPTURE_MODE$|DAYTHREAD_DRAFT$)/.test(key) && process.env[key] === undefined) process.env[key] = value
}

export type ModelState = 'simulated' | 'ready' | 'paused' | 'budget-used'
export interface ModelInfo { state: ModelState; model: string | null; mode: 'auto' | 'confirm'; costUnknown: string[] }

/**
 * Work that goes on after the response is sent. On Vercel the function would otherwise be frozen at that point and a
 * capture would stay "organizing"; elsewhere waitUntil does nothing and the promise simply runs.
 */
function inBackground(work: Promise<unknown>, event: string, fields: Record<string, string>): void {
  waitUntil(work.catch(error => console.error(JSON.stringify({ level: 'error', event, ...fields, error: error instanceof Error ? error.message : 'UnknownError' }))))
}

/**
 * Postgres can be shared by several live processes (3000 and Vercel instances), so a process starting up must not take
 * another one's work in flight as interrupted: there, only attempts reserved longer ago than any call can last (60 s
 * model timeout inside a 120 s function) count, checked at most once a minute. A lone SQLite process takes every
 * attempt still reserved at its start as interrupted.
 */
const sharedStore = () => storageKind() === 'postgres'
const staleReservationMs = 5 * 60_000, sharedRecheckMs = 60_000
let recovered: Promise<void> | null = null, recoveredAt = 0, costsLookedUp = false
/**
 * Attempts left in flight become estimated; unknown costs (a generation id, no cost) are looked up once in the
 * background, so a pause from before a restart can lift on its own.
 */
function ready(now = Date.now()): Promise<void> {
  if (recovered && !(sharedStore() && now - recoveredAt >= sharedRecheckMs)) return recovered
  recoveredAt = now
  const olderThan = sharedStore() ? new Date(now - staleReservationMs).toISOString() : undefined
  recovered = getRepository().markInterruptedModelAttempts(new Date(now).toISOString(), olderThan).then(() => {
    const c = config()
    if (c && !costsLookedUp) { costsLookedUp = true; waitUntil(recoverUnknownCosts(getRepository(), c).catch(() => undefined)) }
  })
  return recovered
}
export function captureMode(): 'auto' | 'confirm' {
  return process.env.DAYTHREAD_CAPTURE_MODE === 'confirm' ? 'confirm' : 'auto' // Brian chose auto (C5, yes 9f3f3f82)
}
function config(): ModelConfig | null { loadModelEnv(); return modelConfig() }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(new Date())

export async function modelInfo(): Promise<ModelInfo> {
  const c = config()
  if (!c) return { state: 'simulated', model: null, mode: captureMode(), costUnknown: [] }
  await ready()
  const attempts = await getRepository().modelAttempts(), s = modelStatus(attempts, today())
  return { state: s.state, model: c.model, mode: captureMode(), costUnknown: costUnknownCaptureIds(attempts) }
}

/** Saves his text, then organizes it in the background; the browser follows the capture's status. */
export async function submitCaptureForModel(operationId: string, pageId: string, text: string): Promise<{ captureId: string | null; info: ModelInfo }> {
  const info = await modelInfo()
  if (info.state === 'simulated') return { captureId: null, info }
  const repository = getRepository(), c = config()!
  const ws = await repository.load()
  const r = await repository.execute({ operationId, expectedRevision: ws.revision, action: { type: 'capture-for-model', pageId, text, model: c.model, capturedAt: new Date().toISOString() } })
  const captureId = r.receipt.entityId ?? null
  if (captureId) inBackground(organizeCapture({ repository, config: c, mode: info.mode }, captureId), 'model.organize', { captureId })
  return { captureId, info }
}

/** Retry for a capture whose organizing failed: same capture, new revision, organized again in the background. */
export async function retryCaptureForModel(operationId: string, captureId: string): Promise<{ ok: boolean; info: ModelInfo }> {
  const info = await modelInfo()
  // Paused or out of budget: refused before the capture is touched, not only hidden in the receipt (Ratchet #70).
  if (info.state !== 'ready') return { ok: false, info }
  const repository = getRepository(), c = config()!
  const ws = await repository.load()
  await repository.execute({ operationId, expectedRevision: ws.revision, action: { type: 'retry-capture', captureId } })
  inBackground(organizeCapture({ repository, config: c, mode: info.mode }, captureId), 'model.organize', { captureId })
  return { ok: true, info }
}

let draftsRecovered = false
/**
 * Before the browser reads the workspace, model runs that can no longer finish end as failed. Drafts (A6b plan §3.5):
 * every one left by an earlier server process the first time (not on a shared store, where another process may still
 * be drafting), then those 90 s past their tap. Captures: organizing past captureExpiryMs. A no-op when nothing is running.
 */
export async function expireStuckRuns(now = new Date()): Promise<void> {
  const repository = getRepository()
  const all = !draftsRecovered && !sharedStore()
  draftsRecovered = true
  await expireStuckDrafts(repository, now, { all })
  await expireStuckCaptures(repository, now)
}

/**
 * Draft my day (A6b step 1). Real when the model is ready and DAYTHREAD_DRAFT isn't "simulated"; otherwise the
 * simulated draft, marked as such — a real failure never turns into a simulated draft. Paused or out of budget ends
 * the run at once with its line, nothing sent. Otherwise the run continues in the background; the browser follows it.
 */
export async function startDraftForDay(operationId: string, date: string): Promise<{ mode: 'simulated' | 'real'; info: ModelInfo }> {
  const info = await modelInfo()
  const repository = getRepository(), c = config()
  if (info.state === 'simulated' || !c || process.env.DAYTHREAD_DRAFT === 'simulated') {
    await repository.executeOnLatest(operationId, { type: 'generate-draft', date, trigger: 'card' })
    return { mode: 'simulated', info }
  }
  await repository.executeOnLatest(operationId, { type: 'start-draft-run', date, model: c.model, startedAt: new Date().toISOString() })
  if (info.state === 'paused' || info.state === 'budget-used') {
    try { await repository.executeOnLatest(`draft-failed:${operationId}`, { type: 'model-draft-failed', date, runId: operationId, failure: info.state === 'paused' ? 'paused' : 'budget' }) } catch { /* moved on */ }
    return { mode: 'real', info }
  }
  inBackground(draftDayRun({ repository, config: c }, date, operationId), 'model.draft', { date })
  return { mode: 'real', info }
}
