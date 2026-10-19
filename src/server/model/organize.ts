// feat/model step 1: organizes one saved capture with Brian's model. Server only. The model call never sits inside a
// database transaction: reserve (one transaction) → call → record (one transaction, ledger + workspace together).
import type { GroundingFlag, ProposalItem, Workspace } from '../../domain/types.ts'
import type { SqliteWorkspaceRepository } from '../sqlite-repository.ts'
import { captureMessages, captureSchema, readCaptureAnswer, type CaptureItem } from './capture-prompt.ts'
import { groundItem } from './grounding.ts'
import { callStructured, ModelError, requestBody, type ModelConfig } from './openrouter.ts'
import { modelPrice, worstCaseUsd } from './pricing.ts'
import { dailyCapUsd, sha256 } from '../model-ledger.ts'

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

  // Request: his text and his open tasks — exactly what the quality probe measured. Dates resolve from when he wrote
  // the text (03 §2), so a run or Retry after midnight still reads "明天" as the day after he wrote it.
  const at = vancouver(capture.capturedAt ? new Date(capture.capturedAt) : now())
  const spendDay = vancouver(now()).day
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
    const { replayed } = await repository.reserveModelAttempt({ id: attemptId, captureId, revision, day: spendDay, upperBoundUsd, model: config.model, requestHash: sha256(body), now: now().toISOString(), capUsd: dailyCapUsd() })
    if (replayed) return 'stale'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Daily budget reached/.test(message)) { await fail('budget', "Today's model budget is used up · text saved"); return 'paused' }
    if (/in-flight or unknown/.test(message)) { await fail('failure', 'Model paused · a charge needs checking · text saved'); return 'paused' }
    throw error
  }

  let answer: unknown, cost: number | null = null, generationId: string | null = null
  try {
    const r = await callStructured<unknown>(config, messages, schema, { maxTokens: maxOutputTokens, timeoutMs: deps.timeoutMs ?? 60_000, fetchImpl: deps.fetchImpl })
    answer = r.value; cost = r.costUsd; generationId = r.generationId
  } catch (error) {
    const e = error instanceof ModelError ? error : null
    const message = e?.kind === 'auth' ? 'Model key rejected · text saved' : e?.httpStatus ? 'Model unavailable · text saved' : "Couldn't organize · text saved"
    // A reported cost is what was charged, whatever the HTTP status (Ratchet #69): settled at that amount.
    if (e?.costUsd != null) return fail('failure', message, { id: attemptId, cost: e.costUsd, generationId: e.generationId })
    // A generation without a cost: something may have been charged. Unknown, so calls pause until it's reconciled.
    if (e?.generationId) return fail('failure', message, { id: attemptId, cost: null, generationId: e.generationId })
    // A rejected key (401/403) is refused at authentication, before any generation: zero, with the reason (Lead 99d98c1f).
    if (e?.httpStatus === 401 || e?.httpStatus === 403) return fail('failure', message, { id: attemptId, cost: 0, generationId: null, note: `provider refused before routing (HTTP ${e.httpStatus}); no generation id or cost reported` })
    // Anything else (timeout, lost connection, other HTTP errors with no usage) may still have been charged: unknown.
    await repository.recordModelResult({ attemptId, actualUsd: null, generationId: null, now: now().toISOString() })
    return fail('failure', e?.kind === 'timeout' ? 'Model took too long · text saved' : e?.httpStatus ? message : "Couldn't reach the model · text saved")
  }

  const read = readCaptureAnswer(answer)
  const proposals = read.items.map(i => toProposal(i, capture.text, openTasks)).filter((p): p is ProposalItem => !!p)
  const unreadable = read.unreadable + read.items.length - proposals.length
  // Nothing usable came back (Bumblebee): a failure with Retry, not an empty receipt. The cost is still recorded.
  if (unreadable > 0 && proposals.length === 0) return fail('failure', 'Model unavailable · text saved', { id: attemptId, cost, generationId })
  const latest = await repository.load()
  const command = {
    operationId: `organized:${captureId}:${revision}`, expectedRevision: latest.revision,
    action: { type: 'organized-capture' as const, captureId, revision, model: config.model, mode: deps.mode, proposals, unreadable, contextLine: `Organized by ${config.model} · Context: your text and open tasks` },
  }
  const r = await repository.recordModelResult({ attemptId, actualUsd: cost, generationId, now: now().toISOString() }, command)
  return r.refused ? 'stale' : 'organized'
}
