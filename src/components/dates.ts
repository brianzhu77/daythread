// Local calendar dates are plain 'YYYY-MM-DD' strings so they never shift with time zones.
import type { LocalDate, Task } from '../domain/types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toIso(d: Date): LocalDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromIso(iso: LocalDate): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayIso(): LocalDate {
  return toIso(new Date())
}

export function addDays(iso: LocalDate, days: number): LocalDate {
  const d = fromIso(iso)
  d.setDate(d.getDate() + days)
  return toIso(d)
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((fromIso(to).getTime() - fromIso(from).getTime()) / 86_400_000)
}

export function weekday(iso: LocalDate): string {
  return fromIso(iso).toLocaleDateString('en-US', { weekday: 'short' })
}

/** "Fri Oct 16" */
export function longLabel(iso: LocalDate): string {
  return fromIso(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "Fri 10/16" */
export function shortLabel(iso: LocalDate): string {
  const d = fromIso(iso)
  return `${weekday(iso)} ${d.getMonth() + 1}/${d.getDate()}`
}

/** Weekday name inside the coming week, otherwise "Fri 10/23". */
function near(iso: LocalDate, today: LocalDate): string {
  const diff = daysBetween(today, iso)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff > 1 && diff < 7) return weekday(iso)
  return shortLabel(iso)
}

/**
 * Plain-phrase tag with only the fields that are set (01 §2 "Date labels").
 * `pageDate` decides wording on other days' pages: never "Overdue" on a future page.
 */
export function taskDateTag(task: Task, today: LocalDate, pageDate: LocalDate = today): string {
  const parts: string[] = []
  const due = task.deadlineOn
  const start = task.attentionOn
  if (due && daysBetween(today, due) < 0 && daysBetween(pageDate, due) < 0) return `Was due ${weekday(due)}`
  if (due && due === pageDate && pageDate !== today) parts.push('Due that day')
  else if (due) parts.push(`Due ${near(due, today)}`)
  if (start && daysBetween(today, start) >= 0) {
    const startTag = `Start ${near(start, today)}`
    const dueFirst = due !== null && daysBetween(today, due) <= 2
    if (dueFirst) parts.push(startTag)
    else parts.unshift(startTag)
  }
  if (!parts.length && !task.plannedOn) return 'Unscheduled'
  return parts.join(' · ')
}

export const anotherDayOptions = (today: LocalDate) => {
  const d = fromIso(today).getDay()
  const toSat = (6 - d + 7) % 7 || 7
  const toMon = (1 - d + 7) % 7 || 7
  return [
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'This weekend', date: addDays(today, toSat) },
    { label: 'Next week', date: addDays(today, toMon) },
  ]
}
