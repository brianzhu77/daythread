// Settling a model attempt together with the workspace command its result implies. Shared by the SQLite and Postgres
// repositories, which each run it inside their own transaction.
import type { DatabaseSync } from 'node:sqlite'
import { applyCommand, DomainError } from '../domain/workspace.ts'
import type { Command, CommandResult, Workspace } from '../domain/types.ts'
import { bindResult, settleAttempt, sha256, type ModelAttempt, type SettleInput } from './model-ledger.ts'

/** The workspace as the enclosing transaction sees it. */
export interface WorkspaceAccess {
  read(): Workspace | undefined
  write(before: Workspace, after: Workspace): void
}
export type ModelResultOutcome = { attempt: ModelAttempt; result?: CommandResult; refused?: string }
export type CommandOrBuild = Command | ((current: Workspace) => Command)

/**
 * A command the domain refuses (the capture moved on) leaves the settlement in place and applies nothing; any other
 * failure throws, so the caller rolls back both and a charge and its applied items never come apart.
 */
export function recordModelResult(ledger: DatabaseSync, workspace: WorkspaceAccess, input: SettleInput, commandOrBuild?: CommandOrBuild, options: { failAfterWrite?: boolean } = {}): ModelResultOutcome {
  const read = () => { const w = workspace.read(); if (!w) throw new Error('Workspace missing'); return w }
  // A builder gets the workspace as it is inside this transaction, so a background result isn't refused just
  // because he typed meanwhile (its expectedRevision is current). Its own checks (runId, status) still apply.
  const command = typeof commandOrBuild === 'function' ? commandOrBuild(read()) : commandOrBuild
  const attempt = settleAttempt(ledger, input)
  let result: CommandResult | undefined, refused: string | undefined
  // No cost and no result = "outcome not known yet" (timeout, lost reply). That binds nothing, so the real result
  // arriving later is recorded normally (Ratchet #68 fixed-identity).
  if (input.actualUsd === null && !command) return { attempt }
  // A real result without a cost: applied once and counted at the worst case (the reservation): "unknown" (calls
  // pause) when it has a generation id, "estimated" when it doesn't. Never settled as null or zero (Lead c8706da8, 33ae4578).
  if (input.actualUsd === null && attempt.state === 'unknown') ledger.prepare("UPDATE model_attempts SET note=? WHERE id=?").run('result recorded without a cost; counted at worst case until reconciled', input.attemptId)
  // One attempt, one result: the same result again replays the first receipt; a different one is refused.
  // Fingerprint = the business result only: what it applies + which generation (Lead, after d25b6c28). Cost is a
  // ledger field checked separately by settleAttempt, and may be filled in later without touching the result.
  const fingerprint = sha256(JSON.stringify([command ? command.action : null, input.generationId]))
  const earlier = bindResult(ledger, input.attemptId, fingerprint, command?.operationId ?? null)
  if (earlier !== null) {
    const current = workspace.read()
    const receipt = earlier === 'none' ? undefined : current?.receipts[earlier]
    return { attempt, ...(receipt && current ? { result: { workspace: current, receipt } } : {}), ...(command && !receipt ? { refused: 'Result already recorded for this attempt' } : {}) }
  }
  if (command) {
    const current = read()
    try { result = applyCommand(current, command) } catch (error) {
      if (!(error instanceof DomainError)) throw error
      refused = error.message
    }
    if (result && result.workspace.revision !== current.revision) workspace.write(current, result.workspace)
  }
  if (options.failAfterWrite) throw new Error('injected failure after write') // test hook for the atomicity check
  return { attempt, result, refused }
}
