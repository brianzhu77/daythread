import type { LocalDate, Task, Workspace } from './types.ts'
import { addDays, DomainError, isBlankTask, plannedOn } from './workspace.ts'

export type UpcomingKind = 'do' | 'start' | 'due'
export interface UpcomingTaskDate { readonly task: Readonly<Task>; readonly kinds: readonly UpcomingKind[] }
export interface UpcomingDay { readonly date: LocalDate; readonly tasks: readonly UpcomingTaskDate[] }

/**
 * Date facts only: the planned day (a plan row on a day page) = do, attentionOn = start, deadlineOn = due. One row per
 * open task per date; coincident dates share that row's kinds. Bounds are inclusive; omit `through` for every date after `from`.
 */
export function getUpcomingByDate(workspace: Readonly<Workspace>, from: LocalDate, through?: LocalDate): readonly UpcomingDay[] {
  addDays(from, 0)
  if (through !== undefined) {
    addDays(through, 0)
    if (through < from) throw new DomainError('Upcoming end precedes start')
  }
  const days = new Map<LocalDate, Map<string, { task: Readonly<Task>; kinds: UpcomingKind[] }>>()
  for (const task of workspace.tasks) {
    if (task.status !== 'open' || isBlankTask(task)) continue
    const facts: [UpcomingKind, LocalDate | null][] = [['do', plannedOn(workspace, task.id)], ['start', task.attentionOn], ['due', task.deadlineOn]]
    for (const [kind, date] of facts) {
      if (date === null || date < from || (through !== undefined && date > through)) continue
      let rows = days.get(date)
      if (!rows) days.set(date, rows = new Map())
      let row = rows.get(task.id)
      if (!row) rows.set(task.id, row = { task, kinds: [] })
      if (!row.kinds.includes(kind)) row.kinds.push(kind)
    }
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({
    date,
    tasks: [...rows.values()].sort((a, b) => a.task.createdOn.localeCompare(b.task.createdOn) || a.task.id.localeCompare(b.task.id)),
  }))
}
