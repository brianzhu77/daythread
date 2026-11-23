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
  copyRow(blockId: string): void
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

/**
 * Pick date…: the native date input keeps this tappable on iPhone without a custom calendar (as the Tasks screen).
 * `onCancel`: the picker closed with no day taken, so the caller can put focus back: `key` for Esc, `pointer` for a tap
 * or click elsewhere, `other` for the picker's own Cancel or Done (iOS).
 * `at`: the control that opened it. The hidden input sits on it, in view: placed nowhere, iOS scrolled the page to it
 * (the end of the body) as it took focus, and the calendar opened with his row off screen (Jazz 380bf5b1).
 */
export function pickDate(today: LocalDate, onPick: (date: LocalDate) => void, options: { onCancel?: (by: 'key' | 'pointer' | 'other') => void; at?: Element | null } = {}) {
  const { onCancel, at } = options
  const input = document.createElement('input')
  input.type = 'date'
  input.min = today
  // iOS Safari fills an empty date field with today as it takes focus and sends `change` before any picker shows, so
  // "Pick date…" took today on his phone (Jazz's Simulator pass, Nov 19). Starting one day before the earliest it
  // allows, iOS opens its calendar on that month and sends `change` only for a day he taps, the earliest included
  // (Ratchet 5de80cde). A day before `min` is never taken.
  input.value = addDays(today, -1)
  const r = at?.getBoundingClientRect()
  Object.assign(input.style, { position: 'fixed', opacity: '0', width: '1px', height: '1px', padding: '0', border: '0', top: r ? `${Math.round(r.top + r.height / 2)}px` : '50%', left: r ? `${Math.round(r.left + r.width / 2)}px` : '50%' })
  document.body.append(input)
  // iOS doesn't blur the input when he closes its calendar by tapping empty page: a tap anywhere else is a cancel.
  let by: 'key' | 'pointer' | 'other' = 'other'
  const away = (e: PointerEvent) => { if (e.target !== input) { by = 'pointer'; input.blur() } }
  document.addEventListener('pointerdown', away, true)
  let picked = false
  input.addEventListener('change', () => {
    if (input.value && input.value >= today) { picked = true; onPick(input.value) }
    input.remove()
  })
  // Chrome's own calendar takes the Esc keydown to close itself and the input only hears the keyup: without it, focus
  // stayed on the hidden input until a second Esc (B112). Whichever reaches it first cancels; blurred, it misses the other.
  const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { by = 'key'; input.blur() } }
  input.addEventListener('keydown', escape)
  input.addEventListener('keyup', escape)
  input.addEventListener('blur', () => { document.removeEventListener('pointerdown', away, true); setTimeout(() => { input.remove(); if (!picked) onCancel?.(by) }, 500) })
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
