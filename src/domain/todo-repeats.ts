// A repeating to-do (docs/design/repeating-to-dos.md §4): the schedule and the day the next one lands on. Pure: a repeat names its current
// to-do and the day that one was made for; finishing it makes the next, so nothing here wakes on its own. A repeat whose to-do is gone is
// kept and not in force, like a link, so an older build deleting a task, or Undo bringing one back, needs nothing done to it.
import { addDays } from './database.ts'
import { firstOccurrenceAfter } from './repeats.ts'
import type { LocalDate, WeekStart, Workspace } from './types.ts'

export interface TodoRepeat {
  id: string
  /** The current to-do, and the schedule day it was made for. Planned moves with Another day; this doesn't. */
  taskId: string; slot: LocalDate
  /** The one before, so reopening it can take the next one back. One step only. */
  previous?: { taskId: string; slot: LocalDate }
  /** Where the schedule starts. Fixed, so monthly from the 31st stays the 31st after a February. */
  start: LocalDate
  every: 'day' | 'week' | 'month' | 'year'; interval: number
  /** Weekly and `from: 'schedule'` only, 0 is Sunday. The start's weekday when absent. */
  weekdays?: number[]
  from: 'schedule' | 'done'
  until?: LocalDate
  createdAt: string
}
export type TodoRepeatRule = Pick<TodoRepeat, 'every' | 'interval' | 'weekdays' | 'from' | 'until'>
export const todoRepeatLimits = { total: 1_000 }

/** Stable for a repeat and a day: what keeps a retry, a second tab or a rollback to one to-do. */
export const repeatTaskId = (repeatId: string, slot: LocalDate): string => `${repeatId.slice(0, 100)}.${slot}`

/** Repeats whose current to-do is in `ws.tasks`. One whose to-do is gone is kept, not in force. */
export function standingRepeats(ws: Pick<Workspace, 'todoRepeats' | 'tasks'>): TodoRepeat[] {
  if (!ws.todoRepeats?.length) return []
  const ids = new Set(ws.tasks.map(t => t.id))
  return ws.todoRepeats.filter(r => ids.has(r.taskId))
}
/** The standing repeat this to-do is the current one of. */
export function repeatOf(ws: Pick<Workspace, 'todoRepeats' | 'tasks'>, taskId: string): TodoRepeat | undefined {
  return standingRepeats(ws).find(r => r.taskId === taskId)
}

const later = (a: LocalDate, b: LocalDate) => (a > b ? a : b)
const step = (r: TodoRepeat, day: LocalDate) => firstOccurrenceAfter({ every: r.every, interval: r.interval, start: day }, day)
const within = (r: TodoRepeat, d: LocalDate | null) => (d && (!r.until || d <= r.until) ? d : null)

/** The day the next to-do is made for when this one is finished: what was missed is skipped, never made up. */
export function nextDay(repeat: TodoRepeat, finishedOn: LocalDate, weekStart: WeekStart = 0): LocalDate | null {
  return within(repeat, repeat.from === 'done'
    ? step(repeat, finishedOn)
    : firstOccurrenceAfter(repeat, later(repeat.slot, finishedOn), weekStart))
}
/** Like `nextDay`, for a finished to-do found without a next one: never a day in the past. `finishedOn` is null when none was recorded. */
export function mendDay(repeat: TodoRepeat, finishedOn: LocalDate | null, today: LocalDate, weekStart: WeekStart = 0): LocalDate | null {
  if (repeat.from === 'schedule') return within(repeat, firstOccurrenceAfter(repeat, later(repeat.slot, addDays(today, -1)), weekStart))
  const d = finishedOn ? step(repeat, finishedOn) : step(repeat, today)
  return within(repeat, d && finishedOn ? later(d, today) : d)
}

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** The rule in words, for the menu and the notice. The end isn't part of it. */
export function repeatWords(rule: TodoRepeatRule): string {
  let words = rule.interval === 1 ? `every ${rule.every}` : `every ${rule.interval} ${rule.every}s`
  if (rule.from === 'done') return `${words}, from when it's done`
  if (rule.weekdays?.length) words += ` on ${[...rule.weekdays].sort((a, b) => a - b).map(d => dayNames[d]).join(', ')}`
  return words
}

export interface DueTodoRepeat { repeat: TodoRepeat; on: LocalDate }
/** Standing repeats whose current to-do is finished and whose mend day exists. With `live`, only to-dos in it. */
export function dueTodoRepeats(ws: Pick<Workspace, 'todoRepeats' | 'tasks' | 'weekStart'>, today: LocalDate, live?: ReadonlySet<string>): DueTodoRepeat[] {
  const out: DueTodoRepeat[] = []
  for (const repeat of standingRepeats(ws)) {
    if (live && !live.has(repeat.taskId)) continue
    const task = ws.tasks.find(t => t.id === repeat.taskId)
    if (!task || task.status === 'open') continue
    const on = mendDay(repeat, task.status === 'done' ? task.doneOn ?? null : null, today, ws.weekStart ?? 0)
    if (on) out.push({ repeat, on })
  }
  return out
}
