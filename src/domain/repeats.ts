// Repeating row templates (R4-6, automations design §6). Nothing wakes on its own: when he opens the app, each template's periods since it
// last ran are worked out here. A period's row has an id made from its template and date, so two tabs, a retry or a rollback can't make it twice.
import type { Database, Repeat } from './database.ts'
import { isDatabase, addDays, startOfWeek } from './database.ts'
import { rowTemplates } from './day-template.ts'
import type { Page, WeekStart, Workspace } from './types.ts'

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
/** The nth occurrence. A month keeps its day where it can: from the 31st, February's falls on its last. */
function occurrence(repeat: Repeat, n: number): string {
  const step = n * repeat.interval
  if (repeat.every === 'day') return addDays(repeat.start, step)
  if (repeat.every === 'week') return addDays(repeat.start, step * 7)
  const [y, m, d] = repeat.start.split('-').map(Number) as [number, number, number]
  const months = (y * 12 + m - 1) + (repeat.every === 'month' ? step : step * 12)
  const year = Math.floor(months / 12), month = months % 12
  const day = Math.min(d, daysIn(year, month))
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
const maxWalk = 40_000
/**
 * Every occurrence in order. Weekdays count by calendar week from the one holding the start, so "every 2 weeks on Tue and Thu" keeps a week's
 * Tue and Thu together, which is why the week's first day matters to it. Changing that later can't make a row twice: ids go by date.
 */
function* occurrences(repeat: Repeat, weekStart: WeekStart): Generator<string> {
  if (repeat.every !== 'week' || !repeat.weekdays?.length) {
    for (let n = 0; n < maxWalk; n++) yield occurrence(repeat, n)
    return
  }
  const first = startOfWeek(repeat.start, weekStart), offsets = repeat.weekdays.map(day => (day - weekStart + 7) % 7).sort((a, b) => a - b)
  for (let n = 0; n < maxWalk; n++) {
    for (const offset of offsets) {
      const date = addDays(first, n * repeat.interval * 7 + offset)
      if (date >= repeat.start) yield date
    }
  }
}
/** Every date due by now: after the last it made, and not from before it was set up. */
export function dueDates(repeat: Repeat, today: string, time: string, weekStart: WeekStart = 0): string[] {
  if (repeat.paused) return []
  const now = `${today}T${time}`, at = repeat.time ?? '00:00', out: string[] = []
  for (const date of occurrences(repeat, weekStart)) {
    const when = `${date}T${at}`
    if (when > now) break
    if ((!repeat.last || date > repeat.last) && (!repeat.notBefore || when >= repeat.notBefore)) out.push(date)
  }
  return out
}
/** The next date still to come, for the menu to say. Paused has none. */
export function nextDate(repeat: Repeat, today: string, time: string, weekStart: WeekStart = 0): string | null {
  if (repeat.paused) return null
  const now = `${today}T${time}`, at = repeat.time ?? '00:00'
  for (const date of occurrences(repeat, weekStart)) {
    const when = `${date}T${at}`
    if (when > now && (!repeat.last || date > repeat.last) && (!repeat.notBefore || when >= repeat.notBefore)) return date
  }
  return null
}
export interface DueRepeat { database: Page & { database: Database }; template: Page; dates: string[]; skipped: number }
/** What's due across the workspace: the latest only, unless the template makes every missed one. */
export function dueRepeats(ws: Workspace, today: string, time: string): DueRepeat[] {
  const out: DueRepeat[] = []
  for (const database of ws.pages) {
    if (!isDatabase(database) || database.trashedAt || !database.database.repeats) continue
    for (const template of rowTemplates(ws, database.id)) {
      const repeat = database.database.repeats[template.id]
      if (!repeat || template.trashedAt) continue
      const dates = dueDates(repeat, today, time, ws.weekStart ?? 0)
      if (!dates.length) continue
      out.push(repeat.everyMissed ? { database, template, dates, skipped: 0 } : { database, template, dates: dates.slice(-1), skipped: dates.length - 1 })
    }
  }
  return out
}
/** Stable for a template and a period: what keeps it to one row. */
export const repeatRowId = (templateId: string, date: string) => `${templateId.slice(0, 100)}.${date}`
/** With more than one weekday a week holds several rows, so it counts rows. */
export const periodWord = (repeat: Repeat, n: number) => `${n} earlier ${(repeat.weekdays?.length ?? 0) > 1 ? 'row' : repeat.every}${n === 1 ? '' : 's'}`
