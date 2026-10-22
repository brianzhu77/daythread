import type { Command, CommandResult, Workspace } from "../domain/types";
import type { AttemptState, ModelAttempt, ReserveInput, SettleInput } from "./model-ledger";
import type { CommandOrBuild, ModelResultOutcome } from "./model-result";

/** Adapter boundary: atomic revision check + domain mutation + receipt persistence.
 * Replays with the same operationId and action return the original receipt even at an old revision.
 * Implementations must pass tests/repository-contract.ts; UI and domain code never choose a database. */
export interface WorkspaceRepository {
  load(): Promise<Workspace>;
  execute(command: Command): Promise<CommandResult>;
}

/** What the server (model work included) needs from a store: the workspace plus the model budget ledger, which
 * lives outside the workspace so Undo never brings back spend. Implemented by SQLite and Postgres. */
export interface ServerRepository extends WorkspaceRepository {
  modelAttempts(): Promise<ModelAttempt[]>;
  reserveModelAttempt(input: ReserveInput): Promise<{ attempt: ModelAttempt; replayed: boolean }>;
  recordModelResult(input: SettleInput, commandOrBuild?: CommandOrBuild, options?: { failAfterWrite?: boolean }): Promise<ModelResultOutcome>;
  executeOnLatest(operationId: string, action: Command["action"]): Promise<CommandResult>;
  markInterruptedModelAttempts(now: string, olderThan?: string): Promise<number>;
  reconcileModelAttempt(attemptId: string, amount: number | "worst-case", now: string, note?: string, from?: readonly AttemptState[]): Promise<ModelAttempt>;
}
