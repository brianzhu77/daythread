import type { Command, CommandResult, Workspace } from "../domain/types";
import type { WorkspaceChanges } from "../domain/workspace-changes";
import type { OutboxBasis } from "./outbox-replay.ts";

/** Adapter boundary: atomic revision check + domain mutation + receipt persistence.
 * Replays with the same operationId and action return the original receipt even at an old revision.
 * Implementations must pass tests/repository-contract.ts; UI and domain code never choose a database. */
export interface WorkspaceRepository {
  load(): Promise<Workspace>;
  execute(command: Command): Promise<CommandResult>;
}

/** What the server needs from a store. Implemented by SQLite and Postgres. */
export interface ServerRepository extends WorkspaceRepository {
  /** Also what the command changed, for a browser that applies changes instead of taking the whole workspace. */
  execute(command: Command): Promise<CommandResult & { changes: WorkspaceChanges }>;
  /** A server-only command applied to the workspace as it is now (the link preview): not refused because he typed meanwhile. */
  executeOnLatest(operationId: string, action: Command["action"]): Promise<CommandResult>;
  /** A change from the browser's outbox (outbox.md §5): applied by the row rule, or `OutboxHeld` thrown with nothing written. */
  executeOutbox(command: Command, basis: OutboxBasis): Promise<CommandResult & { changes: WorkspaceChanges }>;
  /** Everything stored for this workspace that could hold a file's id, including what Undo can bring back (R3-11's sweep). */
  heldText(): Promise<string>;
}

/** The day a store converts an older workspace against, in the app's time zone. */
export const todayIn = (timeZone = 'America/Vancouver'): string => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
