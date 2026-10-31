import type { Task, Workspace } from '../domain/types'

// B72 (Lead d6d0cc5f): a tapped checkbox ticks at once. While its save is out, further taps on that to-do are ignored,
// so a double tap can't send Done twice or, landing just after the answer, reopen it. After the answer the tick
// lingers for HOLD_MS so a row that leaves its list on Done stays put, and a fast second tap can't hit the neighbour
// sliding into its place. A failed save drops the tick: the box shows the stored state again.

/** How long a ticked row stays in a list it leaves on Done, after its save has answered. The only timer in B72. */
export const HOLD_MS = 1000

export type TickStatus = Extract<Task['status'], 'open' | 'done'>
/** `to`: the tapped state. `saving`: its command is out. `holding`: it answered and the row lingers. `token` tells one tap from the next. */
export interface Tick { to: TickStatus; phase: 'saving' | 'holding'; token: number }
export type Ticks = ReadonlyMap<string, Tick>

/** The tick a tap would start, or null when the tap must be ignored (a save is out, or the to-do is cancelled). */
export function startTick(ticks: Ticks, task: Pick<Task, 'id' | 'status'>, token: number): Tick | null {
  if (ticks.get(task.id)?.phase === 'saving' || task.status === 'cancelled') return null
  return { to: task.status === 'done' ? 'open' : 'done', phase: 'saving', token }
}

export const withTick = (ticks: Ticks, id: string, tick: Tick | null): Ticks => {
  const next = new Map(ticks)
  if (tick) next.set(id, tick)
  else next.delete(id)
  return next
}

/** Changes `id`'s tick only if it is still the one with `token`: a later tap owns the row from then on. */
export const settleTick = (ticks: Ticks, id: string, token: number, tick: Tick | null): Ticks =>
  ticks.get(id)?.token === token ? withTick(ticks, id, tick) : ticks

/** What the box shows for the stored to-do: the tapped state while its save is out, else the stored one (an Undo shows at once). */
export function shownStatus(ticks: Ticks, task: Pick<Task, 'id' | 'status'>): Task['status'] {
  const tick = ticks.get(task.id)
  return tick?.phase === 'saving' ? tick.to : task.status
}

/**
 * The workspace for lists of open to-dos (the Tasks screen): a ticked to-do keeps its place, as open, until its hold
 * ends, so the row leaves no sooner than a second after the save answered. A tap on it in that second reopens it.
 */
export function heldWorkspace(ws: Workspace, ticks: Ticks): Workspace {
  if (!ticks.size) return ws
  let changed = false
  const tasks = ws.tasks.map(t => {
    if (!ticks.has(t.id) || t.status !== 'done') return t
    changed = true
    return { ...t, status: 'open' as const }
  })
  return changed ? { ...ws, tasks } : ws
}
