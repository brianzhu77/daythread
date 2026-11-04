// Dependencies (docs/design/sub-items.md §3): two ordinary relations on the database, with a behaviour on top: when a blocker's dates move,
// what it blocks moves too, by the mode he chose, on down the chain, as part of the same operation so one Undo returns them all.
import { addDays, readValue, type Database, type DateValue, type Dependencies, type Json, type Property, type RawValues } from './database.ts'
import type { Page } from './types.ts'

export interface Span { start: string; end: string }
const day = (text: string) => text.slice(0, 10)
const number = (text: string) => Math.round(Date.parse(`${day(text)}T12:00:00Z`) / 86_400_000)
const isWeekend = (text: string) => { const d = new Date(`${day(text)}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6 }
const moved = (text: string, by: number) => `${addDays(day(text), by)}${text.slice(10)}`
const propertyIn = (db: Database, id: string | undefined): Property | undefined => (id ? db.properties.find(p => p.id === id) : undefined)
const links = (row: Page, id: string): string[] => { const raw = row.values?.[id]; return Array.isArray(raw) ? (raw as string[]) : [] }

/** A row's dates: one Date's start and end, or a start and an end property. None if it has no date to go by. */
export function spanOf(db: Database, deps: Dependencies, row: Page): Span | null {
  const start = propertyIn(db, deps.date), value = start ? (readValue(start, row.values?.[start.id]) as DateValue | null) : null
  if (!value) return null
  const endProperty = propertyIn(db, deps.end)
  const other = endProperty ? (readValue(endProperty, row.values?.[endProperty.id]) as DateValue | null) : null
  return { start: value.start, end: other?.start ?? value.end ?? value.start }
}
function write(deps: Dependencies, row: Page, span: Span, had: DateValue | null): void {
  const values: RawValues = { ...row.values }
  values[deps.date] = deps.end || had?.end === undefined ? (span.start as Json) : { start: span.start, end: span.end }
  if (deps.end) values[deps.end] = span.end as Json
  row.values = values
}
/** Keeping its length, it moves on until neither end falls on a Saturday or Sunday, whatever Week starts says. */
function settled(span: Span, by: number, avoidWeekends: boolean | undefined): Span {
  let next = { start: moved(span.start, by), end: moved(span.end, by) }
  if (avoidWeekends) for (let guard = 0; guard < 14 && (isWeekend(next.start) || isWeekend(next.end)); guard++) next = { start: moved(next.start, 1), end: moved(next.end, 1) }
  return next
}

/** Whether what this row blocks leads back to it. */
export function hasDependencyLoop(rows: readonly Page[], deps: Dependencies, rowId: string): boolean {
  const byId = new Map(rows.map(r => [r.id, r])), seen = new Set<string>()
  // Its own two-way sync skips a link to itself, so that one only shows on the side that was set.
  const own = byId.get(rowId)
  if (own && (links(own, deps.blockedBy).includes(rowId) || links(own, deps.blocking).includes(rowId))) return true
  const walk = (id: string): boolean => {
    for (const next of links(byId.get(id) ?? ({} as Page), deps.blocking)) {
      if (next === rowId) return true
      if (!seen.has(next)) { seen.add(next); if (walk(next)) return true }
    }
    return false
  }
  return walk(rowId)
}

/**
 * A blocker's dates went from `before` to `after`: what moves, down the chain. It writes to the rows and returns their ids. A row with no
 * date doesn't move or fail: the chain carries on past it, from the last date known.
 */
export function shiftDependents(db: Database, deps: Dependencies, rows: readonly Page[], rowId: string, before: Span | null, after: Span | null, at: string): string[] {
  if (deps.mode === 'none' || !before || !after) return []
  const byId = new Map(rows.map(r => [r.id, r]))
  const out: string[] = []
  const apply = (row: Page, span: Span, by: number): Span => {
    const next = settled(span, by, deps.avoidWeekends)
    const dateProperty = propertyIn(db, deps.date)!
    write(deps, row, next, readValue(dateProperty, row.values?.[dateProperty.id]) as DateValue | null)
    row.editedAt = at
    out.push(row.id)
    return next
  }
  if (deps.mode === 'keep') {
    const by = number(after.end) - number(before.end)
    if (!by) return []
    const seen = new Set([rowId])
    const walk = (id: string) => {
      for (const next of links(byId.get(id) ?? ({} as Page), deps.blocking)) {
        if (seen.has(next)) continue
        seen.add(next)
        const row = byId.get(next)
        if (!row) continue
        const span = spanOf(db, deps, row)
        if (span) apply(row, span, by)
        walk(next)
      }
    }
    walk(rowId)
    return out
  }
  // Only when they'd overlap: in order, as a row may have several blockers, and it starts the day after the last of them ends.
  const ends = new Map<string, string>([[rowId, after.end]])
  const order: string[] = [], visited = new Set([rowId])
  const visit = (id: string) => { for (const next of links(byId.get(id) ?? ({} as Page), deps.blocking)) if (!visited.has(next) && byId.has(next)) { visited.add(next); visit(next); order.unshift(next) } }
  visit(rowId)
  const endOf = (id: string): string | null => { const known = ends.get(id); if (known) return known; const row = byId.get(id); return row ? spanOf(db, deps, row)?.end ?? null : null }
  for (const id of order) {
    const row = byId.get(id)!, span = spanOf(db, deps, row)
    const blockers = links(row, deps.blockedBy).map(endOf).filter((x): x is string => x !== null)
    const latest = blockers.length ? blockers.reduce((a, b) => (number(a) > number(b) ? a : b)) : null
    if (!span) { if (latest) ends.set(id, latest); continue }
    if (latest && number(span.start) <= number(latest)) ends.set(id, apply(row, span, number(latest) + 1 - number(span.start)).end)
  }
  return out
}
