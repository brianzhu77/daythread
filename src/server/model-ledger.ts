// Stored form of the model budget ledger (03 E3) and the rules around it. Pure helpers here; the SQLite repository
// runs them inside its own transactions. Amounts on disk are integer micro-USD; BudgetLedger works in USD.
import type { DatabaseSync } from 'node:sqlite'
import { reserveBudget, settleBudget, type BudgetLedger } from '../domain/budget.ts'

export type AttemptState = 'reserved' | 'unknown' | 'settled' | 'not-sent'
export interface ModelAttempt {
  id: string; captureId: string | null; revision: number | null; day: string
  reservedUsd: number; actualUsd: number | null; state: AttemptState
  generationId: string | null; model: string | null; createdAt: string; settledAt: string | null; note: string | null
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
  }))
}
/** A charge above its reservation stops further calls until someone looks (03 E3 point 7). */
export function toBudgetLedger(attempts: ModelAttempt[]): BudgetLedger {
  return {
    attempts: attempts.map(a => ({ id: a.id, day: a.day, reserved: a.reservedUsd, actual: a.actualUsd, state: a.state })),
    breached: attempts.some(a => a.actualUsd !== null && micros(a.actualUsd) > micros(a.reservedUsd)),
  }
}

export interface ReserveInput { id: string; captureId: string; revision: number; day: string; upperBoundUsd: number; model: string; now: string }
export function reserveAttempt(db: DatabaseSync, input: ReserveInput): ModelAttempt {
  const attempts = readAttempts(db)
  const existing = attempts.find(a => a.id === input.id)
  // Same attempt id and same input: a replay, no new reservation (reserveBudget refuses a different input).
  reserveBudget(toBudgetLedger(attempts), input.id, input.day, input.upperBoundUsd)
  if (existing) return existing
  db.prepare('INSERT INTO model_attempts (id,captureId,revision,day,reservedMicros,actualMicros,state,generationId,model,createdAt,settledAt,note) VALUES (?,?,?,?,?,NULL,?,NULL,?,?,NULL,NULL)')
    .run(input.id, input.captureId, input.revision, input.day, micros(input.upperBoundUsd), 'reserved', input.model, input.now)
  return readAttempts(db).find(a => a.id === input.id)!
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
  if (attempt.state === 'unknown' && input.actualUsd === null) return attempt
  settleBudget(toBudgetLedger(attempts), attempt.id, input.actualUsd)
  db.prepare('UPDATE model_attempts SET actualMicros=?, state=?, generationId=COALESCE(?, generationId), settledAt=?, note=COALESCE(?, note) WHERE id=?')
    .run(input.actualUsd === null ? null : micros(input.actualUsd), input.actualUsd === null ? 'unknown' : 'settled', input.generationId, input.actualUsd === null ? null : input.now, input.note ?? null, attempt.id)
  return readAttempts(db).find(a => a.id === attempt.id)!
}

/** After a restart nothing is in flight any more: a still-reserved attempt has an unknown outcome and keeps blocking. */
export function markInterrupted(db: DatabaseSync, now: string): number {
  return Number(db.prepare("UPDATE model_attempts SET state='unknown', note=COALESCE(note, ?) WHERE state='reserved'").run(`interrupted before ${now}`).changes)
}

/** Manual settlement of an unknown charge: an amount read from OpenRouter, or the reserved worst case. Never an implicit zero. */
export function reconcileAttempt(db: DatabaseSync, attemptId: string, amount: number | 'worst-case', now: string): ModelAttempt {
  const attempt = readAttempts(db).find(a => a.id === attemptId)
  if (!attempt) throw new Error('Unknown model attempt')
  if (attempt.state !== 'unknown') throw new Error(`Attempt is ${attempt.state}, not unknown`)
  const actual = amount === 'worst-case' ? attempt.reservedUsd : amount
  if (!Number.isFinite(actual) || actual < 0) throw new Error('Reconcile amount must be a non-negative number of USD')
  return settleAttempt(db, { attemptId, actualUsd: actual, generationId: null, now, note: amount === 'worst-case' ? 'reconciled at worst case' : 'reconciled by hand' })
}

/** What the browser may know: read-only, no amounts per attempt. */
export type ModelStatus = { state: 'ready' | 'paused' | 'budget-used' ; spentTodayUsd: number }
export function modelStatus(attempts: ModelAttempt[], day: string, capUsd = 10): ModelStatus {
  const ledger = toBudgetLedger(attempts)
  const spent = attempts.filter(a => a.day === day && a.state !== 'not-sent').reduce((s, a) => s + (a.actualUsd ?? a.reservedUsd), 0)
  if (ledger.breached || attempts.some(a => a.state === 'unknown')) return { state: 'paused', spentTodayUsd: spent }
  return { state: spent >= capUsd ? 'budget-used' : 'ready', spentTodayUsd: spent }
}
