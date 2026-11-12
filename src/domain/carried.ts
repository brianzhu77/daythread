// B92: how long carry-over has brought a to-do, shown on today's page as "Since Nov 3" (first-version-checklist B92).
// Derived, never stored: an older tab shows nothing and Undo has nothing to take back. It counts from the later of the
// day the to-do was first saved and the last day he chose for it. A plan row on a day counts as chosen unless that
// day's draft applied the to-do: Apply is carry-over, while Planned, a move, Bring to today, resuming after Not today
// or typing it there are choices (Bumblebee 66544b2c, traced on his data).
//
// This relies on past days' drafts being kept: if they were ever pruned, a carried day would read as chosen and the
// badge would go. Nothing deletes a draft today except its day page going for good.
import { draftOf } from './day-draft.ts'
import type { LocalDate, Task, Workspace } from './types.ts'
import { addDays, isBlankTask, plannedOn, taskRows } from './workspace.ts'

/** A starting value for everyone, not tuned to one to-do (PRODUCT.md); later reads can move it. */
export const carriedDays = 7

/** The day `task` has been carried since, when it's open on today's plan and that's at least `carriedDays` ago; null otherwise. */
export function carriedSince(ws: Workspace, task: Task, today: LocalDate): LocalDate | null {
  if (task.status !== 'open' || task.paused || isBlankTask(task) || plannedOn(ws, task.id) !== today) return null
  let since = task.createdOn
  for (const r of taskRows(ws, task.id)) {
    const day = r.page.type === 'daily' ? r.page.date : null
    if (r.role !== 'plan' || !day || day > today || day <= since) continue
    if (draftOf(ws, r.page.id)?.items.some(i => i.taskId === task.id && i.state === 'applied')) continue
    since = day
  }
  return since <= addDays(today, -carriedDays) ? since : null
}
