// "Plan on a day" from the strip and the rows, as pure functions: never imports React or a .tsx file, so node --test
// and scripts/export-core-fixtures.ts reach it (the native app is held to the cases made from it).
import type { Action, LocalDate } from '../domain/types.ts'
import { shortLabel } from './dates.ts'

/** `from`: the day page the move is made from; its row leaves it unless that day is past. */
export function planOnAction(taskId: string, date: LocalDate, today: LocalDate, from?: LocalDate): Action {
  return { type: 'plan-task', taskId, date, today, ...(from ? { from } : {}) }
}

/** The notice once the server has taken it: "On today", "Moved to Sat 11/28". */
export function planOnNotice(date: LocalDate, today: LocalDate): string {
  return date === today ? 'On today' : `Moved to ${shortLabel(date)}`
}
