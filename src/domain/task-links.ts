// A to-do blocked by another (docs/design/todo-dependency.md). A link is between tasks, not lines, kept in its own table, one direction:
// Blocking is read from the other side. A link whose end is gone is kept and not in force, so an older build deleting a task, or
// Undo bringing one back, needs nothing done to the links.
import type { Task, Workspace } from './types.ts'

export interface TaskLink { blockedId: string; blockerId: string; createdAt: string }
/** One link's row id: task ids are uuids, so this can't run two links together. */
export const linkId = (l: Pick<TaskLink, 'blockedId' | 'blockerId'>): string => `${l.blockedId}>${l.blockerId}`
export const linkLimits = { perTask: 50, total: 5_000 }

/** Done and cancelled don't hold anything up; paused still does, as it hasn't happened. */
const holds = (t: Task): boolean => t.status === 'open'
const finished = (t: Task): boolean => t.status !== 'open'

export interface Blocked { by: Task[] }
/**
 * Each to-do blocked now, with what blocks it, in the order the links were made. A link is in force while both ends have a live line,
 * the blocker isn't finished, and the to-do itself isn't either.
 */
export function blockedNow(ws: Workspace, liveIds: ReadonlySet<string>): Map<string, Blocked> {
  const out = new Map<string, Blocked>()
  if (!ws.links?.length) return out
  const live = new Map<string, Task>()
  for (const t of ws.tasks) if (liveIds.has(t.id)) live.set(t.id, t)
  for (const l of ws.links) {
    const blocked = live.get(l.blockedId), blocker = live.get(l.blockerId)
    if (!blocked || !blocker || finished(blocked) || !holds(blocker)) continue
    let entry = out.get(blocked.id)
    if (!entry) { entry = { by: [] }; out.set(blocked.id, entry) }
    entry.by.push(blocker)
  }
  return out
}

/** Would `blockedId` blocked by `blockerId` close a loop? Every link counts, in force or not, so reopening or restoring one can't complete a loop. */
export function makesLoop(links: readonly Pick<TaskLink, 'blockedId' | 'blockerId'>[], blockedId: string, blockerId: string): boolean {
  if (blockedId === blockerId) return true
  const blockersOf = new Map<string, string[]>()
  for (const l of links) { const list = blockersOf.get(l.blockedId); if (list) list.push(l.blockerId); else blockersOf.set(l.blockedId, [l.blockerId]) }
  // From the blocker, following what blocks it: reaching the blocked to-do means it already waits on it.
  const seen = new Set<string>(), stack = [blockerId]
  while (stack.length) {
    const at = stack.pop()!
    if (at === blockedId) return true
    if (seen.has(at)) continue
    seen.add(at)
    for (const next of blockersOf.get(at) ?? []) stack.push(next)
  }
  return false
}
/**
 * Links whose two to-dos both exist. A deleted to-do's are kept for Undo but count for nothing he can do: no loop, no limit (Bumblebee).
 * In Trash, paused or done still count, as he can bring those back himself.
 */
export const standingLinks = (ws: Pick<Workspace, 'links' | 'tasks'>): TaskLink[] => {
  if (!ws.links?.length) return []
  const ids = new Set(ws.tasks.map(t => t.id))
  return ws.links.filter(l => ids.has(l.blockedId) && ids.has(l.blockerId))
}
export const blockersOf = (ws: Pick<Workspace, 'links'>, taskId: string): string[] => (ws.links ?? []).filter(l => l.blockedId === taskId).map(l => l.blockerId)
export const blockingOf = (ws: Pick<Workspace, 'links'>, taskId: string): string[] => (ws.links ?? []).filter(l => l.blockerId === taskId).map(l => l.blockedId)
