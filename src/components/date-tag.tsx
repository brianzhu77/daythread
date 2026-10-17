import type { LocalDate, Task } from '../domain/types'
import { deadlinePassed, taskDateTag } from './dates'

/** The one date tag every task list uses, so a passed deadline reads red everywhere. */
export function DateTag({ task, today, pageDate = today, label }: { task: Task; today: LocalDate; pageDate?: LocalDate; label?: string }) {
  const text = label ?? taskDateTag(task, today, pageDate)
  if (!text) return null
  return <span className={`app-tag ${deadlinePassed(task, today) ? 'warn' : ''}`}>{text}</span>
}
