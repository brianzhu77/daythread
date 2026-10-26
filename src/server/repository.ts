import type { Command, CommandResult, Workspace } from "../domain/types";

/** Adapter boundary: atomic revision check + domain mutation + receipt persistence.
 * Replays with the same operationId and action return the original receipt even at an old revision.
 * Implementations must pass tests/repository-contract.ts; UI and domain code never choose a database. */
export interface WorkspaceRepository {
  load(): Promise<Workspace>;
  execute(command: Command): Promise<CommandResult>;
}

/** What the server needs from a store. Implemented by SQLite and Postgres. */
export interface ServerRepository extends WorkspaceRepository {
  /** A server-only command applied to the workspace as it is now (the link preview): not refused because he typed meanwhile. */
  executeOnLatest(operationId: string, action: Command["action"]): Promise<CommandResult>;
}

/** The day a store converts an older workspace against, in the app's time zone. */
export const todayIn = (timeZone = 'America/Vancouver'): string => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
