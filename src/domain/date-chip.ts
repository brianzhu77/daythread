// B27 (docs/plan/b27-at-date-plan.md, revision 2): a `@date` chip in a line is an inline `dateMention` holding
// `{ eventId, date, time }`, the only thing stored. The events it makes are read from the documents, not kept in sync.
import type { LocalDate } from './types.ts'

export interface DateMention { eventId: string; date: LocalDate; time: string | null }

const isoDate = /^\d{4}-\d{2}-\d{2}$/, hhmm = /^([01]\d|2[0-3]):[0-5]\d$/
export function validDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !isoDate.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const at = new Date(Date.UTC(y, m - 1, d))
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d
}
export const validTime = (value: unknown): value is string => typeof value === 'string' && hhmm.test(value)

/** The chip in one inline item, or null: anything malformed (no id, an impossible date, a bad time) is not a chip. */
export function readMention(item: unknown): DateMention | null {
  if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'dateMention') return null
  const p = ((item as { props?: Record<string, unknown> }).props ?? {})
  const eventId = typeof p.eventId === 'string' ? p.eventId : ''
  if (!eventId || !validDate(p.date)) return null
  return { eventId, date: p.date, time: validTime(p.time) ? p.time : null }
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `15:00` → `3pm`, `09:30` → `9:30am`, `12:00` → `12pm`, `00:15` → `12:15am`. */
export function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`
}
/**
 * The chip as stored text (Lead 0a513a83, Jazz): `@Nov 20`, `@Nov 20 3pm`, and the year when it isn't the year of the
 * page holding the line (`@Jan 5, 2027`). A page with no date (a document) always gets the year. No weekday and no
 * "Today": plain text isn't redrawn the next day.
 */
export function mentionText(m: Pick<DateMention, 'date' | 'time'>, pageDate: LocalDate | null | undefined): string {
  const [y, mo, d] = m.date.split('-').map(Number) as [number, number, number]
  const year = pageDate && pageDate.slice(0, 4) === String(y) ? '' : `, ${y}`
  return `@${months[mo - 1]} ${d}${year}${m.time ? ` ${timeLabel(m.time)}` : ''}`
}

