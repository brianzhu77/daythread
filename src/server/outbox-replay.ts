// The outbox's replay rule (docs/design/outbox.md §5), shared by both stores. Pure: the stores read and write, this
// decides. A change from the browser's outbox comes with the revision he made it against (`baseRevision`), the
// revisions its own earlier changes produced since (`ownRevisions`), and whether it reads rows it doesn't write
// (`readsBeyond`). It is applied only when nothing it writes was written by someone else after its base.
import type { Action, Page, Receipt, Workspace } from '../domain/types.ts'
import { pageKeys } from '../domain/conflict-keys.ts'
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
  /**
   * Held only because the workspace moved on since it was made: a part it writes was written by someone else, or it
   * reads beyond its writes and anything moved. Never a gap an older build left, a restored backup or a forgotten
   * receipt (Ratchet d6a88f04): only this may be handed back to a caller that rebuilds on the latest state.
   */
  readonly stale: boolean
  constructor(reason: HeldReason, rows: string[] = [], stale = false) { super(`Outbox change held: ${reason}`); this.name = 'OutboxHeld'; this.reason = reason; this.rows = rows; this.stale = stale }
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

/** Every stored row a workspace keeps as a page row, by id: pages, synced blocks' records, smart notes. */
function pageRowsOf(ws: Workspace): Map<string, Page> {
  return new Map([...ws.pages, ...(ws.synced ?? []), ...(ws.smartNotes ?? [])].map(p => [(p as { id: string }).id, p as Page]))
}

/**
 * What a commit from `before` to `after` touched, for the row check and the stamps: one key per task, deleted task,
 * thread and link row, the workspace's settings, and inside each page row the parts it changed (conflict-keys.ts:
 * Lead b9a9108b). `guards`: the lifecycle keys those parts sit under, checked but not stamped.
 */
export function conflictKeys(before: Workspace, after: Workspace, write: RowDiff): { writes: string[]; guards: string[] } {
  const writes = writeKeys({ ...write, pages: { upsert: [], remove: [] } }), guards = new Set<string>()
  const was = pageRowsOf(before), now = pageRowsOf(after)
  for (const id of new Set([...write.pages.upsert.map(r => r.id), ...write.pages.remove])) {
    const keys = pageKeys(was.get(id), now.get(id))
    writes.push(...keys.writes)
    for (const g of keys.guards) guards.add(g)
  }
  for (const key of writes) guards.delete(key)
  return { writes, guards: [...guards] }
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
 * Before applying: `as-is` when nothing moved since the base, or only his own earlier changes did (applied on the
 * latest revision, which is what it was made on); `whole` when the row
 * check can't be trusted for it (it reads beyond its writes, an older build wrote unstamped rows since its base, or a
 * receipt it may have had was forgotten); else `rows`.
 */
export function replayRule(basis: OutboxBasis, revision: number, stored: RowTracking): { rule: 'as-is' } | { rule: 'rows' } | { rule: 'whole'; reason: HeldReason; stale?: true } {
  if (basis.baseRevision === revision) return { rule: 'as-is' }
  // Made against a newer state than the store has now: the data was restored from a backup. Never applied over it.
  if (basis.baseRevision > revision) return { rule: 'whole', reason: 'changed-since' }
  // An older build may have written since the last stamp, with no command of this build after it yet to record the gap:
  // read it from the workspace as it is now, before deciding (Ratchet: the first replay after a rollback and forward).
  const tracking = stored.trackedThrough === revision ? stored : { ...stored, untrackedUntil: Math.max(stored.untrackedUntil, revision) }
  if (basis.baseRevision < tracking.forgottenThrough) return { rule: 'whole', reason: 'maybe-applied' }
  if (basis.baseRevision < tracking.untrackedUntil) return { rule: 'whole', reason: 'changed-since' }
  // Every revision since its base is one of his own earlier changes, acknowledged: the store holds exactly what it was
  // made on (the browser applied those first), so it applies as made, whatever it reads (gate e1a21c80, Ratchet
  // b6436b71). Only after the checks above, which no coverage can answer (Ratchet 58a63858).
  if (onlyOwnSince(basis, revision)) return { rule: 'as-is' }
  if (basis.readsBeyond) return { rule: 'whole', reason: 'changed-since', stale: true }
  return { rule: 'rows' }
}

/** Whether each revision after the base, up to `revision`, is one its own earlier changes produced. */
export function onlyOwnSince(basis: OutboxBasis, revision: number): boolean {
  if (revision - basis.baseRevision > basis.ownRevisions.length) return false
  const own = new Set(basis.ownRevisions)
  for (let r = basis.baseRevision + 1; r <= revision; r++) if (!own.has(r)) return false
  return true
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
