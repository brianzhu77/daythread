// B27 (plan §3): what a `@` query reads as, anchored on the page's date (today on a document page). Pure and small on
// purpose: the picker shows the reading before anything is made, so a narrow grammar he can see beats a clever one.
// First cut (Lead 74dbbfdd): today/tomorrow, weekdays, month-day, M/D, ISO; 今天, 明天, 周X, 11月20日; times as 3pm,
// 3:30pm, 15:00. A time alone means the page's own day.
import type { LocalDate } from './types.ts'

export interface Reading {
  date: LocalDate
  time: string | null
  /** How many characters of the query the reading used; the rest stays text after the chip. */
  used: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
function real(y: number, m: number, d: number): boolean {
  const at = new Date(Date.UTC(y, m - 1, d))
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d
}
function shift(day: LocalDate, days: number): LocalDate {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const at = new Date(Date.UTC(y, m - 1, d + days))
  return iso(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
}
const weekdayOf = (day: LocalDate) => { const [y, m, d] = day.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
/** The next month-day on or after the anchor: `Jan 5` written in October is next January (Bumblebee). */
function nextMonthDay(anchor: LocalDate, m: number, d: number): LocalDate | null {
  const y = Number(anchor.slice(0, 4))
  for (const year of [y, y + 1, y + 2, y + 3, y + 4]) if (real(year, m, d) && iso(year, m, d) >= anchor) return iso(year, m, d)
  return null
}
/** The coming weekday; on that weekday itself, the anchor. */
const comingWeekday = (anchor: LocalDate, wd: number) => shift(anchor, (wd - weekdayOf(anchor) + 7) % 7)

const weekdays: [RegExp, number][] = [
  [/^sun(?:day)?/i, 0], [/^mon(?:day)?/i, 1], [/^tue(?:s(?:day)?)?/i, 2], [/^wed(?:s|nesday)?/i, 3],
  [/^thu(?:r(?:s(?:day)?)?)?/i, 4], [/^fri(?:day)?/i, 5], [/^sat(?:urday)?/i, 6],
]
const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const monthWord = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
const monthOf = (word: string) => monthNames.indexOf(word.slice(0, 3).toLowerCase()) + 1
const zhWeekday: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
/** Word boundary after an English form: the end, a space, or punctuation; never more letters ("mayor", "sunny"). */
const ends = (rest: string) => !/^[a-z0-9]/i.test(rest)

/** The date at the start of `q`, and how much of it it used. */
function readDay(q: string, anchor: LocalDate): { date: LocalDate; used: number } | null {
  let m: RegExpExecArray | null
  if ((m = /^(today|tod)/i.exec(q)) && ends(q.slice(m[0].length))) return { date: anchor, used: m[0].length }
  if ((m = /^(tomorrow|tmrw|tmr)/i.exec(q)) && ends(q.slice(m[0].length))) return { date: shift(anchor, 1), used: m[0].length }
  if ((m = /^今天/.exec(q))) return { date: anchor, used: m[0].length }
  if ((m = /^明天/.exec(q))) return { date: shift(anchor, 1), used: m[0].length }
  if ((m = /^周([一二三四五六日天])/.exec(q))) return { date: comingWeekday(anchor, zhWeekday[m[1]!]!), used: m[0].length }
  for (const [re, wd] of weekdays) if ((m = re.exec(q)) && ends(q.slice(m[0].length))) return { date: comingWeekday(anchor, wd), used: m[0].length }
  // 2026-11-20
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(q))) return real(+m[1]!, +m[2]!, +m[3]!) ? { date: iso(+m[1]!, +m[2]!, +m[3]!), used: m[0].length } : null
  // 11月20日 / 11月20号
  if ((m = /^(\d{1,2})月(\d{1,2})[日号]?/.exec(q))) { const date = nextMonthDay(anchor, +m[1]!, +m[2]!); return date ? { date, used: m[0].length } : null }
  // 11/20, 11/20/2027 (month first, as in his examples)
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?![\d/])/.exec(q))) {
    const [mo, d] = [+m[1]!, +m[2]!]
    if (m[3]) return real(+m[3], mo, d) ? { date: iso(+m[3], mo, d), used: m[0].length } : null
    const date = nextMonthDay(anchor, mo, d); return date ? { date, used: m[0].length } : null
  }
  // Nov 20, November 20, Nov 20, 2027
  if ((m = monthWord.exec(q))) {
    const day = /^\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?(?!\d)/.exec(q.slice(m[0].length))
    if (!day) return null
    const mo = monthOf(m[1]!), d = +day[1]!, used = m[0].length + day[0].length
    if (day[2]) return real(+day[2], mo, d) ? { date: iso(+day[2], mo, d), used } : null
    const date = nextMonthDay(anchor, mo, d); return date ? { date, used } : null
  }
  // 20 Nov
  if ((m = /^(\d{1,2})\s+([a-z]+)/i.exec(q)) && monthWord.test(m[2]!) && ends(q.slice(m[0].length))) {
    const date = nextMonthDay(anchor, monthOf(m[2]!), +m[1]!); return date ? { date, used: m[0].length } : null
  }
  return null
}

/** A time at the start of `q`: 3pm, 3:30pm, 3 pm, 15:00. */
function readTime(q: string): { time: string; used: number } | null {
  let m: RegExpExecArray | null
  if ((m = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)/i.exec(q)) && ends(q.slice(m[0].length))) {
    const h = +m[1]!, min = m[2] ? +m[2] : 0
    if (h < 1 || h > 12) return null
    const pm = m[3]!.toLowerCase().startsWith('p')
    return { time: `${pad((h % 12) + (pm ? 12 : 0))}:${pad(min)}`, used: m[0].length }
  }
  if ((m = /^([01]?\d|2[0-3]):([0-5]\d)(?!\d)/.exec(q))) return { time: `${pad(+m[1]!)}:${m[2]}`, used: m[0].length }
  return null
}

/**
 * What the start of a `@` query reads as, or null. `anchor` is the page's date (today on a document page). A date may
 * be followed by a time; a time alone is the anchor's day.
 */
export function readDate(query: string, anchor: LocalDate): Reading | null {
  const lead = query.length - query.trimStart().length
  if (lead) return null // `@ ` is a word, not a date
  const day = readDay(query, anchor)
  if (day) {
    const gap = /^,?\s+/.exec(query.slice(day.used))?.[0] ?? ''
    const time = gap ? readTime(query.slice(day.used + gap.length)) : null
    return time ? { date: day.date, time: time.time, used: day.used + gap.length + time.used } : { date: day.date, time: null, used: day.used }
  }
  const time = readTime(query)
  return time ? { date: anchor, time: time.time, used: time.used } : null
}

/** Words a query may still be on its way to (so the picker stays open while he types `No…`). */
const words = ['today', 'tomorrow', 'tmr', 'tmrw', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', '今天', '明天', '周']
/**
 * True while `query` could still become a reading by typing more: a prefix of a date word, a month name waiting for
 * its day, digits on their way to a date or a time, or a reading followed by the start of a time.
 */
export function mayRead(query: string, anchor: LocalDate): boolean {
  if (!query) return true
  if (/\s$/.test(query) && !readDate(query.trimEnd(), anchor)) return /^[a-z]+\s+\d{0,2}\s*$/i.test(query) && monthWord.test(query)
  const reading = readDate(query, anchor)
  if (reading) {
    const rest = query.slice(reading.used)
    return !rest || /^,?\s*(\d{1,2}(:\d{0,2})?\s*(a|p|am|pm|a\.|p\.|a\.m|p\.m)?)?$/i.test(rest)
  }
  const q = query.toLowerCase()
  if (words.some(w => w.startsWith(q))) return true
  if (monthWord.test(q)) return /^[a-z]+\s*\d{0,2}$/i.test(q)
  return /^\d{1,4}([/\-月]\d{0,2}([/\-]\d{0,4})?)?$/.test(q) || /^\d{1,2}(:\d{0,2})?\s*(a|p)?$/i.test(q)
}
