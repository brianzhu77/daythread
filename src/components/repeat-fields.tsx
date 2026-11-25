// The fields a repeat is set with, shared by a template's Repeat menu (database-menu.tsx) and a to-do's (todo-repeat.tsx).
import { useState } from 'react'

export const weekdayNames: readonly string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const inWeekOrder = (days: readonly number[], weekStart: number) => [...days].sort((a, b) => (a - weekStart + 7) % 7 - (b - weekStart + 7) % 7)
export const everyNames = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' } as const

/** Lets the box be empty while he types, which a value held to 1–999 wouldn't: from 1, typing 2 would give 12. Empty or out of range on leaving goes back to what's stored. */
export function RepeatEvery({ repeat, set }: { repeat: { interval: number }; set: (next: { interval: number }) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return <input aria-label="Every how many" type="number" min={1} max={999} value={draft ?? repeat.interval}
    onFocus={e => e.target.select()}
    onBlur={() => setDraft(null)}
    onChange={e => { const text = e.target.value, interval = Number(text); setDraft(text); if (Number.isInteger(interval) && interval >= 1 && interval <= 999) set({ interval }) }} />
}

/**
 * Weekly's days, the week's first day first. The last one on can't be turned off: a weekly repeat always has a day.
 * `label`: the row's word, `On` unless given.
 */
export function RepeatWeekdays({ repeat, weekStart, set, label = 'On' }: { repeat: { weekdays?: number[]; start: string }; weekStart: number; set: (days: number[]) => void; label?: string }) {
  const on = repeat.weekdays?.length ? repeat.weekdays : [new Date(`${repeat.start}T12:00:00Z`).getUTCDay()]
  // With no word, an empty span still holds the row's left, so the days stay at the right with the fields.
  return <div className="database-menu-row">{label || <span />}
    <span className="database-repeat-days" role="group" aria-label="On these days">
      {inWeekOrder([0, 1, 2, 3, 4, 5, 6], weekStart).map(day => {
        const pressed = on.includes(day)
        return <button key={day} type="button" aria-label={weekdayNames[day]} aria-pressed={pressed} disabled={pressed && on.length === 1}
          onClick={() => set(pressed ? on.filter(d => d !== day) : [...on, day])}>{weekdayNames[day]![0]}</button>
      })}
    </span>
  </div>
}
