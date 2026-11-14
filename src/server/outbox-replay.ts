// The outbox's replay rule (docs/design/outbox.md §5), shared by both stores. Pure: the stores read and write, this
// decides. A change from the browser's outbox comes with the revision he made it against (`baseRevision`), the
// revisions its own earlier changes produced since (`ownRevisions`), and whether it reads rows it doesn't write
// (`readsBeyond`). It is applied only when nothing it writes was written by someone else after its base.
import type { Action, Receipt } from '../domain/types.ts'
import type { RowDiff } from './workspace-rows.ts'

export interface OutboxBasis {
  baseRevision: number
  ownRevisions: number[]
  /** Captured when he made it (buttons, template or copy adds, a change that fired a rule, anything made after a pending Undo). */
  readsBeyond: boolean
}

/** What a store keeps for the rule: the last revision it stamped, the start of a stretch an older build wrote unstamped, and the newest revision whose receipt it may have forgotten. */
export interface RowTracking { trackedThrough: number | null; untrackedUntil: number; forgottenThrough: number }
export const noTracking: RowTracking = { trackedThrough: null, untrackedUntil: 0, forgottenThrough: 0 }

export type HeldReason = 'conflict' | 'changed-since' | 'maybe-applied'
export class OutboxHeld extends Error {
  readonly reason: HeldReason
  readonly rows: string[]
  constructor(reason: HeldReason, rows: string[] = []) { super(`Outbox change held: ${reason}`); this.name = 'OutboxHeld'; this.reason = reason; this.rows = rows }
}

/** The key the row check uses for a stored row, or `settings` for the workspace's own fields. */
export function writeKeys(write: Omit<RowDiff, 'timezone'> & { timezone?: string }): string[] {
  const keys: string[] = []
  const add = (kind: string, set: { upsert: Array<{ id: string }>; remove: string[] } | undefined) => {
    for (const r of set?.upsert ?? []) keys.push(`${kind}:${r.id}`)
    for (const id of set?.remove ?? []) keys.push(`${kind}:${id}`)
  }
  add('page', write.pages); add('task', write.tasks); add('deleted', write.deleted); add('thread', write.threads); add('link', write.links)
  if (write.timezone !== undefined || write.weekStart !== undefined || write.todoAutomations !== undefined) keys.push('settings')
  return keys
}

/** Actions that read a row they don't write, whatever they turn out to do (§5). */
export function readsBeyondAction(action: Action): boolean {
  if (action.type === 'run-button' || action.type === 'run-row-button' || action.type === 'undo') return true
  if (action.type === 'add-row' && (action.template || action.copyOf)) return true
  return false
}
/** The same, once applied: a change that fired a rule ran its steps. */
export function readsBeyondApplied(action: Action, receipt: Receipt): boolean {
  const rules = receipt.automations
  return readsBeyondAction(action) || Boolean(rules && (rules.ran.length || rules.paused.length || rules.scheduled))
}

/**
 * Before applying: `as-is` when nothing moved since the base (its own revision check is exact); `whole` when the row
 * check can't be trusted for it (it reads beyond its writes, an older build wrote unstamped rows since its base, or a
 * receipt it may have had was forgotten); else `rows`.
 */
export function replayRule(basis: OutboxBasis, revision: number, tracking: RowTracking): { rule: 'as-is' } | { rule: 'rows' } | { rule: 'whole'; reason: HeldReason } {
  if (basis.baseRevision === revision) return { rule: 'as-is' }
  if (basis.baseRevision < tracking.forgottenThrough) return { rule: 'whole', reason: 'maybe-applied' }
  if (basis.readsBeyond || basis.baseRevision < tracking.untrackedUntil) return { rule: 'whole', reason: 'changed-since' }
  return { rule: 'rows' }
}

/** The rows of the write set someone else wrote after the base. A row never stamped (null) predates the outbox. */
export function rowConflicts(keys: string[], revisionOf: (key: string) => number | null | undefined, basis: OutboxBasis): string[] {
  const own = new Set(basis.ownRevisions)
  return keys.filter(key => { const at = revisionOf(key) ?? 0; return at > basis.baseRevision && !own.has(at) })
}

/** After a commit at `after` on top of `before`: the tracking to store. A gap means an older build wrote in between. */
export function trackedAfter(tracking: RowTracking, before: number, after: number): RowTracking {
  const gap = tracking.trackedThrough === null || tracking.trackedThrough !== before
  return { ...tracking, trackedThrough: after, untrackedUntil: gap ? Math.max(tracking.untrackedUntil, before) : tracking.untrackedUntil }
}
