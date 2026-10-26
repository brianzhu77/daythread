// Reminders for `@date` chips (docs/design/reminders.md): read from the documents like the events themselves, nothing
// stored. A chip with a time fires at that time; a chip with only a date fires at `dateOnlyTime` that morning, both
// in the workspace's time zone. The server's tick asks for what fell due in a window and sends each one once.
import { chipEvents } from './chip-events.ts'
import { timeLabel } from './date-chip.ts'
import type { LocalDate, Workspace } from './types.ts'

/** When a chip with no time reminds: the start of the working morning. */
export const dateOnlyTime = '09:00'

export interface Reminder {
  /** One per event and firing time, so a tick that runs twice sends once; a chip moved to another time fires again. */
  key: string
  eventId: string
  title: string
  body: string
  /** The page holding the line, to open from the notification. */
  url: string
  fireAt: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) formatters.set(timeZone, f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }))
  return f
}
/** The instant of a wall-clock date and time in a zone (an unknown zone counts as UTC; a DST gap takes the later side). */
export function zonedEpoch(date: LocalDate, time: string, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  let f: Intl.DateTimeFormat
  try { f = formatter(timeZone) } catch { return wall }
  const offset = (at: number) => {
    const parts = f.formatToParts(new Date(at))
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute')) - at
  }
  const first = wall - offset(wall)
  return wall - offset(first)
}

const dayLabel = (date: LocalDate) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The reminders due after `from` and up to `to` (epoch ms), oldest first. */
export function dueReminders(ws: Workspace, from: number, to: number): Reminder[] {
  const out: Reminder[] = []
  for (const event of chipEvents(ws).values()) {
    const fireAt = zonedEpoch(event.date, event.time ?? dateOnlyTime, ws.timezone)
    if (fireAt <= from || fireAt > to) continue
    const page = event.line ? ws.pages.find(p => p.id === event.line!.pageId) : undefined
    const url = page ? (page.type === 'daily' && page.date ? `/day/${page.date}` : `/pages?page=${encodeURIComponent(page.id)}`) : '/'
    out.push({
      key: `${event.id}@${fireAt}`,
      eventId: event.id,
      title: event.title || 'Reminder',
      body: `${dayLabel(event.date)}${event.time ? ` · ${timeLabel(event.time)}` : ''}`,
      url,
      fireAt,
    })
  }
  return out.sort((a, b) => a.fireAt - b.fireAt)
}
