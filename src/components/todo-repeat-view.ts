// Repeating to-dos, the screen (docs/design/repeating-to-dos.md §3): everything about it a test can decide, as pure functions.
// Never imports React or a .tsx file: node --test reaches this file.
import { addDays } from '../domain/database.ts'
import { todoStatus } from '../domain/todos-source.ts'
import { dueTodoRepeats, nextDay, repeatWords, type DueTodoRepeat, type TodoRepeat, type TodoRepeatRule } from '../domain/todo-repeats.ts'
import type { Action, LocalDate, Receipt, WeekStart, Workspace } from '../domain/types.ts'
import { taskRows } from '../domain/workspace.ts'
import { fromIso } from './dates.ts'

const none: ReadonlyMap<string, TodoRepeat> = new Map()
const worked = new WeakMap<Workspace, ReadonlyMap<string, TodoRepeat>>()
/** Open to-dos that are some repeat's current one, by to-do id; worked out once for each copy of the workspace. */
export function repeatsIn(ws: Workspace): ReadonlyMap<string, TodoRepeat> {
  if (!ws.todoRepeats?.length) return none
  let found = worked.get(ws)
  if (!found) {
    const open = new Set(ws.tasks.filter(t => t.status === 'open').map(t => t.id))
    found = new Map(ws.todoRepeats.filter(r => open.has(r.taskId)).map(r => [r.taskId, r]))
    worked.set(ws, found)
  }
  return found
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** `Repeat…`, or `Repeat · Every week…` once it repeats. */
export function repeatMenuLabel(rule: TodoRepeatRule | undefined): string {
  return rule ? `Repeat · ${upperFirst(repeatWords(rule))}…` : 'Repeat…'
}
/** The icon's accessible name: `Repeats every week`. */
export function repeatMarkName(rule: TodoRepeatRule): string {
  return `Repeats ${repeatWords(rule)}`
}

/** `Mon, Dec 7`; with the year when it isn't `today`'s: `Wed, Nov 24, 2027`. */
export function nextDayLabel(on: LocalDate, today: LocalDate): string {
  return fromIso(on).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(on.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' as const } : {}),
  })
}
/** A notice's words with the next one's day, when the command made exactly one; otherwise `text` itself. */
export function noticeWithNext(text: string, receipt: Pick<Receipt, 'nextTodos'>, today: LocalDate): string {
  const made = receipt.nextTodos
  return made?.length === 1 ? `${text} · Next ${nextDayLabel(made[0]!.on, today)}` : text
}
/** The editor's last line: `Next Mon, Dec 7`, `Next Sun, Nov 29 if done today`, or `Ends after this one`. */
export function nextLine(repeat: TodoRepeat, today: LocalDate, weekStart?: WeekStart): string {
  const on = nextDay(repeat, today, weekStart)
  if (!on) return 'Ends after this one'
  return `Next ${nextDayLabel(on, today)}${repeat.from === 'done' ? ' if done today' : ''}`
}

export interface RepeatFields {
  every: 'off' | TodoRepeat['every']; interval: number; showWeekdays: boolean
  from: TodoRepeat['from']; ends: 'never' | 'date'; until: LocalDate | ''
}
export function repeatFields(repeat: TodoRepeat | undefined): RepeatFields {
  if (!repeat) return { every: 'off', interval: 1, showWeekdays: false, from: 'schedule', ends: 'never', until: '' }
  return {
    every: repeat.every, interval: repeat.interval, showWeekdays: repeat.every === 'week' && repeat.from === 'schedule',
    from: repeat.from, ends: repeat.until ? 'date' : 'never', until: repeat.until ?? '',
  }
}

export type RepeatEdit =
  | { field: 'every'; value: RepeatFields['every'] } | { field: 'interval'; value: number } | { field: 'weekdays'; value: number[] }
  | { field: 'from'; value: TodoRepeat['from'] } | { field: 'ends'; value: 'never' | 'date' } | { field: 'until'; value: string }

const sameRule = (a: TodoRepeatRule, b: TodoRepeatRule) =>
  a.every === b.every && a.interval === b.interval && a.from === b.from && a.until === b.until
  && JSON.stringify(a.weekdays ?? null) === JSON.stringify(b.weekdays ?? null)
const dayOfWeek = (day: LocalDate) => new Date(`${day}T12:00:00Z`).getUTCDay()

/** The rule one edit sends: null turns the repeat off; undefined sends nothing (no change, or a value that can't be stored). */
export function ruleAfter(repeat: TodoRepeat | undefined, edit: RepeatEdit, today: LocalDate): TodoRepeatRule | null | undefined {
  if (!repeat) return edit.field === 'every' && edit.value !== 'off' ? { every: edit.value, interval: 1, from: 'schedule' } : undefined
  if (edit.field === 'every' && edit.value === 'off') return null
  const current: TodoRepeatRule = {
    every: repeat.every, interval: repeat.interval, from: repeat.from,
    ...(repeat.weekdays ? { weekdays: repeat.weekdays } : {}), ...(repeat.until ? { until: repeat.until } : {}),
  }
  let { every, interval, from, until } = current
  let weekdays = current.weekdays
  switch (edit.field) {
    case 'every': every = edit.value as TodoRepeat['every']; weekdays = undefined; break
    case 'interval':
      if (!Number.isInteger(edit.value) || edit.value < 1 || edit.value > 999) return undefined
      interval = edit.value; break
    case 'weekdays': {
      if (every !== 'week' || from !== 'schedule' || !edit.value.length) return undefined
      const days = [...new Set(edit.value)].sort((a, b) => a - b)
      weekdays = days.length === 1 && days[0] === dayOfWeek(repeat.slot) ? undefined : days
      break
    }
    case 'from': from = edit.value; if (from === 'done') weekdays = undefined; break
    case 'ends': until = edit.value === 'never' ? undefined : repeat.until ?? addDays(repeat.slot > today ? repeat.slot : today, 28); break
    case 'until':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(edit.value)) return undefined
      // A day before the later of its own day and today ends nothing that is left: as if unchanged.
      if (edit.value < (repeat.slot > today ? repeat.slot : today)) return undefined
      until = edit.value; break
  }
  const rule: TodoRepeatRule = { every, interval, from, ...(weekdays ? { weekdays } : {}), ...(until ? { until } : {}) }
  return sameRule(rule, current) ? undefined : rule
}

/** The live day page of a date, as `workspace.ts` reads it. */
const dayPageId = (ws: Workspace, date: LocalDate) => ws.pages.find(p => p.type === 'daily' && p.date === date && !p.trashedAt)?.id
const finishes = (to: unknown) => to === todoStatus.done || to === todoStatus.cancelled

/** Pages already there whose document a command rewrites because of a repeat: the next one's line made or taken back. */
export function repeatPages(ws: Workspace, action: Action): string[] {
  if (!ws.todoRepeats?.length) return []
  const out: string[] = []
  const add = (id: string | undefined) => { if (id && !out.includes(id)) out.push(id) }
  const finished = (taskId: string, today: LocalDate) => {
    const repeat = repeatsIn(ws).get(taskId)
    if (repeat) { const on = nextDay(repeat, today, ws.weekStart ?? 0); if (on) add(dayPageId(ws, on)) }
  }
  const reopened = (taskId: string) => {
    const task = ws.tasks.find(t => t.id === taskId)
    if (!task || task.status === 'open') return
    for (const r of ws.todoRepeats ?? []) if (r.previous?.taskId === taskId) for (const row of taskRows(ws, r.taskId)) add(row.page.id)
  }
  switch (action.type) {
    case 'task-status':
      if (finishes(action.status) && action.today) finished(action.taskId, action.today)
      else if (action.status === 'open') reopened(action.taskId)
      break
    case 'edit-todos':
      for (const item of action.items) if (item.changes.some(c => c.columnId === todoStatus.id)) { finished(item.taskId, action.today); reopened(item.taskId) }
      break
    case 'run-repeats':
      for (const due of dueTodoRepeats(ws, action.today)) add(dayPageId(ws, due.on))
      break
  }
  return out
}

/** Pages an Undo of that command must hold: the ones it was held for, and wherever a to-do it made has a line now. */
export function undoHoldPages(ws: Workspace, receipt: Pick<Receipt, 'nextTodos'>, held: readonly string[]): string[] {
  if (!receipt.nextTodos?.length) return [...held]
  const out = [...held]
  for (const made of receipt.nextTodos) for (const row of taskRows(ws, made.taskId)) if (!out.includes(row.page.id)) out.push(row.page.id)
  return out
}

/** The due repeats as one string, `id@day` sorted and joined by a space: the app asks the mend once for each. */
export function mendKey(due: readonly DueTodoRepeat[]): string {
  return due.map(d => `${d.repeat.id}@${d.on}`).sort().join(' ')
}
