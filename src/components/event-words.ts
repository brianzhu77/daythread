// How a day's events are worded, as pure functions: never imports React or a .tsx file, so node --test and
// scripts/export-core-fixtures.ts reach it (the native app is held to the cases made from it).
import { inlineText, type EditorNode } from '../domain/editor-document.ts'
import type { DayEvent } from '../domain/types.ts'

/** "3 PM", "3:30 PM": the chip's and the strip's time. */
export const shortTime = (time: string) => {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

/** The heading titled "Events" on a page, by its text: a display anchor, never a stored role. */
export function eventsHeading(doc: readonly EditorNode[]): EditorNode | undefined {
  return doc.find(n => n.type === 'heading' && inlineText(n.content).trim().toLowerCase() === 'events')
}

/**
 * Today's events as the strip's one line: the first two, and `All day` after a lone one with no time; `more` counts
 * the rest. Null when the day has none.
 */
export function eventsLine(events: DayEvent[]): { text: string; more: string | null } | null {
  if (!events.length) return null
  const named = events.slice(0, 2).map(e => `${e.time ? `${shortTime(e.time)} ` : ''}${e.title || 'Untitled event'}`)
  const parts = [...named, ...(events.length === 1 && !events[0]!.time ? ['All day'] : [])]
  return { text: parts.join(' · '), more: events.length > 2 ? `+${events.length - 2} more` : null }
}
