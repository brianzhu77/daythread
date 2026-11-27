// The words a to-do's row says after an action, as pure functions: never imports React or a .tsx file, so node --test
// and scripts/export-core-fixtures.ts reach it.
import type { LocalDate, Receipt, Task } from '../domain/types.ts'
import { shortLabel, weekday } from './dates.ts'
import { noticeDate, type RowIntent } from './row-menu-model.ts'
import { noticeWithNext } from './todo-repeat-view.ts'

export function notTodayText(task: Task, date: LocalDate, today: LocalDate): string {
  const head = date === today ? 'Not today — won’t carry over' : `Not on ${shortLabel(date)}`
  return task.deadlineOn ? `${head} · due ${weekday(task.deadlineOn)} still tracked` : head
}

/** The fixed notices of a row: the button's, a refused action's and Undo's. */
export const rowNotices = {
  plannedForToday: 'Planned for today',
  notDone: 'Not done · your text is kept',
  undone: 'Undone',
  cantUndo: "Can't undo · changed since",
  couldntUndo: "Couldn't undo · your text is kept",
}

/**
 * The notice a row action leaves once the server has answered. `task` is the to-do as the row held it; `plannedAfter`
 * is `plannedOn` of the workspace after the answer.
 */
export function rowNoticeText(intent: RowIntent, { task, day, today, receipt, plannedAfter }: { task: Task; day: LocalDate; today: LocalDate; receipt: Pick<Receipt, 'message' | 'nextTodos'>; plannedAfter: LocalDate | null }): string {
  return intent.kind === 'move' ? `Moved to ${noticeDate(intent.date)}`
    : intent.kind === 'bring-today' ? 'On today'
    : intent.kind === 'not-today' ? (receipt.message.startsWith('Removed from') ? `Removed from ${weekday(day)} · still planned for ${weekday(plannedAfter ?? day)}` : notTodayText(task, day, today))
    : intent.kind === 'cancel' ? noticeWithNext('Cancelled', receipt, today) : 'Restored'
}
