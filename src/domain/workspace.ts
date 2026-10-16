import type { Command, CommandResult, DayView, Workspace } from './types.ts'
export class DomainError extends Error {}
export function createEmptyWorkspace(): Workspace {
  return { schemaVersion: 1, revision: 0, timezone: 'America/Vancouver', pages: [], tasks: [], events: [], placements: [], materials: [], captures: [], receipts: {} }
}
// Signature baseline only. Implementation follows in the next commit.
export function applyCommand(_state: Workspace, _command: Command): CommandResult {
  throw new DomainError('Domain implementation in progress')
}
export function getDayView(_state: Workspace, _date: string): DayView {
  throw new DomainError('Domain implementation in progress')
}
