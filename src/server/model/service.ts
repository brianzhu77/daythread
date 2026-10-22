// Server-side wiring for the model: key loading, start-up recovery, status for the browser, and kicking off organizing.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { getRepository } from '../storage.ts'
import { costUnknownCaptureIds, modelStatus } from '../model-ledger.ts'
import { modelConfig, type ModelConfig } from './openrouter.ts'
import { organizeCapture } from './organize.ts'
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

let recovered: Promise<void> | null = null
/**
 * Once per server process: attempts a previous process left in flight become estimated; unknown costs (a generation
 * id, no cost) are looked up once in the background, so a pause from before a restart can lift on its own.
 */
function ready(): Promise<void> {
  recovered ??= getRepository().markInterruptedModelAttempts(new Date().toISOString()).then(() => {
    const c = config()
    if (c) void recoverUnknownCosts(getRepository(), c).catch(() => undefined)
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
  if (captureId) void organizeCapture({ repository, config: c, mode: info.mode }, captureId).catch(error => console.error(JSON.stringify({ level: 'error', event: 'model.organize', captureId, error: error instanceof Error ? error.message : 'UnknownError' })))
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
  void organizeCapture({ repository, config: c, mode: info.mode }, captureId).catch(error => console.error(JSON.stringify({ level: 'error', event: 'model.organize', captureId, error: error instanceof Error ? error.message : 'UnknownError' })))
  return { ok: true, info }
}

let draftsRecovered = false
/**
 * A6b plan §3.5: before the browser reads the workspace, runs stuck on "drafting" end as failed — every one left by an
 * earlier server process the first time, then those 90 s past their tap. A no-op when nothing is drafting.
 */
export async function expireDrafts(now = new Date()): Promise<void> {
  const repository = getRepository()
  const all = !draftsRecovered
  draftsRecovered = true
  await expireStuckDrafts(repository, now, { all })
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
  void draftDayRun({ repository, config: c }, date, operationId).catch(error => console.error(JSON.stringify({ level: 'error', event: 'model.draft', date, error: error instanceof Error ? error.message : 'UnknownError' })))
  return { mode: 'real', info }
}
