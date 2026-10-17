import type { Command, CommandResult, Workspace } from "../domain/types";

/** Adapter boundary: atomic revision check + domain mutation + receipt persistence.
 * Replays with the same operationId and action return the original receipt even at an old revision.
 * Implementations must pass tests/repository-contract.ts; UI and domain code never choose a database. */
export interface WorkspaceRepository {
  load(): Promise<Workspace>;
  execute(command: Command): Promise<CommandResult>;
}
