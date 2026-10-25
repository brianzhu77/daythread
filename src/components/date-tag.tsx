import type { LocalDate, Task } from '../domain/types'
import { plannedOn } from '../domain/workspace'
import { deadlinePassed, taskDateTag } from './dates'
import { useWorkspace } from './use-day'

/** The one date tag every task list uses, so a passed deadline reads red everywhere. */
export function DateTag({ task, today, pageDate = today, label }: { task: Task; today: LocalDate; pageDate?: LocalDate; label?: string }) {
  const { workspace } = useWorkspace()
  const text = label ?? taskDateTag(task, today, pageDate, workspace ? plannedOn(workspace, task.id) : null)
  if (!text) return null
  return <span className={`app-tag ${deadlinePassed(task, today) ? 'warn' : ''}`}>{text}</span>
}
