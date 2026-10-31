import { createContext, useContext } from 'react'
import type { LocalDate, Task } from '../domain/types'
import { addDays, anotherDayOptions, fromIso, shortLabel, weekday } from './dates'
import type { MenuItem } from './row-menu'

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

export interface RowActions {
  /** The page's day; null on a page that isn't a day. */
  pageDate: LocalDate | null
  today: LocalDate
  /** B70: a template's to-dos are rows only: no task is read, ticked or changed from them (Ratchet b0315979). */
  rowsOnly?: boolean
  act(blockId: string, task: Task, intent: RowIntent): void
  /** A11: copies a link to the line, or null where Copy link to line isn't offered. */
  copyLink(blockId: string): (() => void) | null
  /** Puts the caret back at the end of the row (Esc from its menu, Jazz A12 check 8). */
  focusRow(blockId: string): void
}

export const RowActionsContext = createContext<RowActions | null>(null)
export const useRowActions = () => useContext(RowActionsContext)

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

/** Pick date…: the native date input keeps this tappable on iPhone without a custom calendar (as the Tasks screen). */
export function pickDate(today: LocalDate, onPick: (date: LocalDate) => void) {
  const input = document.createElement('input')
  input.type = 'date'
  input.min = today
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.addEventListener('change', () => {
    if (input.value) onPick(input.value)
    input.remove()
  })
  input.addEventListener('blur', () => setTimeout(() => input.remove(), 500))
  input.showPicker?.()
  input.focus()
}

/** The model as RowMenu groups. */
export function menuGroups(model: RowMenuModel, today: LocalDate, choose: (intent: RowIntent) => void): { title?: string; items: MenuItem[] }[] {
  return model.groups.map(g => ({
    title: g.title,
    items: g.items.map(i => ({ label: i.label, danger: i.danger, onSelect: () => (i.intent === 'pick-date' ? pickDate(today, date => choose({ kind: 'move', date })) : choose(i.intent)) })),
  }))
}
