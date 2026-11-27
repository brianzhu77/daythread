// What a to-do's row on a day page draws beside its words, as a pure function: never imports React or a .tsx file, so
// node --test and scripts/export-core-fixtures.ts reach it.
import { carriedSince } from '../domain/carried.ts'
import type { LocalDate, Task, Workspace } from '../domain/types.ts'
import { blockedByWords, blockedIn } from './blockers-view.ts'
import { deadlinePassed, fromIso, shortLabel, taskDateTag } from './dates.ts'
import { repeatMarkName, repeatsIn } from './todo-repeat-view.ts'

// Inside a document only real dates earn a chip; "Unscheduled" is list-screen vocabulary and would be noise here.
/** "Nov 3", with the year when it isn't this one: the date chip's words without its weekday, which a long line has no room for. */
export function sinceLabel(day: string, today: string): string {
  return fromIso(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) })
}
export function hasDateFacts(task: Task): boolean {
  return Boolean(task.deadlineOn || task.attentionOn)
}

/** Each mark of the row as the words drawn, or null where it is not drawn. */
export interface RowMarks {
  cancelled: string | null
  reference: string | null
  movedTo: string | null
  dateTag: { text: string; warn: boolean } | null
  since: string | null
  repeat: string | null
  blockedBy: string | null
  /** The reference row's button: `hidden` keeps its space on a done or cancelled to-do. */
  planForToday: 'active' | 'hidden' | null
}

/**
 * `ws`: null or undefined while the workspace is not loaded. `task`: the to-do as the row shows it (a tick not yet saved included); undefined where the workspace does not hold it.
 * `planned`: its planned day. `storedStatus`: its saved status when that is not `task.status`; `Cancelled` follows it.
 */
export function rowMarks(
  ws: Workspace | null | undefined, task: Task | undefined,
  { role, planDate, today, planned, storedStatus = task?.status }: { role: string; planDate: LocalDate; today: LocalDate; planned: LocalDate | null; storedStatus?: Task['status'] },
): RowMarks {
  const open = task?.status === 'open'
  const text = open && hasDateFacts(task) ? taskDateTag(task, today, planDate || today, planned) : ''
  const since = ws && task && role === 'plan' && planDate === today ? carriedSince(ws, task, today) : null
  const repeat = ws && open ? repeatsIn(ws).get(task.id) : undefined
  const blocked = ws && task ? blockedIn(ws).get(task.id) : undefined
  return {
    cancelled: task && storedStatus === 'cancelled' ? 'Cancelled' : null,
    reference: role === 'reference' ? 'Reference' : null,
    // A history row: the task's plan moved on to a later day; the row stays as the record of where it was.
    movedTo: role === 'plan' && open && planned && planDate && planned !== planDate ? `Moved to ${shortLabel(planned)}` : null,
    dateTag: text ? { text, warn: deadlinePassed(task!, today) } : null,
    since: open && since ? `Since ${sinceLabel(since, today)}` : null,
    repeat: repeat ? repeatMarkName(repeat) : null,
    blockedBy: blocked ? blockedByWords(blocked) : null,
    planForToday: role === 'reference' && task ? (open ? 'active' : 'hidden') : null,
  }
}
