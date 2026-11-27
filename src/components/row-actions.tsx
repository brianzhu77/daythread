import { createContext, useContext } from 'react'
import type { LocalDate, Task } from '../domain/types'
import { addDays } from './dates'
import type { MenuItem } from './row-menu'
import { noticeDate, rowMenu, type RowIntent, type RowMenuModel } from './row-menu-model'

// Old home of the row's pure functions; they live in row-menu-model.ts, where node can run them.
export { noticeDate, rowMenu }
export type { RowIntent, RowMenuModel }

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
