import { strippedWorkspace } from '../domain/synced.ts'
import type { Workspace } from '../domain/types.ts'

/**
 * What the browser gets: the workspace without the receipts and without the undo copy. Replay lookups happen on the
 * server, and the browser only reads which operation Undo targets (use-day.tsx). Both grow with every save, so sending
 * them made every load and command response megabytes (a receipt's fingerprint is the whole action). Synced blocks' lines
 * travel once, in their records.
 */
export function forBrowser(workspace: Workspace): Workspace {
  const { receipts: _receipts, undo, ...rest } = strippedWorkspace(workspace)
  return { ...rest, receipts: {}, ...(undo ? { undo: { operationId: undo.operationId, revision: undo.revision } } : {}) }
}
