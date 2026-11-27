// What a to-do's row on a day page can do, as pure functions: never imports React or a .tsx file, so node --test and
// scripts/export-core-fixtures.ts reach it (the native app is held to the cases made from it).
import type { Action, LocalDate, Task } from '../domain/types.ts'
import { addDays, anotherDayOptions, fromIso, shortLabel, weekday } from './dates.ts'

/**
 * A12 (docs/plan/a12-row-actions.md, Jazz day-row-actions-states.md): what a task row on a day page can do. Every
 * intent ends in an existing task command, sent by the page editor (flush → hold → command → apply), except the
 * section move, which is a local edit like dragging the row.
 */
export type RowIntent =
  | { kind: 'move'; date: LocalDate }
  | { kind: 'not-today' }
  | { kind: 'cancel' }
  | { kind: 'restore' }
  | { kind: 'bring-today' }

/** "Wed, Oct 21": the notice's date, as in Jazz §3. */
export const noticeDate = (iso: LocalDate) => fromIso(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export interface RowMenuModel {
  /** The phone bar's three buttons, when the row has them (Jazz §2). */
  primary: { label: string; intent: RowIntent }[]
  /** Another day ▸ choices, ending in Pick date… (handled by the caller). */
  anotherDay: { label: string; date: LocalDate }[] | null
  groups: { title?: string; items: { label: string; intent: RowIntent | 'pick-date'; danger?: boolean }[] }[]
}

/**
 * A plan row is stale when its task is now planned for another day (`planned`): it offers "Remove from {day}"
 * instead of Not on, and never Tomorrow relative to a day that isn't today.
 */
export function rowMenu(task: Task, role: string, planned: LocalDate | null, pageDate: LocalDate | null, today: LocalDate): RowMenuModel | null {
  if (!pageDate) return null
  if (task.status === 'done') return null
  if (task.status === 'cancelled') return { primary: [], anotherDay: null, groups: [{ items: [{ label: 'Restore', intent: { kind: 'restore' } }] }] }
  if (pageDate < today) return { primary: [], anotherDay: null, groups: [{ items: [{ label: 'Bring to today', intent: { kind: 'bring-today' } }] }] }
  // Never the page's own day: moving a row to the day it's on does nothing.
  const anotherDay = anotherDayOptions(today).filter(o => o.date !== pageDate).map(o => ({ label: `${o.label} · ${shortLabel(o.date)}`, date: o.date }))
  const anotherDayGroup = { title: 'Another day', items: [...anotherDay.map(o => ({ label: o.label, intent: { kind: 'move', date: o.date } as RowIntent })), { label: 'Pick date…', intent: 'pick-date' as const }] }
  const cancel = { items: [{ label: 'Cancel task', intent: { kind: 'cancel' } as RowIntent, danger: true }] }
  if (role !== 'plan') {
    // Plan for today is already a button on the row; the phone bar repeats it.
    const plan = planned === today ? [] : [{ label: 'Plan for today', intent: { kind: 'bring-today' } as RowIntent }]
    return { primary: plan, anotherDay, groups: [anotherDayGroup, cancel] }
  }
  const tomorrow = addDays(today, 1)
  const stale = Boolean(planned && planned !== pageDate)
  const off: { label: string; intent: RowIntent } = stale
    ? { label: `Remove from ${weekday(pageDate)}`, intent: { kind: 'not-today' } }
    : { label: pageDate === today ? 'Not today' : `Not on ${weekday(pageDate)}`, intent: { kind: 'not-today' } }
  const first = pageDate === today && planned !== tomorrow ? [{ label: `Tomorrow · ${noticeDate(tomorrow)}`, intent: { kind: 'move', date: tomorrow } as RowIntent }] : []
  // Tomorrow is its own item on today's rows (Bumblebee 16ce6fe4), so Another day doesn't repeat it.
  if (first.length) { anotherDayGroup.items = anotherDayGroup.items.filter(i => !(i.intent !== 'pick-date' && i.intent.kind === 'move' && i.intent.date === tomorrow)) }
  return {
    primary: [...(first.length ? [{ label: 'Tomorrow', intent: first[0]!.intent }] : []), off],
    anotherDay,
    groups: [{ items: [...first, off] }, anotherDayGroup, cancel],
  }
}

/** The command a row's intent sends, from the day of the page it is on. */
export function rowAction(intent: RowIntent, taskId: string, day: LocalDate, today: LocalDate): Action {
  return intent.kind === 'move' ? { type: 'plan-task', taskId, date: intent.date, from: day, today }
    : intent.kind === 'bring-today' ? { type: 'plan-task', taskId, date: today, today }
    : intent.kind === 'not-today' ? { type: 'not-today', taskId, date: day, onlyThisDay: true }
    : { type: 'task-status', taskId, status: intent.kind === 'cancel' ? 'cancelled' : 'open', today }
}
