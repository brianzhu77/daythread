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

export interface ChartPoint { key: string; name: string; rows: Page[]; value: number | null; result: CalcResult }
export interface ChartData { property: Property; points: ChartPoint[]; dateAxis: boolean; tooMany: boolean }

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
const isDateAxis = (p: Property): boolean => p.type === 'date' || p.type === 'createdTime' || p.type === 'editedTime'

export function chartData(db: Database, view: View, rows: readonly Page[], weekStart: WeekStart = 0): ChartData | 'choose' | null {
  const settings = chartSettings(view), measure = chartMeasure(db, view)
  if (settings.form === 'number') return null
  if (measure === 'gone') return 'choose'
  // By year goes through months, as a year must hold whole months: a week's key is its first day, which can be in the year before.
  // Nor can a month hidden in a month view quietly take from a year.
  const groups = viewGroups(db, settings.byYear ? { ...view, groupDateBy: 'month', hiddenGroups: [] } : view, rows, undefined, weekStart)
  if (!groups) return 'choose'
  let shown = groups.shown.map(g => ({ key: g.key, name: g.name, rows: g.rows }))
  const dateAxis = isDateAxis(groups.property)
  let tooMany = false
  if (dateAxis) {
    const by = view.groupDateBy ?? 'month', dated = shown.filter(g => g.key !== noValue), none = shown.filter(g => g.key === noValue), byKey = new Map(dated.map(g => [g.key, g]))
    const hidden = new Set(view.hiddenGroups ?? [])
    let filled = dated
    if (settings.byYear) {
      const years = new Map<string, Page[]>()
      for (const g of dated) { const y = g.key.slice(0, 4); years.set(y, [...(years.get(y) ?? []), ...g.rows]) }
      const list = [...years.keys()].sort()
      if (list.length && !view.hideEmptyGroups && Number(list.at(-1)) - Number(list[0]) < chartLimit) { filled = []; for (let y = Number(list[0]); y <= Number(list.at(-1)); y++) filled.push({ key: String(y), name: String(y), rows: years.get(String(y)) ?? [] }) }
      else { filled = list.map(y => ({ key: y, name: y, rows: years.get(y)! })); tooMany = !view.hideEmptyGroups && list.length > 1 }
    } else if (dated.length > 1 && !view.hideEmptyGroups) {
      // Every period between the first and the last, so a gap reads as a gap (§3), but for one he hid. A view that hides its empty groups has asked not to.
      // Past the limit it can't be drawn anyway, and only real values go to the table of data.
      const all: typeof dated = []
      for (let key = dated[0]!.key, last = dated.at(-1)!.key; key <= last; key = next(key, by)) {
        if (all.length > chartLimit) { tooMany = true; break }
        if (!hidden.has(key)) all.push(byKey.get(key) ?? { key, name: dateGroupName(key, by), rows: [] })
      }
      if (!tooMany) filled = all
    }
    shown = [...filled, ...none]
  }
  // No value only where a row has none: a select always has the group, for a board to drop on, but it isn't a bar.
  shown = shown.filter(g => g.key !== noValue || g.rows.length > 0)
  let points: ChartPoint[] = shown.map(g => { const result = chartValue(db, g.rows, measure); return { ...g, result, value: numberOf(result) } })
  if (settings.cumulative && !settings.sortByValue && (kindOf(measure) === 'countAll' || kindOf(measure) === 'sum')) {
    // No value isn't a point along the axis: it keeps its own number, and stays out of the running total.
    let total = 0, any = false
    points = points.map(p => { if (p.key === noValue) return p; if (p.value !== null) { total += p.value; any = true } const value = any ? total : null; return { ...p, value, result: measure ? { type: 'number', value } : { type: 'count', value: value ?? 0 } } })
  }
  if (settings.sortByValue) points = [...points].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
  return { property: groups.property, points, dateAxis, tooMany: tooMany || points.length > chartLimit }
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
/** For where a whole number won't fit: an axis, or above a bar. The exact value is in its hover and the table of data. */
export const shortNumber = (n: number): string => (Math.abs(n) >= 10_000 ? compact.format(n) : n.toLocaleString('en-US', { maximumFractionDigits: 2 }))

const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const shortMonth = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
/**
 * The labels an axis shows, every `step`th. A date gives its year only on the first and where it changes, so each is short and none leaves you guessing:
 * "Jan 2025, Mar, May, Jan 2026". Anything else is its name.
 */
export function axisLabels(points: readonly Pick<ChartPoint, 'key' | 'name'>[], step: number, dateAxis: boolean): { key: string; label: string; full: string }[] {
  let year = ''
  return points.filter((_, i) => i % step === 0).map(p => {
    const isDay = /^\d{4}-\d{2}-\d{2}$/.test(p.key), isMonth = /^\d{4}-\d{2}$/.test(p.key)
    if (!dateAxis || (!isDay && !isMonth)) return { key: p.key, label: p.name, full: p.name }
    const y = p.key.slice(0, 4), at = new Date(`${isDay ? p.key : `${p.key}-01`}T12:00:00Z`), head = (isDay ? shortDay : shortMonth).format(at), changed = y !== year
    year = y
    return { key: p.key, label: changed ? `${head}${isDay ? ',' : ''} ${y}` : head, full: p.name }
  })
}
/** Without a way to measure: a full-width character takes about a whole em at the axis's 12 px, others about 7. */
const estimateWidth = (label: string): number => [...label].reduce((n, c) => n + (/[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(c) || c.codePointAt(0)! > 0xffff ? 13 : 7), 0)
/**
 * How thinly the axis must label so each has room: a label has the bars up to the next, and the last sits against the edge with what the one before leaves.
 * `widthOf` measures the words in the axis's font, as an estimate can't know a Chinese name from a Latin one well enough to be safe.
 */
export function axisStep(points: readonly Pick<ChartPoint, 'key' | 'name'>[], band: number, dateAxis: boolean, widthOf: (label: string) => number = estimateWidth): number {
  if (!band) return 1
  const room = (label: string) => widthOf(label) + 8
  for (let step = 1; step < points.length; step++) {
    const widths = axisLabels(points, step, dateAxis).map(l => room(l.label)), last = widths.at(-1)!, before = widths.at(-2) ?? 0
    const barsLeft = points.length - (widths.length - 1) * step
    if (widths.slice(0, -1).every(w => w <= band * step) && last <= band * barsLeft + (band * step - before)) return step
  }
  return Math.max(points.length, 1)
}

/** Round numbers from below the lowest value to above the highest, always with zero, as bars start there. */
export function chartTicks(values: readonly number[], count = 3): number[] {
  const low = Math.min(0, ...values), high = Math.max(0, ...values)
  if (low === high) return [0, 1]
  const rough = (high - low) / count, power = 10 ** Math.floor(Math.log10(rough)), scaled = rough / power
  const step = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power
  const out: number[] = []
  for (let n = Math.floor(low / step); n * step < high + step * 0.999; n++) out.push(Number((n * step).toPrecision(12)))
  return out
}
