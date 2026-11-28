// The day draft's words, as pure functions: never imports React or a .tsx file, so node --test and
// scripts/export-core-fixtures.ts reach it (the native app is held to the cases made from it).
import type { DraftView } from '../domain/day-draft.ts'
import type { LocalDate } from '../domain/types.ts'
import { daysBetween, fromIso, shortLabel, weekday } from './dates.ts'

export type DayDraftState = 'none' | 'preparing' | 'ready' | 'failed' | 'offline'

/**
 * This tab's ask for the page's draft, as the line reads it: `in-flight` (asking, within LOST_MS), `lost` (asking, past
 * LOST_MS: the reply is taken as never coming), `failed`, `done`, or null when it was never asked for here.
 */
export type DraftAskSummary = 'in-flight' | 'lost' | 'failed' | 'done' | null

/** The fixed words of the draft's line and its notices. */
export const draftWords = {
  preparing: 'Preparing…',
  ready: 'Suggestions ready',
  show: 'Show',
  applyAll: 'Apply all',
  dismiss: 'Dismiss',
  failed: 'Couldn’t draft',
  retry: 'Retry',
  offline: 'Offline',
  notApplied: 'Not applied · changed elsewhere',
  notSkipped: 'Not skipped · changed elsewhere',
  cantUndo: "Can't undo · edited since",
} as const

/** The notice once an apply is stored: `Applied`, `Applied 2`. */
export const appliedNotice = (n: number): string => (n === 1 ? 'Applied' : `Applied ${n}`)
/** The notice once a skip is stored: `Skipped`, `Skipped 3`. */
export const skippedNotice = (n: number): string => (n === 1 ? 'Skipped' : `Skipped ${n}`)

/**
 * "skipped Sat, Sun" (Jazz sketch §1): up to three days by weekday name, one more than six days before the draft's day
 * as its date ("11/14"); from four on, "skipped 5 times". `full` names every day, for the accessible name and hover.
 */
export function skippedLabel(days: readonly LocalDate[], on: LocalDate): { text: string; full: string } {
  const name = (d: LocalDate) => (daysBetween(d, on) > 6 ? `${fromIso(d).getMonth() + 1}/${fromIso(d).getDate()}` : weekday(d))
  const full = `skipped ${days.map(d => shortLabel(d)).join(', ')}`
  return { text: days.length > 3 ? `skipped ${days.length} times` : `skipped ${days.map(name).join(', ')}`, full }
}

/** The line's state from the stored draft's view, this tab's ask and whether it is offline. */
export function draftLineState(view: Pick<DraftView, 'status' | 'items'> | null, ask: DraftAskSummary, offline: boolean): DayDraftState {
  return offline && !view ? 'offline' : ask === 'in-flight' && !view?.items.length ? 'preparing'
    // A failed or lost ask here shows Retry at once (he may be looking at the page); a tab coming back asks again first.
    : !view ? (ask !== null && ask !== 'done' ? 'failed' : 'none') : view.status === 'failed' ? 'failed' : 'ready'
}

/** What the line says: `count` is `1 suggestion` / `N suggestions` (null for none), then `Couldn’t draft` or `Offline`. */
export type DraftLineWords = { kind: 'preparing' } | { kind: 'held' } | { kind: 'segments'; count: string | null; failed: boolean; offline: boolean }

/**
 * The line's words for `state`, with `shown` suggestions still his to decide and `held` when they arrived while he was
 * typing and wait for Show. Null when the line says nothing.
 */
export function draftLineWords(state: DayDraftState, shown: number, held: boolean): DraftLineWords | null {
  if (state === 'none') return null
  if (state === 'preparing') return { kind: 'preparing' }
  if (held) return { kind: 'held' }
  const count = shown > 0 ? `${shown} suggestion${shown === 1 ? '' : 's'}` : null
  const failed = state === 'failed', offline = state === 'offline'
  return count || failed || offline ? { kind: 'segments', count, failed, offline } : null
}
