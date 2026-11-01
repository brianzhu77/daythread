// What the database's cells show and what their editors read from typing (design §6.3). Pure, so the rules are tested
// without a browser; the editors in property-editors.tsx only call these.
import { limits, type DateValue, type NumberFormat, type Option, type StatusGroup } from '../domain/database.ts'
import type { LocalDate } from '../domain/types'
import { fromIso } from './dates.ts'

/** The width at which editors become popovers instead of sheets (§6.3.1); the editor's compact layout uses the same. */
export const popoverMinWidth = 900

// ---------- Number (§6.3.4) ----------

const currencySigns = /[$€£¥￥]/g
/**
 * What he typed in a Number editor: a number, null for an empty field, or 'invalid'. Spaces and grouping commas are
 * dropped, full-width digits read as digits, and a trailing % or a currency sign is allowed only in that format.
 */
export function readNumberInput(text: string, format: NumberFormat | undefined): number | null | 'invalid' {
  let s = text.normalize('NFKC').replace(/[\s,]/g, '').replace(/[−–]/g, '-')
  if (!s) return null
  if (format === 'percent' && s.endsWith('%')) s = s.slice(0, -1)
  if (format === 'currency') s = s.replace(currencySigns, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return 'invalid'
  const n = Number(s)
  return Number.isFinite(n) ? n : 'invalid'
}
/** The editor's text for a stored number: plain, never formatted, so editing doesn't fight the grouping. */
export const numberDraft = (value: number | null): string => (value === null ? '' : String(value))
/** The phone sheet's ± button: iOS's decimal keypad has no minus sign. */
export function flipSign(text: string): string {
  const t = text.trimStart()
  return t.startsWith('-') ? t.slice(1) : `-${t}`
}
/** The cell's text for a number in its format. */
export function numberLabel(value: number, format: NumberFormat | undefined): string {
  switch (format) {
    case 'comma': return value.toLocaleString('en-US', { maximumFractionDigits: 10 })
    case 'percent': return `${value.toLocaleString('en-US', { maximumFractionDigits: 10 })}%`
    case 'currency': return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    default: return String(value)
  }
}

// ---------- Text and URL (§6.3.3, §6.3.10) ----------

/** The model refuses longer values (`limits.text`); the editor keeps the field open instead of dropping his text. */
export const tooLong = (text: string): boolean => text.length > limits.text
export const tooLongMessage = `Too long · ${limits.text.toLocaleString('en-US')} characters max`
/**
 * On the phone, any Text or URL commit that changes the value gets the Undo notice (Lead f1e56ab4): there's no ⌘Z
 * there, and a long value can't be picked again the way an option can.
 */
export const changedNotice = (propertyName: string): string => `${propertyName || 'Text'} changed · Undo`

// ---------- Select, Multi-select, Status (§6.3.5–7) ----------

export const nameKey = (name: string) => name.trim().toLocaleLowerCase()
/**
 * The pick list for a query: options containing it (case-insensitive), in their set order, and the name Create would
 * use, which is null when the query is empty or names an existing option.
 */
export function matchOptions(options: readonly Option[], query: string): { matches: Option[]; create: string | null } {
  const q = nameKey(query)
  if (!q) return { matches: [...options], create: null }
  const matches = options.filter(o => nameKey(o.name).includes(q))
  return { matches, create: options.some(o => nameKey(o.name) === q) ? null : query.trim() }
}
/** What Enter picks: an exact name first, then the first match, then Create. */
export function enterChoice(options: readonly Option[], query: string): { option: Option } | { create: string } | null {
  const q = nameKey(query)
  const exact = q ? options.find(o => nameKey(o.name) === q) : undefined
  if (exact) return { option: exact }
  const { matches, create } = matchOptions(options, query)
  if (matches[0]) return { option: matches[0] }
  return create ? { create } : null
}
export const statusGroups: { group: StatusGroup; title: string; dot: string }[] = [
  { group: 'todo', title: 'To do', dot: '○' },
  { group: 'active', title: 'In progress', dot: '◐' },
  { group: 'done', title: 'Done', dot: '●' },
]
export const statusDot = (option: Option | undefined): string =>
  statusGroups.find(g => g.group === (option?.group ?? 'todo'))!.dot

// ---------- Date (§6.3.9) ----------

/** A stored date's day and time parts; time is null for a whole day. */
export function splitDate(text: string): { day: LocalDate; time: string | null } {
  return { day: text.slice(0, 10), time: text.length > 10 ? text.slice(11, 16) : null }
}
export const joinDate = (day: LocalDate, time: string | null): string => (time ? `${day}T${time}` : day)
/** The value to store: an end before the start is swapped quietly, and an end equal to the start is dropped. */
export function orderedDate(start: string, end: string | undefined): DateValue {
  if (!end || end === start) return { start }
  return end < start ? { start: end, end: start } : { start, end }
}
/** Without the time, when Include time is off. */
export function withoutTime(value: DateValue): DateValue {
  return orderedDate(value.start.slice(0, 10), value.end?.slice(0, 10))
}
export const hasTime = (value: DateValue | null): boolean =>
  Boolean(value && (value.start.length > 10 || (value.end?.length ?? 0) > 10))

/** "3 PM", "3:30 PM": the same time style as `@` date chips. */
export function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}
function oneDate(text: string, today: LocalDate): string {
  const { day, time } = splitDate(text)
  const label = fromIso(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) })
  return time ? `${label}, ${timeLabel(time)}` : label
}
/** The cell's text (§6.3.9): "Oct 12", "Oct 12, 2025", "Oct 12 → Oct 20", "Oct 12, 3 PM". No relative words. */
export function dateLabel(value: DateValue, today: LocalDate): string {
  return value.end ? `${oneDate(value.start, today)} → ${oneDate(value.end, today)}` : oneDate(value.start, today)
}
/** The line under the Date field: "Fri, Nov 20" or "Fri, Nov 20, 3 PM", with the year when it isn't this year. */
export function readingLabel(day: LocalDate, time: string | null, today: LocalDate): string {
  const label = fromIso(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) })
  return time ? `${label}, ${timeLabel(time)}` : label
}

// ---------- URL (§6.3.10) ----------

const scheme = /^[a-z][a-z\d+.-]*:/i
/** Where a URL value opens, or null when it isn't a link (no dot, or spaces). The value itself is never rewritten. */
export function urlHref(text: string): string | null {
  const t = text.trim()
  if (!t || /\s/.test(t)) return null
  if (scheme.test(t)) return /^(https?|mailto|tel):/i.test(t) ? t : null
  return /^[^./]+\.[^.]/.test(t) ? `https://${t}` : null
}
/** The cell's text for a link: without `https://` or `www.`, and without a lone trailing slash. */
export function urlLabel(text: string): string {
  const t = text.trim()
  if (!urlHref(t)) return t
  return t.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/^([^/]+)\/$/, '$1')
}
