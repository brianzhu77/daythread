// Server-side wiring for the model: key loading, start-up recovery, status for the browser, and kicking off organizing.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { getRepository } from '../storage.ts'
import { SqliteWorkspaceRepository } from '../sqlite-repository.ts'
import { modelStatus } from '../model-ledger.ts'
import { modelConfig, type ModelConfig } from './openrouter.ts'
import { organizeCapture } from './organize.ts'

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
  for (const [key, value] of Object.entries(parsed)) if (/^(OPENROUTER_|DAYTHREAD_CAPTURE_MODE$)/.test(key) && process.env[key] === undefined) process.env[key] = value
}

export type ModelState = 'simulated' | 'ready' | 'paused' | 'budget-used'
export interface ModelInfo { state: ModelState; model: string | null; mode: 'auto' | 'confirm' }

let recovered: Promise<void> | null = null
function sqlite(): SqliteWorkspaceRepository {
  const repository = getRepository()
  if (!(repository instanceof SqliteWorkspaceRepository)) throw new Error('The model needs the SQLite store')
  return repository
}
/** Once per server process: attempts left in flight by a previous process have an unknown outcome. */
function ready(): Promise<void> {
  recovered ??= sqlite().markInterruptedModelAttempts(new Date().toISOString()).then(() => undefined)
  return recovered
}
export function captureMode(): 'auto' | 'confirm' {
  return process.env.DAYTHREAD_CAPTURE_MODE === 'confirm' ? 'confirm' : 'auto' // Brian chose auto (C5, yes 9f3f3f82)
}
function config(): ModelConfig | null { loadModelEnv(); return modelConfig() }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(new Date())

export async function modelInfo(): Promise<ModelInfo> {
  const c = config()
  if (!c) return { state: 'simulated', model: null, mode: captureMode() }
  await ready()
  const s = modelStatus(await sqlite().modelAttempts(), today())
  return { state: s.state, model: c.model, mode: captureMode() }
}

/** Saves his text, then organizes it in the background; the browser follows the capture's status. */
export async function submitCaptureForModel(operationId: string, pageId: string, text: string): Promise<{ captureId: string | null; info: ModelInfo }> {
  const info = await modelInfo()
  if (info.state === 'simulated') return { captureId: null, info }
  const repository = sqlite(), c = config()!
  const ws = await repository.load()
  const r = await repository.execute({ operationId, expectedRevision: ws.revision, action: { type: 'capture-for-model', pageId, text, model: c.model } })
  const captureId = r.receipt.entityId ?? null
  if (captureId) void organizeCapture({ repository, config: c, mode: info.mode }, captureId).catch(error => console.error(JSON.stringify({ level: 'error', event: 'model.organize', captureId, error: error instanceof Error ? error.message : 'UnknownError' })))
  return { captureId, info }
}
