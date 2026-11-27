// What the strip above a day's page says, as a pure function: never imports React or a .tsx file, so node --test and
// scripts/export-core-fixtures.ts reach it (the native app is held to the cases made from it).
import { flatNodes, pageNodes, rowTaskId } from '../domain/editor-document.ts'
import { plannedOn } from '../domain/workspace.ts'
import type { DayView, LocalDate, Workspace } from '../domain/types.ts'
import { taskDateTag } from './dates.ts'
import { eventsHeading, eventsLine } from './event-words.ts'

/** `tag` is `''` when there is none; `words` is the to-do's title as stored. */
export interface FactRow { taskId: string; words: string; tag: string; setAside: boolean }
export interface DayFacts {
  /** Today only. `headingId`: the page's top-level heading titled Events, or null. */
  events: { text: string; more: string | null; headingId: string | null } | null
  /** `view.attention` less every to-do with a row on the page; `tag` is `taskDateTag(t, today, date, plannedOn)`,
   *  and for a to-do set aside `Not today · <tag>`, or `Not today` when that tag is empty. */
  dueSoon: FactRow[]
  /** Today only, when one is set aside: `title` is `Not today · <N>`; each `tag` is
   *  `taskDateTag(t, today, today, plannedOn)`; `setAside` is true. */
  notToday: { title: string; rows: FactRow[] } | null
}

/** Computed facts above the page, never page text. Null when the day shows no strip: a later day without a page. */
export function dayFacts(view: DayView, workspace: Workspace, date: LocalDate, today: LocalDate): DayFacts | null {
  // A later day without a page shows what is planned there instead (DayScreen's FutureDayState).
  if (date > today && !view.page) return null
  const isToday = date === today
  const onPage = new Set(view.page ? flatNodes(pageNodes(view.page)).map(rowTaskId).filter(Boolean) : [])
  const line = isToday ? eventsLine(view.events) : null
  const headingId = view.page ? eventsHeading(pageNodes(view.page))?.id ?? null : null
  return {
    events: line && { ...line, headingId },
    dueSoon: view.attention.filter(t => !onPage.has(t.id)).map(t => {
      const tag = taskDateTag(t, today, date, plannedOn(workspace, t.id))
      return { taskId: t.id, words: t.title, tag: t.paused ? (tag ? `Not today · ${tag}` : 'Not today') : tag, setAside: t.paused }
    }),
    notToday: isToday && view.paused.length > 0
      ? { title: `Not today · ${view.paused.length}`, rows: view.paused.map(t => ({ taskId: t.id, words: t.title, tag: taskDateTag(t, today, today, plannedOn(workspace, t.id)), setAside: true })) }
      : null,
  }
}
