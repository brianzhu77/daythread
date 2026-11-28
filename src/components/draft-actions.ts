// The day draft's commands, as pure functions: never imports React or a .tsx file, so node --test and
// scripts/export-core-fixtures.ts reach it (the native app is held to the cases made from it).
import { draftOf } from '../domain/day-draft.ts'
import type { Action, LocalDate, Workspace } from '../domain/types.ts'
import { plannedOn } from '../domain/workspace.ts'

/**
 * What a skip notice acts on (Ratchet da1ca677): the items, the skip that set them aside, and each to-do's planned day
 * as the notice was shown. Move to and Undo are refused for what changed since, in this tab or any other.
 */
export interface DraftTicket { itemIds: string[]; skippedBy: string; seen: Record<string, LocalDate | null> }

/** `edits`: his words for a new to-do or line, by item. */
export function applyDraftAction(pageId: string, itemIds: string[], today: LocalDate, edits?: Record<string, string>): Action {
  return { type: 'apply-draft', pageId, itemIds, ...(edits ? { edits } : {}), today }
}

export function skipDraftAction(pageId: string, itemIds: string[]): Action {
  return { type: 'skip-draft', pageId, itemIds }
}

/** `seen`: for each skipped item that is a to-do, in the draft's order, the day its to-do is planned for (null: none). */
export function draftTicket(ws: Workspace, pageId: string, itemIds: string[], skippedBy: string): DraftTicket {
  const seen: Record<string, LocalDate | null> = {}
  for (const item of draftOf(ws, pageId)?.items ?? []) if (item.taskId && itemIds.includes(item.id)) seen[item.id] = plannedOn(ws, item.taskId)
  return { itemIds, skippedBy, seen }
}

/** The skip notice's Undo once the workspace's one Undo has moved on: reopens what that skip left. */
export function reopenDraftAction(pageId: string, ticket: DraftTicket): Action {
  return { type: 'reopen-draft', pageId, itemIds: ticket.itemIds, skippedBy: ticket.skippedBy, seen: ticket.seen }
}
