// Chart, a layout of a view (docs/design/chart.md): the view's own rows in its own groups, so a filter, a group and a column
// calculation all agree with what's drawn. The axis is the view's `groupBy` and `groupDateBy`; only what's new is in `chart`.
import { calcChoices, columnCalc, dateGroupName, propertyOf, viewGroups, type CalcKind, type CalcResult, type Database, type Property, type View } from './database.ts'
import type { WeekStart } from './types.ts'
import type { Page } from './types.ts'

export const chartForms = ['bar', 'barHorizontal', 'number'] as const
export type ChartForm = (typeof chartForms)[number]
export const chartKinds = ['sum', 'average', 'median', 'min', 'max', 'range'] as const
export type ChartKind = (typeof chartKinds)[number]
export interface ChartSettings {
  form: ChartForm
  /** Absent: a count of rows. */
  measure?: { by: string; kind: ChartKind }
  sortByValue?: true
  /** Each value adds the ones before it, along the axis. */
  cumulative?: true
  /** A date axis by year. Not a `groupDateBy`: a build that reads this as a table would find a value it can't name. */
  byYear?: true
}
/** More values than can be told apart, as Notion's limit. It says so, and the table of data still has them all. */
export const chartLimit = 200

export interface ChartPoint { key: string; name: string; /** What the axis has room for: a date without its year or "Week of". */ short: string; rows: Page[]; value: number | null; result: CalcResult }
export interface ChartData { property: Property; points: ChartPoint[]; tooMany: boolean }

export const chartSettings = (view: Pick<View, 'chart'>): ChartSettings => view.chart ?? { form: 'bar' }
/** What's measured: null for a count. `gone` when its property was deleted or stopped being a number, so it asks again rather than counting instead. */
export function chartMeasure(db: Database, view: Pick<View, 'chart'>): { property: Property; kind: ChartKind } | null | 'gone' {
  const measure = view.chart?.measure
  if (!measure) return null
  const property = propertyOf(db, measure.by)
  return property && calcChoices(property.type).includes(measure.kind) && property.type === 'number' ? { property, kind: measure.kind } : 'gone'
}
const kindOf = (measure: { kind: ChartKind } | null): CalcKind => measure?.kind ?? 'countAll'
/** The value over some rows. A blank isn't a zero (§6): with no numbers at all, even Sum has none. */
export function chartValue(db: Database, rows: readonly Page[], measure: { property: Property; kind: ChartKind } | null): CalcResult {
  if (!measure) return columnCalc(db, rows, 'title', 'countAll')
  const result = columnCalc(db, rows, measure.property.id, measure.kind)
  if (measure.kind === 'sum' && !columnCalc(db, rows, measure.property.id, 'countNotEmpty').value) return { type: 'number', value: null }
  return result
}
const numberOf = (result: CalcResult): number | null => (result.type === 'count' || result.type === 'number' ? result.value : null)

const next = (key: string, by: 'day' | 'week' | 'month'): string => {
  if (by === 'month') { const [y, m] = key.split('-').map(Number) as [number, number]; const d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 7) }
  const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (by === 'week' ? 7 : 1)); return d.toISOString().slice(0, 10)
}
const noValue = 'none'
const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const shortMonth = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
function shortName(key: string, name: string, isDate: boolean): string {
  if (!isDate || key === noValue) return name
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return shortDay.format(new Date(`${key}T12:00:00Z`))
  return /^\d{4}-\d{2}$/.test(key) ? shortMonth.format(new Date(`${key}-01T12:00:00Z`)) : name
}
const isDateAxis = (p: Property): boolean => p.type === 'date' || p.type === 'createdTime' || p.type === 'editedTime'

export function chartData(db: Database, view: View, rows: readonly Page[], weekStart: WeekStart = 0): ChartData | 'choose' | null {
  const settings = chartSettings(view), measure = chartMeasure(db, view)
  if (settings.form === 'number') return null
  if (measure === 'gone') return 'choose'
  const groups = viewGroups(db, view, rows, undefined, weekStart)
  if (!groups) return 'choose'
  let shown = groups.shown.map(g => ({ key: g.key, name: g.name, rows: g.rows }))
  if (isDateAxis(groups.property)) {
    const by = view.groupDateBy ?? 'month', dated = shown.filter(g => g.key !== noValue), none = shown.filter(g => g.key === noValue), byKey = new Map(dated.map(g => [g.key, g]))
    let filled = dated
    // Every period between the first and the last, so a gap reads as a gap (§3). A view that hides its empty groups has asked not to.
    if (dated.length > 1 && !view.hideEmptyGroups && !settings.byYear) {
      filled = []
      for (let key = dated[0]!.key, last = dated.at(-1)!.key; key <= last && filled.length <= chartLimit; key = next(key, by)) filled.push(byKey.get(key) ?? { key, name: dateGroupName(key, by), rows: [] })
    }
    if (settings.byYear) {
      const years = new Map<string, Page[]>()
      for (const g of dated) { const y = g.key.slice(0, 4); years.set(y, [...(years.get(y) ?? []), ...g.rows]) }
      const list = [...years.keys()].sort()
      filled = []
      if (list.length) for (let y = Number(list[0]); y <= Number(list.at(-1)) && filled.length <= chartLimit; y++) filled.push({ key: String(y), name: String(y), rows: years.get(String(y)) ?? [] })
    }
    shown = [...filled, ...none]
  }
  const dateAxis = isDateAxis(groups.property)
  let points: ChartPoint[] = shown.map(g => { const result = chartValue(db, g.rows, measure); return { ...g, short: shortName(g.key, g.name, dateAxis), result, value: numberOf(result) } })
  if (settings.cumulative && !settings.sortByValue && (kindOf(measure) === 'countAll' || kindOf(measure) === 'sum')) {
    let total = 0, any = false
    points = points.map(p => { if (p.value !== null) { total += p.value; any = true } const value = any ? total : null; return { ...p, value, result: measure ? { type: 'number', value } : { type: 'count', value: value ?? 0 } } })
  }
  if (settings.sortByValue) points = [...points].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
  return { property: groups.property, points, tooMany: points.length > chartLimit }
}

/** Round numbers from below the lowest value to above the highest, always with zero, as bars start there. */
export function chartTicks(values: readonly number[], count = 3): number[] {
  const low = Math.min(0, ...values), high = Math.max(0, ...values)
  if (low === high) return [0, 1]
  const rough = (high - low) / count, power = 10 ** Math.floor(Math.log10(rough)), scaled = rough / power
  const step = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power
  const out: number[] = []
  for (let n = Math.floor(low / step); n * step < high + step * 0.999; n++) out.push(Math.round(n * step * 1e9) / 1e9)
  return out
}
