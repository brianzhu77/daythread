// Timeline (docs/design/timeline.md): what a view's rows draw as on a scale, and what a move or an edge drag writes. Nothing here
// tidies a date: a row whose end is before its start draws one day and stays as it is until that bar is moved (§3).
import { isReadOnly, isTimeType, readValue, rowTime, rawOf, viewDateBy, type Database, type DateValue, type Json, type Property, type View } from './database.ts'
import { addDays, startOfWeek } from './database.ts'
import type { LocalDate, Page, WeekStart } from './types.ts'

export const timelineUnits = ['hours', 'day', 'week', 'month', 'quarter', 'year'] as const
export type TimelineUnit = (typeof timelineUnits)[number]
/** The width of a day at each unit. */
export const dayWidth: Record<TimelineUnit, number> = { hours: 24 * 48, day: 48, week: 24, month: 12, quarter: 4, year: 1.5 }
/** A move snaps to the unit he can see: an hour at Hours, a day otherwise, which never rounds a date he didn't mean to change. */
export const snapMinutes = (unit: TimelineUnit): number => (unit === 'hours' ? 60 : 1440)

/** How a row's dates read: `open-end` and `open-start` have only one of a pair; `inverted`'s end is before its start. */
export type BarShape = 'range' | 'day' | 'open-end' | 'open-start' | 'inverted'
export interface TimelineBar {
  row: Page
  /** What it draws from and to. A date alone, or with a time. */
  start: string
  end: string
  shape: BarShape
  readOnly: boolean
  startProperty: Property
  /** Only with a pair of properties. */
  endProperty: Property | null
}

export function viewDateEnd(db: Database, view: View): Property | null {
  const property = view.timelineEnd && view.timelineEnd !== view.dateBy ? db.properties.find(p => p.id === view.timelineEnd) : undefined
  return property?.type === 'date' ? property : null
}
const valueOf = (property: Property, row: Page, rawFor: (row: Page, columnId: string) => unknown): DateValue | null =>
  isTimeType(property.type) ? rowTime(property, row) : (readValue(property, rawFor(row, property.id)) as DateValue | null)
const dayOf = (text: string): LocalDate => text.slice(0, 10)

/** Every row, on a bar or in `undated`: a row is never silently missing (§8). */
export function timelineBars(db: Database, view: View, rows: readonly Page[], rawFor: (row: Page, columnId: string) => unknown = rawOf): { bars: TimelineBar[]; undated: Page[] } {
  const startProperty = viewDateBy(db, view), endProperty = viewDateEnd(db, view)
  const bars: TimelineBar[] = [], undated: Page[] = []
  if (!startProperty) return { bars, undated: [...rows] }
  const readOnly = isReadOnly(startProperty) || Boolean(endProperty && isReadOnly(endProperty))
  for (const row of rows) {
    const from = valueOf(startProperty, row, rawFor), to = endProperty ? valueOf(endProperty, row, rawFor) : null
    const base = { row, readOnly, startProperty, endProperty }
    if (!endProperty) {
      if (!from) { undated.push(row); continue }
      // A range that's backwards in one value can't be typed, but a hand edit can: it's a day, untouched, as with a pair.
      if (from.end && dayOf(from.end) < dayOf(from.start)) bars.push({ ...base, start: from.start, end: from.start, shape: 'inverted' })
      else bars.push({ ...base, start: from.start, end: from.end ?? from.start, shape: from.end ? 'range' : 'day' })
      continue
    }
    if (!from && !to) { undated.push(row); continue }
    if (from && !to) { bars.push({ ...base, start: from.start, end: from.start, shape: 'open-end' }); continue }
    if (!from && to) { bars.push({ ...base, start: to.start, end: to.start, shape: 'open-start' }); continue }
    if (dayOf(to!.start) < dayOf(from!.start)) bars.push({ ...base, start: from!.start, end: from!.start, shape: 'inverted' })
    else bars.push({ ...base, start: from!.start, end: to!.start, shape: 'range' })
  }
  return { bars, undated }
}

const dayNumber = (day: LocalDate): number => Date.parse(`${day}T00:00:00Z`) / 86_400_000
const hasTime = (text: string): boolean => text.length > 10
const minutesOf = (text: string): number => (hasTime(text) ? Number(text.slice(11, 13)) * 60 + Number(text.slice(14, 16)) : 0)
/** Where a date starts, in days from `origin`. A date with a time sits at its time only at Hours: elsewhere a day is a day. */
export const startAt = (text: string, origin: LocalDate, unit: TimelineUnit): number => dayNumber(dayOf(text)) - dayNumber(origin) + (unit === 'hours' ? minutesOf(text) / 1440 : 0)
/** Where a date ends. A whole day, unless it has a time at Hours, where a time alone draws an hour. */
export const endAt = (text: string, origin: LocalDate, unit: TimelineUnit, start: string): number => {
  if (unit === 'hours' && hasTime(text)) { const at = startAt(text, origin, unit); return text === start ? at + 1 / 24 : at }
  return dayNumber(dayOf(text)) - dayNumber(origin) + 1
}
export const daysBetween = (from: LocalDate, to: LocalDate): number => dayNumber(to) - dayNumber(from)

/** A date moved by whole minutes. One with no time moves in days, and only as far as whole days go. */
export function shifted(text: string, minutes: number): string {
  if (!hasTime(text) || minutes % 1440 === 0) return `${addDays(dayOf(text), Math.round(minutes / 1440))}${text.slice(10)}`
  const at = new Date(Date.parse(`${dayOf(text)}T${text.slice(11, 16)}:00Z`) + minutes * 60_000).toISOString()
  return `${at.slice(0, 10)}T${at.slice(11, 16)}${text.slice(16)}`
}
const later = (a: string, b: string) => (a > b ? a : b), earlier = (a: string, b: string) => (a < b ? a : b)

export type BarPart = 'move' | 'start' | 'end'
export interface BarWrite { id: string; value: Json | undefined }
/** What dragging part of a bar by `minutes` draws and writes. Only what this bar's drag asks for changes (§3). */
export function draggedBar(bar: TimelineBar, part: BarPart, minutes: number, raw: (property: Property) => DateValue | null): { start: string; end: string; shape: BarShape; writes: BarWrite[] } {
  const { start, end, shape, startProperty, endProperty } = bar
  const one = (text: string, property: Property): BarWrite => { const had = raw(property); return { id: property.id, value: { ...(had?.end && property !== startProperty ? { end: had.end } : {}), start: text } as unknown as Json } }
  if (!endProperty) {
    let from = start, to = end
    if (part === 'move') { from = shifted(start, minutes); to = shifted(end, minutes) }
    if (part === 'start') from = earlier(shifted(start, minutes), end)
    if (part === 'end') to = later(shifted(end, minutes), start)
    const isDay = dayOf(from) === dayOf(to) && from === to
    return { start: from, end: to, shape: isDay ? 'day' : 'range', writes: [{ id: startProperty.id, value: (isDay ? { start: from } : { start: from, end: to }) as unknown as Json }] }
  }
  if (shape === 'open-end') {
    if (part === 'end') { const to = later(shifted(start, minutes), start); return { start, end: to, shape: to === start ? 'open-end' : 'range', writes: to === start ? [] : [one(to, endProperty)] } }
    const from = shifted(start, minutes)
    return { start: from, end: from, shape, writes: [one(from, startProperty)] }
  }
  if (shape === 'open-start') {
    if (part === 'start') { const from = earlier(shifted(start, minutes), start); return { start: from, end: start, shape: from === start ? 'open-start' : 'range', writes: from === start ? [] : [one(from, startProperty)] } }
    const to = shifted(start, minutes)
    return { start: to, end: to, shape, writes: [one(to, endProperty)] }
  }
  if (shape === 'inverted') {
    // Moving sets both, which clears it. So does giving it an end.
    if (part === 'start') { const from = shifted(start, minutes); return { start: from, end: from, shape, writes: [one(from, startProperty)] } }
    const from = part === 'move' ? shifted(start, minutes) : start, to = part === 'move' ? from : later(shifted(start, minutes), start)
    return { start: from, end: to, shape: dayOf(from) === dayOf(to) ? 'day' : 'range', writes: part === 'move' ? [one(from, startProperty), one(to, endProperty)] : [one(to, endProperty)] }
  }
  if (part === 'move') { const from = shifted(start, minutes), to = shifted(end, minutes); return { start: from, end: to, shape, writes: [one(from, startProperty), one(to, endProperty)] } }
  if (part === 'start') { const from = earlier(shifted(start, minutes), end); return { start: from, end, shape, writes: [one(from, startProperty)] } }
  const to = later(shifted(end, minutes), start)
  return { start, end: to, shape, writes: [one(to, endProperty)] }
}

export interface WeekRows { week: LocalDate; bars: TimelineBar[] }
/**
 * At 390, a list by week (§4): from this week down, each row under its start's week, or under this week while it's still running,
 * so a row in progress never folds away. What's over is `earlier`. `from`: the week it opens on, this week unless the view's on a day.
 */
export function timelineWeeks(bars: readonly TimelineBar[], from: LocalDate, weekStart: WeekStart = 0): { weeks: WeekRows[]; earlier: WeekRows[] } {
  const here = startOfWeek(from, weekStart), weeks = new Map<LocalDate, TimelineBar[]>(), earlier = new Map<LocalDate, TimelineBar[]>()
  const sorted = [...bars].sort((a, b) => (dayOf(a.start) < dayOf(b.start) ? -1 : dayOf(a.start) > dayOf(b.start) ? 1 : 0))
  for (const bar of sorted) {
    const week = startOfWeek(dayOf(bar.start), weekStart)
    const running = week < here && dayOf(bar.end) >= here
    const place = week >= here || running ? weeks : earlier, key = running ? here : week
    const list = place.get(key)
    if (list) list.push(bar); else place.set(key, [bar])
  }
  const inOrder = (map: Map<LocalDate, TimelineBar[]>) => [...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, bars]) => ({ week, bars }))
  return { weeks: inOrder(weeks), earlier: inOrder(earlier) }
}
