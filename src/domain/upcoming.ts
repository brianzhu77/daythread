import type { LocalDate, Task, Workspace } from './types.ts'
import { addDays, DomainError } from './workspace.ts'

export type UpcomingKind = 'do' | 'start' | 'due'
export interface UpcomingTaskDate {
  readonly task: Readonly<Task>
  readonly kinds: readonly UpcomingKind[]
}
export interface UpcomingDay {
  readonly date: LocalDate
  readonly tasks: readonly UpcomingTaskDate[]
}

/**
 * Date facts only: plannedOn=do, attentionOn=start, deadlineOn=due (01 §76).
 * One row per open Task per date; coincident fields share that row's kind tags.
 * Pausing never hides a real deadline or silently clears any other date fact.
 * Bounds are inclusive. Omit `through` for all known dates after `from`, without
 * the UI prototype's 14-day cutoff. This query never creates pages/placements.
 */
export function getUpcomingByDate(
  workspace: Readonly<Workspace>,
  from: LocalDate,
  through?: LocalDate,
): readonly UpcomingDay[] {
  addDays(from, 0) // reuse the domain's strict calendar-date validation
  if (through !== undefined) {
    addDays(through, 0)
    if (through < from) throw new DomainError('Upcoming end precedes start')
  }
  const days = new Map<LocalDate, Map<string, { task: Readonly<Task>; kinds: UpcomingKind[] }>>()
  const fields = [['do', 'plannedOn'], ['start', 'attentionOn'], ['due', 'deadlineOn']] as const
  for (const task of workspace.tasks) {
    if (task.status !== 'open') continue
    for (const [kind, field] of fields) {
      const date = task[field]
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
    tasks: [...rows.values()].sort((a, b) =>
      a.task.createdOn.localeCompare(b.task.createdOn) || a.task.id.localeCompare(b.task.id)),
  }))
}
