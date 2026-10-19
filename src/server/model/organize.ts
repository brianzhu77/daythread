// feat/model step 1: organizes one saved capture with Brian's model. Server only. The model call never sits inside a
// database transaction: reserve (one transaction) → call → record (one transaction, ledger + workspace together).
import type { GroundingFlag, ProposalItem, Workspace } from '../../domain/types.ts'
import type { SqliteWorkspaceRepository } from '../sqlite-repository.ts'
import { captureItems, captureMessages, captureSchema, type CaptureItem, type CaptureRawAnswer } from './capture-prompt.ts'
import { groundItem } from './grounding.ts'
import { callStructured, ModelError, requestBody, type ModelConfig } from './openrouter.ts'
import { modelPrice, worstCaseUsd } from './pricing.ts'
import { sha256 } from '../model-ledger.ts'

export const maxOutputTokens = 4000
const timezone = 'America/Vancouver'
const reasonFlag: Record<string, GroundingFlag> = {
  'title not from your text': 'title-not-grounded', 'note not from your text': 'title-not-grounded',
  'time not in your text': 'time-not-in-text', 'link not in your text': 'url-not-in-text',
  'not clearly the task you named': 'task-not-named', 'date missing': 'date-missing', 'date unclear': 'date-role-missing',
}
const isDate = (d: string | null) => d === null || (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().startsWith(d))

/** Model item → app proposal, with the grounding flags that decide whether it may save on its own. */
export function toProposal(item: CaptureItem, text: string, openTasks: Workspace['tasks']): ProposalItem | null {
  const flags = [...new Set(groundItem(item, text, openTasks).reasons.map(r => reasonFlag[r]).filter((f): f is GroundingFlag => !!f))]
  const id = crypto.randomUUID()
  switch (item.kind) {
    case 'task':
      if (!isDate(item.date)) return null
      return { id, kind: 'create-task', title: item.title.trim(), date: item.date, dateRole: item.date ? item.dateRole : null, note: item.detail, flags }
    case 'event':
      if (!isDate(item.date) || (item.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time))) return null
      // An event can't be saved without a day; it waits with "Date missing" rather than being given one.
      return { id, kind: 'create-event', title: item.title.trim(), date: item.date, time: item.time, partOfDay: item.partOfDay, flags: item.date ? flags : [...new Set<GroundingFlag>([...flags, 'date-missing'])] }
    case 'note':
      return { id, kind: 'add-note', title: item.text.trim(), flags }
    case 'material':
      if (!/^https?:\/\/\S+$/.test(item.url)) return { id, kind: 'create-material', title: item.url, url: item.url, note: item.note, flags: [...new Set<GroundingFlag>([...flags, 'url-not-in-text'])] }
      return { id, kind: 'create-material', title: item.url, url: item.url, note: item.note, date: item.followUpDate, flags }
    case 'update': {
      const t = openTasks.find(x => x.id === item.taskId)
      if (!t || !isDate(item.newDate)) return null
      return { id, kind: 'update-task', title: t.title, taskId: t.id, expectedVersion: t.version, ...(item.markDone ? { status: 'done' as const } : {}), date: item.newDate, dateRole: item.newDate ? item.dateRole : null, note: item.detail, flags }
    }
  }
}

export interface OrganizeDeps {
  repository: SqliteWorkspaceRepository
  config: ModelConfig
  mode: 'auto' | 'confirm'
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}
export type OrganizeOutcome = 'organized' | 'failed' | 'stale' | 'paused' | 'no-price'

const vancouver = (d: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false }).formatToParts(d).map(p => [p.type, p.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`, weekday: String(parts.weekday) }
}

export async function organizeCapture(deps: OrganizeDeps, captureId: string): Promise<OrganizeOutcome> {
  const { repository, config } = deps, now = deps.now ?? (() => new Date())
  const ws = await repository.load()
  const capture = ws.captures.find(c => c.id === captureId)
  if (!capture || capture.status !== 'organizing') return 'stale'
  const revision = capture.proposalRevision
  const fail = async (failure: 'failure' | 'budget' | 'context', error: string, attempt?: { id: string; cost: number | null; generationId: string | null; note?: string }) => {
    const latest = await repository.load()
    const command = { operationId: `model-failed:${captureId}:${revision}`, expectedRevision: latest.revision, action: { type: 'model-failed' as const, captureId, revision, failure, error } }
    if (attempt) await repository.recordModelResult({ attemptId: attempt.id, actualUsd: attempt.cost, generationId: attempt.generationId, now: now().toISOString(), ...(attempt.note ? { note: attempt.note } : {}) }, command)
    else { try { await repository.execute(command) } catch { /* moved on: nothing to mark */ } }
    return 'failed' as const
  }

  // Request: his text and his open tasks — exactly what the quality probe measured.
  const at = vancouver(now())
  const openTasks = ws.tasks.filter(t => t.status === 'open')
  const ctx = { capturedAt: `${at.day} ${at.time}`, weekday: at.weekday, timezone, openTasks: openTasks.map(t => ({ id: t.id, title: t.title, plannedOn: t.plannedOn, deadlineOn: t.deadlineOn })) }
  const messages = captureMessages(capture.text, ctx), schema = captureSchema(openTasks.map(t => t.id))
  const body = requestBody(config, messages, schema, { maxTokens: maxOutputTokens })

  const price = await modelPrice(config.model, config.apiKey, config.baseUrl, deps.fetchImpl, now().getTime())
  if (!price) { await fail('failure', 'Model price unavailable · text saved, nothing sent'); return 'no-price' }
  const upperBoundUsd = worstCaseUsd(body, maxOutputTokens, price)
  const attemptId = `organize:${captureId}:${revision}`
  try {
    // A second run for the same capture revision finds the reservation already there and sends nothing.
    const { replayed } = await repository.reserveModelAttempt({ id: attemptId, captureId, revision, day: at.day, upperBoundUsd, model: config.model, requestHash: sha256(body), now: now().toISOString() })
    if (replayed) return 'stale'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Daily budget reached/.test(message)) { await fail('budget', "Today's model budget is used up · text saved"); return 'paused' }
    if (/in-flight or unknown/.test(message)) { await fail('failure', 'Model paused · a charge needs checking · text saved'); return 'paused' }
    throw error
  }

  let answer: CaptureRawAnswer, cost: number | null = null, generationId: string | null = null
  try {
    const r = await callStructured<CaptureRawAnswer>(config, messages, schema, { maxTokens: maxOutputTokens, timeoutMs: deps.timeoutMs ?? 60_000, fetchImpl: deps.fetchImpl })
    answer = r.value; cost = r.costUsd; generationId = r.generationId
  } catch (error) {
    const e = error instanceof ModelError ? error : null
    // No answer: the charge may still be real. A timeout or lost connection stays unknown (paused until reconciled);
    // an answer we couldn't use carries its cost if OpenRouter reported one.
    const knownCost = e?.costUsd ?? null
    // An HTTP error answer means no generation ran: settled at 0 on that evidence (note says why).
    if (e?.httpStatus) return fail('failure', e.kind === 'auth' ? 'Model unavailable · check the key · text saved' : e.kind === 'limit' ? 'Model limit reached · text saved' : 'Model unavailable · text saved', { id: attemptId, cost: 0, generationId: null, note: `provider answered HTTP ${e.httpStatus}; no generation, nothing charged` })
    if (knownCost !== null) return fail('failure', "Couldn't organize · text saved", { id: attemptId, cost: knownCost, generationId: null })
    await repository.recordModelResult({ attemptId, actualUsd: null, generationId: null, now: now().toISOString() })
    return fail('failure', e?.kind === 'timeout' ? 'Model took too long · text saved' : "Couldn't reach the model · text saved")
  }

  const items = Array.isArray(answer?.items) ? captureItems(answer) : []
  const proposals = items.map(i => toProposal(i, capture.text, openTasks)).filter((p): p is ProposalItem => !!p)
  const unreadable = (Array.isArray(answer?.items) ? answer.items.length : 1) - proposals.length
  const latest = await repository.load()
  const command = {
    operationId: `organized:${captureId}:${revision}`, expectedRevision: latest.revision,
    action: { type: 'organized-capture' as const, captureId, revision, model: config.model, mode: deps.mode, proposals, unreadable, contextLine: `Organized by ${config.model} · sent: your text and open tasks` },
  }
  const r = await repository.recordModelResult({ attemptId, actualUsd: cost, generationId, now: now().toISOString() }, command)
  return r.refused ? 'stale' : 'organized'
}
