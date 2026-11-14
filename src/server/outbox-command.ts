// B98 (docs/design/outbox.md §5): what `runOutboxCommand` does with a change, apart from the request itself, so the
// owner check and the outcomes are testable on both stores.
import type { Command, Receipt } from '../domain/types.ts'
import type { WorkspaceChanges } from '../domain/workspace-changes.ts'
import { DomainError } from '../domain/workspace.ts'
import type { ServerRepository } from './repository.ts'
import { OutboxHeld, type HeldReason, type OutboxBasis } from './outbox-replay.ts'

export type OutboxOutcome =
  | { status: 'owner-mismatch'; owner: string }
  | { status: 'applied'; receipt: Receipt; changes: WorkspaceChanges; owner: string }
  | { status: 'held'; reason: HeldReason; rows: string[]; owner: string }
  | { status: 'already-applied'; owner: string }
  | { status: 'refused'; message: string; owner: string }

/** Checked before anything runs (§5 step 0); then the store's rule. Only a failure of the store itself throws. */
export async function runOutbox(repo: ServerRepository, owner: string, data: Command & { expectedOwner: string; basis: OutboxBasis }): Promise<OutboxOutcome> {
  if (owner !== data.expectedOwner) return { status: 'owner-mismatch', owner }
  const { expectedOwner: _owner, basis, ...rest } = data
  try {
    const { receipt, changes } = await repo.executeOutbox({ ...rest, expectedRevision: basis.baseRevision }, basis)
    return { status: 'applied', receipt, changes, owner }
  } catch (error) {
    if (error instanceof OutboxHeld) return { status: 'held', reason: error.reason, rows: error.rows, owner }
    if (error instanceof DomainError) {
      // A tombstone: applied long ago, its receipt compacted; nothing to do (§5 step 1).
      if (/already applied/i.test(error.message)) return { status: 'already-applied', owner }
      return { status: 'refused', message: error.message, owner }
    }
    throw error
  }
}
