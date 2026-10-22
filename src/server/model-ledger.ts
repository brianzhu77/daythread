// Stored form of the model budget ledger (03 E3) and the rules around it. Pure helpers here; the SQLite repository
// runs them inside its own transactions. Amounts on disk are integer micro-USD; BudgetLedger works in USD.
import type { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { reserveBudget, settleBudget, type BudgetLedger } from '../domain/budget.ts'

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export type AttemptState = 'reserved' | 'unknown' | 'estimated' | 'settled' | 'not-sent'
export interface ModelAttempt {
  id: string; captureId: string | null; revision: number | null; day: string
  reservedUsd: number; actualUsd: number | null; state: AttemptState
  generationId: string | null; model: string | null; createdAt: string; settledAt: string | null; note: string | null
  /** Binds the attempt to the one result it produced (Ratchet #68): the command it applied, or "none". */
  resultFingerprint: string | null; resultOperationId: string | null
  /** Hash of the exact request body sent for this attempt. */
  requestHash: string | null
}
const micros = (usd: number) => Math.ceil(usd * 1_000_000)
const usd = (m: number) => m / 1_000_000

export function readAttempts(db: DatabaseSync): ModelAttempt[] {
  return db.prepare('SELECT * FROM model_attempts ORDER BY createdAt, id').all().map(r => ({
    id: String(r.id), captureId: r.captureId === null ? null : String(r.captureId), revision: r.revision === null ? null : Number(r.revision),
    day: String(r.day), reservedUsd: usd(Number(r.reservedMicros)), actualUsd: r.actualMicros === null ? null : usd(Number(r.actualMicros)),
    state: String(r.state) as AttemptState, generationId: r.generationId === null ? null : String(r.generationId),
    model: r.model === null ? null : String(r.model), createdAt: String(r.createdAt), settledAt: r.settledAt === null ? null : String(r.settledAt),
    note: r.note === null ? null : String(r.note),
    resultFingerprint: r.resultFingerprint === null ? null : String(r.resultFingerprint), resultOperationId: r.resultOperationId === null ? null : String(r.resultOperationId),
    requestHash: r.requestHash === null ? null : String(r.requestHash),
  }))
}
/** A charge above its reservation stops further calls until someone looks (03 E3 point 7). */
export function toBudgetLedger(attempts: ModelAttempt[]): BudgetLedger {
  return {
    attempts: attempts.map(a => ({ id: a.id, day: a.day, reserved: a.reservedUsd, actual: a.actualUsd, state: a.state })),
    breached: attempts.some(a => a.actualUsd !== null && micros(a.actualUsd) > micros(a.reservedUsd)),
  }
}

/**
 * What an attempt is for (A6b plan §7): a capture revision, or a run of Draft my day. Stored in the existing columns:
 * a capture keeps its id in `captureId`; a draft stores `draft:<date>` there and its run number in `revision`. No
 * Capture is ever created for a draft, and `costUnknownCaptureIds` only reads captures.
 */
export type AttemptSubject = { kind: 'capture'; id: string; revision: number } | { kind: 'draft'; date: string; run: number }
const subjectColumns = (s: AttemptSubject) => s.kind === 'capture' ? { captureId: s.id, revision: s.revision } : { captureId: `draft:${s.date}`, revision: s.run }
export const isDraftSubject = (captureId: string | null) => Boolean(captureId?.startsWith('draft:'))
export interface ReserveInput { id: string; subject: AttemptSubject; day: string; upperBoundUsd: number; model: string; requestHash: string; now: string; capUsd?: number }
/** 10 USD per day (Brian). DAYTHREAD_MODEL_CAP_USD may only lower it, e.g. to see "budget used up" on a test server. */
export function dailyCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const requested = Number(env.DAYTHREAD_MODEL_CAP_USD)
  return Number.isFinite(requested) && requested >= 0 && requested < 10 ? requested : 10
}
/** `replayed` = this id was already reserved with the same request: the caller must not send it again. */
export function reserveAttempt(db: DatabaseSync, input: ReserveInput): { attempt: ModelAttempt; replayed: boolean } {
  const attempts = readAttempts(db)
  const existing = attempts.find(a => a.id === input.id), columns = subjectColumns(input.subject)
  // Same attempt id and the same whole request: a replay, no new reservation. Anything else under that id is refused
  // (Ratchet #68: day and amount alone weren't enough).
  if (existing) {
    if (existing.captureId !== columns.captureId || existing.revision !== columns.revision || existing.day !== input.day || existing.model !== input.model || existing.requestHash !== input.requestHash || micros(existing.reservedUsd) !== micros(input.upperBoundUsd))
      throw new Error('Attempt identity reused with different input')
    return { attempt: existing, replayed: true }
  }
  reserveBudget(toBudgetLedger(attempts), input.id, input.day, input.upperBoundUsd, Math.min(input.capUsd ?? 10, 10))
  db.prepare('INSERT INTO model_attempts (id,captureId,revision,day,reservedMicros,actualMicros,state,generationId,model,createdAt,settledAt,note,resultFingerprint,resultOperationId,requestHash) VALUES (?,?,?,?,?,NULL,?,NULL,?,?,NULL,NULL,NULL,NULL,?)')
    .run(input.id, columns.captureId, columns.revision, input.day, micros(input.upperBoundUsd), 'reserved', input.model, input.now, input.requestHash)
  return { attempt: readAttempts(db).find(a => a.id === input.id)!, replayed: false }
}

export interface SettleInput { attemptId: string; actualUsd: number | null; generationId: string | null; now: string; note?: string }
/** First record wins: the same values again are a no-op, different values are refused (Ratchet). */
export function settleAttempt(db: DatabaseSync, input: SettleInput): ModelAttempt {
  const attempts = readAttempts(db)
  const attempt = attempts.find(a => a.id === input.attemptId)
  if (!attempt) throw new Error('Unknown model attempt')
  if (attempt.state === 'settled') {
    if (attempt.actualUsd === null || micros(attempt.actualUsd) !== micros(input.actualUsd ?? -1) || (input.generationId !== null && attempt.generationId !== null && attempt.generationId !== input.generationId))
      throw new Error('Model attempt already settled with different values')
    return attempt
  }
  if (input.actualUsd === null) {
    // No cost. With a generation id the charge can still be looked up: "unknown", calls pause. Without one there is
    // nothing to look up: "estimated" at the reservation, an upper bound, and calls go on (Lead 33ae4578). Never zero.
    const state = input.generationId ?? attempt.generationId ? 'unknown' : 'estimated'
    if (attempt.state === state) return attempt
    if (attempt.state === 'unknown') return attempt // an id was seen once; losing it later doesn't lift the pause
    db.prepare('UPDATE model_attempts SET state=?, generationId=COALESCE(?, generationId), note=COALESCE(?, note) WHERE id=?')
      .run(state, input.generationId, input.note ?? (state === 'estimated' ? 'no generation id or cost; counted at the reserved upper bound' : null), attempt.id)
    return readAttempts(db).find(a => a.id === attempt.id)!
  }
  settleBudget(toBudgetLedger(attempts), attempt.id, input.actualUsd)
  // A real cost replaces an estimate or an unknown: only the ledger changes; the result is bound separately.
  db.prepare('UPDATE model_attempts SET actualMicros=?, state=?, generationId=COALESCE(?, generationId), settledAt=?, note=COALESCE(?, note) WHERE id=?')
    .run(micros(input.actualUsd), 'settled', input.generationId, input.now, input.note ?? null, attempt.id)
  return readAttempts(db).find(a => a.id === attempt.id)!
}

/**
 * After a restart nothing is in flight any more. A still-reserved attempt never got a reply, so it has no generation id
 * and no cost: estimated at its reservation, and calls go on (Lead 33ae4578). `olderThan` limits it to attempts
 * reserved before that time, for a store other live processes may still be working in.
 */
export function markInterrupted(db: DatabaseSync, now: string, olderThan?: string): number {
  return Number(db.prepare("UPDATE model_attempts SET state='estimated', note=COALESCE(note, ?) WHERE state='reserved' AND (? IS NULL OR createdAt < ?)")
    .run(`interrupted before ${now}; counted at the reserved upper bound`, olderThan ?? null, olderThan ?? null).changes)
}

/** Manual settlement of an unknown or estimated charge: an amount read from OpenRouter, or the reserved worst case. Never an implicit zero. */
/** `from`: the states it may settle (the /generation lookup passes only 'unknown'). */
export function reconcileAttempt(db: DatabaseSync, attemptId: string, amount: number | 'worst-case', now: string, note?: string, from: readonly AttemptState[] = ['unknown', 'estimated']): ModelAttempt {
  const attempt = readAttempts(db).find(a => a.id === attemptId)
  if (!attempt) throw new Error('Unknown model attempt')
  if (!from.includes(attempt.state)) throw new Error(`Attempt is ${attempt.state}, not ${from.join(' or ')}`)
  const actual = amount === 'worst-case' ? attempt.reservedUsd : amount
  if (!Number.isFinite(actual) || actual < 0) throw new Error('Reconcile amount must be a non-negative number of USD')
  return settleAttempt(db, { attemptId, actualUsd: actual, generationId: null, now, note: note ?? (amount === 'worst-case' ? 'reconciled at worst case' : 'reconciled by hand') })
}

/** Captures with a charge not yet confirmed: their receipt says "Cost unknown" until the real cost arrives (Jazz 4e8c2f1). */
export function costUnknownCaptureIds(attempts: ModelAttempt[]): string[] {
  return [...new Set(attempts.filter(a => (a.state === 'estimated' || a.state === 'unknown') && a.captureId && !isDraftSubject(a.captureId)).map(a => a.captureId!))]
}

/** What the browser may know: read-only, no amounts per attempt. */
export type ModelStatus = { state: 'ready' | 'paused' | 'budget-used' ; spentTodayUsd: number }
export function modelStatus(attempts: ModelAttempt[], day: string, capUsd = dailyCapUsd()): ModelStatus {
  const ledger = toBudgetLedger(attempts)
  const spent = attempts.filter(a => a.day === day && a.state !== 'not-sent').reduce((s, a) => s + (a.actualUsd ?? a.reservedUsd), 0)
  if (ledger.breached || attempts.some(a => a.state === 'unknown')) return { state: 'paused', spentTodayUsd: spent }
  return { state: spent >= capUsd ? 'budget-used' : 'ready', spentTodayUsd: spent }
}

/**
 * The result an attempt produced, bound once (Ratchet #68). Returns the operation id of the first result when the same
 * result comes again, and refuses a different one; null means this is the first result for the attempt.
 */
export function bindResult(db: DatabaseSync, attemptId: string, fingerprint: string, operationId: string | null): string | null {
  const attempt = readAttempts(db).find(a => a.id === attemptId)
  if (!attempt) throw new Error('Unknown model attempt')
  if (attempt.resultFingerprint !== null) {
    if (attempt.resultFingerprint !== fingerprint) throw new Error('Model attempt already settled with a different result')
    return attempt.resultOperationId ?? 'none'
  }
  db.prepare('UPDATE model_attempts SET resultFingerprint=?, resultOperationId=? WHERE id=?').run(fingerprint, operationId, attemptId)
  return null
}
