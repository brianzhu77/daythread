import { useEffect, useRef, useState } from 'react'
import type { LocalDate } from '../domain/types'
import { todayIso } from './dates'
import { ownDrafts } from './draft-slots'
import { leaveSavesPending } from './editor-flush'

/** No input for this long means he isn't on the screen (Jazz, Bumblebee, Lead c61baf51). */
const idleMs = 10 * 60_000
// His scrolling arrives as wheel, touch or keys; a bare `scroll` also fires when a screen re-lays itself out, which isn't use.
const inputEvents = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const
// A pointer resting over a screen that re-renders gets a synthetic move; only a key, tap or click ends `movedTo`.
const actions = new Set<string>(['keydown', 'pointerdown', 'touchstart'])
let lastInput = Date.now()
/** The day a screen just moved to on its own; cleared by his next key, tap or click. */
let movedTo: LocalDate | null = null
let watching = false
function watchInput() {
  if (watching) return
  watching = true
  const noteInput = (e: Event) => { lastInput = Date.now(); if (actions.has(e.type)) movedTo = null }
  for (const type of inputEvents) document.addEventListener(type, noteInput, { capture: true, passive: true })
}

/** True for the day a screen moved to on its own until his next key, tap or click: its editor opens without a cursor. */
export const openedByTurnover = (date: LocalDate | null): boolean => date !== null && movedTo === date

/** A cursor resting in the editor isn't use; text still waiting to save is. */
function mayTurnOver(now: number): boolean {
  return now - lastInput >= idleMs && ownDrafts().length === 0 && !leaveSavesPending()
}

/**
 * Today for a screen that stays open on a day. Reading it once at mount let a Home Screen app resumed on Oct 23 still
 * treat Oct 21 as today and offer Oct 21's morning card. It's re-read once a minute and on every return to the app,
 * and moves to the new date only after 10 minutes with no input and nothing waiting to save: a trip to another app at
 * 23:55 keeps the day he was writing in, while a tab left open overnight, which may never see a return event, moves on.
 * When it moves, the editor's focus is released and the new day's editor opens without a cursor, so his first
 * keystroke can't land in the new day unseen. Labels that should turn over on their own at midnight use `useToday`
 * (page-tree).
 */
export function useScreenToday(): LocalDate {
  const [today, setToday] = useState(todayIso)
  const shown = useRef(today)
  shown.current = today
  useEffect(() => {
    watchInput()
    const check = () => {
      const next = todayIso()
      if (next === shown.current || !mayTurnOver(Date.now())) return
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      movedTo = next
      setToday(next)
    }
    const onReturn = () => { if (document.visibilityState === 'visible') check() }
    const timer = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('pageshow', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('pageshow', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [])
  return today
}
