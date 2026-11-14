// The Map view's rows (map-contract.md §4, §5; D15 G8-10): which rows get a pin, at most 100 at a time in the view's
// own order, and which have no place. Pure, so every count the map shows comes from the rows the view's filter left.
import { hasPin, isPlaceValue, type PlaceValue } from './place.ts'

export const mapLimits = { pins: 100 } as const

export interface MapRow<R> { row: R; place: PlaceValue & { lat: number; lon: number } }
export interface MapRows<R> {
  /** Shown as pins: the first `pins` rows with a pin, in the order given. */
  pinned: MapRow<R>[]
  /** Every row with a pin, shown or not: "100 of 240 shown". */
  withPin: number
  /** Rows with no place, or words with no pin: "No place · 3 ›". */
  noPlace: R[]
}

/** `rows` are the view's rows, already filtered and sorted; `placeOf` reads a row's value of the Map's Place property. */
export function mapRows<R>(rows: readonly R[], placeOf: (row: R) => unknown, cap: number = mapLimits.pins): MapRows<R> {
  const pinned: MapRow<R>[] = [], noPlace: R[] = []
  let withPin = 0
  for (const row of rows) {
    const v = placeOf(row)
    if (isPlaceValue(v) && hasPin(v)) { withPin++; if (pinned.length < cap) pinned.push({ row, place: v }) }
    else noPlace.push(row)
  }
  return { pinned, withPin, noPlace }
}

/** "100 of 240 shown", only when some are left out. */
export const shownLine = (m: { pinned: unknown[]; withPin: number }): string | null => (m.withPin > m.pinned.length ? `${m.pinned.length} of ${m.withPin} shown` : null)
