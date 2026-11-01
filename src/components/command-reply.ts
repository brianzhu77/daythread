// What a command's reply makes of the tab's copy (perf/command-changes, Lead 6f528f6e).
import type { Workspace } from '../domain/types.ts'
import { applyChanges, type WorkspaceChanges } from '../domain/workspace-changes.ts'

export interface CommandReply { owner: string; workspace?: Workspace; changes?: WorkspaceChanges }

/**
 * The workspace after the command, or null when the tab must load it whole: the changes start from another revision
 * (a replay), or the reply is another account's. That happens when another tab signed in as someone else and the cookie
 * changed under this one; the revisions may still match, so applying would mix that account's changes into this copy.
 * `ownerBefore`: whose workspace the copy is (null: not known yet). A whole workspace in the reply replaces the copy.
 */
export function replyWorkspace(copy: Workspace, reply: CommandReply, ownerBefore: string | null): Workspace | null {
  if (!reply.changes) return reply.workspace ?? null
  if (reply.owner !== ownerBefore) return null
  return applyChanges(copy, reply.changes)
}
