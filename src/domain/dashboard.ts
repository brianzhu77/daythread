// Dashboard (docs/design/dashboard.md, D13): a view of rows of widgets, each a linked view of any database holding its own
// copy of its settings, with no link back to the view it came from. Stored on the host database's page with its views, so
// an older build keeps it (its `updateView` spreads the fields it doesn't know) and draws a table of the host's rows.
// Every row is full: its widths add up to 12 twelfths (Jazz df571c9f). Changes are per widget or row (database.ts), so a
// move in one tab and a filter edit in another touch different fields and both survive.
import { checkId, cleanView, DatabaseError, limits, updatedView, type Condition, type Database, type View, type ViewChange } from './database.ts'

export interface DashboardWidget {
  id: string
  /** Twelfths of the row: 3, 4, 6, 8, 9 or 12. */
  width: number
  /** The database it shows: a database page's id, or To-dos'. */
  source: string
  /** Its own copy of a view of `source`, with its own id. */
  view: View
}
export interface DashboardRow {
  id: string
  /** px, 160 to 800 in steps of 40. */
  height: number
  widgets: DashboardWidget[]
}
/** `filter`: step 3's rules across widgets, kept now so an older build has seen it (Lead 3e548c4e); nothing writes it yet. */
export interface Dashboard { rows: DashboardRow[]; filter?: Condition[] }

export const dashboardLimits = { widgets: 12, perRow: 4 } as const
export const rowHeights = { min: 160, max: 800, step: 40, initial: 320 } as const

/** A row of `n` widgets split equally, as a move, an add or a removal leaves it. */
export const equalSplit = (n: number): number[] => Array.from({ length: n }, () => 12 / n)
/** The splits a row may have, by count (Jazz f547a588): 6+6, 4+8, 8+4, 3+9, 9+3; 4+4+4 or 3+3+6 in any order; 3 each. */
export function allowedSplit(widths: readonly number[]): boolean {
  const key = widths.join('+')
  switch (widths.length) {
    case 1: return key === '12'
    case 2: return ['6+6', '4+8', '8+4', '3+9', '9+3'].includes(key)
    case 3: return key === '4+4+4' || ['3+3+6', '3+6+3', '6+3+3'].includes(key)
    case 4: return key === '3+3+3+3'
    default: return false
  }
}
export const snapHeight = (height: number): number =>
  Math.min(rowHeights.max, Math.max(rowHeights.min, Math.round(height / rowHeights.step) * rowHeights.step))

export const widgetCount = (d: Dashboard | undefined): number => d?.rows.reduce((n, r) => n + r.widgets.length, 0) ?? 0
export function findWidget(d: Dashboard, widgetId: string): { row: DashboardRow; widget: DashboardWidget; index: number } | null {
  for (const row of d.rows) {
    const index = row.widgets.findIndex(w => w.id === widgetId)
    if (index >= 0) return { row, widget: row.widgets[index]!, index }
  }
  return null
}
/** Its widths made equal, as after a widget joins or leaves it. */
export const resplit = (row: DashboardRow): void => { const widths = equalSplit(row.widgets.length); row.widgets.forEach((w, i) => { w.width = widths[i]! }) }

// ---------------------------------------------------------------- commands

/** A widget as a command brings it: its id, its source and its own view of it. Its width comes from the row it joins. */
export interface WidgetInput { id: string; source: string; view: View }
export type DashboardChange =
  /** A new Dashboard view with its first rows; Duplicate view sends a copy with every row, widget and view id new. */
  | { kind: 'addDashboard'; view: { id: string; name: string }; rows: { id: string; height?: number; widgets: (WidgetInput & { width?: number })[] }[] }
  | { kind: 'addWidget'; viewId: string; widget: WidgetInput; /** Joins this row, before `beforeId` (last when null); a new row `newRowId` at the end when null. */ rowId: string | null; newRowId?: string; beforeId: string | null }
  | { kind: 'updateWidget'; viewId: string; widgetId: string; fields: ViewChange }
  /** A drag: into row `toRowId` before `beforeId`, or a new row `newRowId` placed before `rowBeforeId` (last when null). */
  | { kind: 'moveWidget'; viewId: string; widgetId: string; toRowId: string | null; newRowId?: string; rowBeforeId?: string | null; beforeId: string | null }
  /** A menu move: trades place and width with the next or previous widget in reading order (Jazz 3810eb22). */
  | { kind: 'swapWidget'; viewId: string; widgetId: string; withId: string }
  /** A handle between neighbours: the right one takes what the left gives up, and the row must be an allowed split. */
  | { kind: 'sizeSplit'; viewId: string; rowId: string; leftId: string; rightId: string; leftWidth: number }
  | { kind: 'sizeRow'; viewId: string; rowId: string; height: number }
  | { kind: 'duplicateWidget'; viewId: string; widgetId: string; newId: string; newViewId: string; newRowId: string }
  | { kind: 'removeWidget'; viewId: string; widgetId: string }
  /** Duplicate view on a dashboard (Lead ad6dae7b): a copy as stored, every row, widget and widget view under the new id `ids` gives it. */
  | { kind: 'duplicateDashboard'; viewId: string; newViewId: string; ids: Record<string, string> }
export const dashboardKinds: ReadonlySet<string> = new Set(['addDashboard', 'addWidget', 'updateWidget', 'moveWidget', 'swapWidget', 'sizeSplit', 'sizeRow', 'duplicateWidget', 'removeWidget', 'duplicateDashboard'])
export const isDashboardChange = (change: { kind?: string } | undefined): change is DashboardChange => Boolean(change?.kind && dashboardKinds.has(change.kind))

/** A database page's own database, or To-dos', when it's there to show; null once it's in Trash or gone. */
export type SourceOf = (id: string) => Database | null

/** A widget's own copy of a view, cleaned against its source: never a dashboard inside a dashboard, nor a form. */
function cleanWidgetView(source: Database, view: View): View {
  const cleaned = cleanView(source, view)
  if (cleaned.layout === 'dashboard' || cleaned.layout === 'form') throw new DatabaseError("A widget can't be that view")
  return cleaned
}
function newWidget(sourceOf: SourceOf, input: WidgetInput, taken: Set<string>, width = 12): DashboardWidget {
  const id = checkId(input?.id), viewId = checkId(input?.view?.id)
  if (taken.has(id) || taken.has(viewId) || id === viewId) throw new DatabaseError('Invalid id')
  taken.add(id); taken.add(viewId)
  const source = sourceOf(checkId(input.source))
  if (!source) throw new DatabaseError('That database is gone')
  return { id, width, source: input.source, view: cleanWidgetView(source, input.view) }
}
/** Every id a host's dashboards use, so a new one can't be mistaken for another. */
function idsIn(db: Database): Set<string> {
  const out = new Set<string>()
  for (const v of db.views) for (const r of v.dashboard?.rows ?? []) { out.add(r.id); for (const w of r.widgets) { out.add(w.id); out.add(w.view.id) } }
  return out
}
function checkCount(d: Dashboard): void {
  if (widgetCount(d) > dashboardLimits.widgets) throw new DatabaseError(`${dashboardLimits.widgets} widgets at most`)
  if (d.rows.some(r => r.widgets.length > dashboardLimits.perRow)) throw new DatabaseError(`${dashboardLimits.perRow} widgets to a row at most`)
}
const placeIn = <T>(list: T[], item: T, before: T | undefined): void => { const at = before ? list.indexOf(before) : -1; if (at < 0) list.push(item); else list.splice(at, 0, item) }

/**
 * One dashboard command on the host database `db`. Placement (rows, order, widths, heights) and a widget's settings are
 * separate fields, and each command names what it changes, so commands from two tabs touch only their own part. A row
 * a widget joins or leaves is split equally again; no other row changes.
 */
export function changeDashboard(db: Database, change: DashboardChange, sourceOf: SourceOf): string {
  // A new view either way, so under the views' own limit as `addView` is (Ratchet 32073b65).
  if ((change.kind === 'addDashboard' || change.kind === 'duplicateDashboard') && db.views.length >= limits.views) throw new DatabaseError('Too many views')
  if (change.kind === 'addDashboard') {
    if (db.views.some(v => v.id === change.view?.id)) throw new DatabaseError('Invalid id')
    const taken = idsIn(db)
    const rows: DashboardRow[] = (Array.isArray(change.rows) ? change.rows : []).map(r => {
      const id = checkId(r?.id)
      if (taken.has(id)) throw new DatabaseError('Invalid id')
      taken.add(id)
      const widgets = (Array.isArray(r.widgets) ? r.widgets : []).map(w => newWidget(sourceOf, w, taken))
      const widths = widgets.map(w => (r.widgets.find(x => x.id === w.id)?.width ?? 0))
      const row = { id, height: snapHeight(r.height ?? rowHeights.initial), widgets }
      if (allowedSplit(widths)) widgets.forEach((w, i) => { w.width = widths[i]! }); else resplit(row)
      return row
    }).filter(r => r.widgets.length)
    const dashboard: Dashboard = { rows }
    checkCount(dashboard)
    const view = cleanView(db, { id: change.view.id, name: change.view.name, layout: 'table', columns: [], sort: [], filter: [] })
    db.views.push({ ...view, layout: 'dashboard', dashboard })
    return `Added ${view.name}`
  }
  const host = db.views.find(v => v.id === change.viewId)
  if (!host || host.layout !== 'dashboard') throw new DatabaseError('View not found')
  if (change.kind === 'duplicateDashboard') {
    const taken = idsIn(db), fresh = new Set<string>()
    const idFor = (old: string) => {
      const id = checkId(change.ids?.[old])
      if (taken.has(id) || fresh.has(id) || db.views.some(v => v.id === id)) throw new DatabaseError('Invalid id')
      fresh.add(id)
      return id
    }
    const newViewId = checkId(change.newViewId)
    if (db.views.some(v => v.id === newViewId) || taken.has(newViewId)) throw new DatabaseError('Invalid id')
    const rows = (host.dashboard?.rows ?? []).map(r => ({ ...r, id: idFor(r.id), widgets: r.widgets.map(w => ({ ...structuredClone(w), id: idFor(w.id), view: { ...structuredClone(w.view), id: idFor(w.view.id) } })) }))
    db.views.push({ ...structuredClone(host), id: newViewId, name: `${host.name} (copy)`, dashboard: { ...structuredClone(host.dashboard ?? { rows: [] }), rows } })
    return `Added ${host.name} (copy)`
  }
  const dashboard: Dashboard = host.dashboard ?? (host.dashboard = { rows: [] })
  const found = (id: string) => { const at = findWidget(dashboard, id); if (!at) throw new DatabaseError("That widget's gone"); return at }
  const rowOf = (id: string) => { const row = dashboard.rows.find(r => r.id === id); if (!row) throw new DatabaseError("That row's gone"); return row }
  const leave = (row: DashboardRow, widget: DashboardWidget) => {
    row.widgets = row.widgets.filter(w => w !== widget)
    if (row.widgets.length) resplit(row); else dashboard.rows = dashboard.rows.filter(r => r !== row)
  }
  const newRow = (id: string | undefined, before: DashboardRow | undefined, height: number = rowHeights.initial): DashboardRow => {
    const rowId = checkId(id)
    if (idsIn(db).has(rowId)) throw new DatabaseError('Invalid id')
    const row: DashboardRow = { id: rowId, height, widgets: [] }
    placeIn(dashboard.rows, row, before)
    return row
  }
  switch (change.kind) {
    case 'addWidget': {
      const widget = newWidget(sourceOf, change.widget, idsIn(db))
      const row = change.rowId === null ? newRow(change.newRowId, undefined) : rowOf(change.rowId)
      placeIn(row.widgets, widget, change.beforeId ? row.widgets.find(w => w.id === change.beforeId) : undefined)
      resplit(row)
      checkCount(dashboard)
      return 'Widget added'
    }
    case 'updateWidget': {
      const { widget } = found(change.widgetId)
      const source = sourceOf(widget.source)
      if (!source) throw new DatabaseError('That database is gone')
      const next = updatedView(source, widget.view, change.fields)
      if (next.layout === 'dashboard' || next.layout === 'form') throw new DatabaseError("A widget can't be that view")
      widget.view = next
      return 'View saved'
    }
    case 'moveWidget': {
      const { row: from, widget, index } = found(change.widgetId)
      if (change.toRowId === from.id) {
        // Within its own row: only its order changes, and each keeps its width. Back where it was is refused (Ratchet 29f73fd7).
        const others = from.widgets.filter(w => w !== widget), before = change.beforeId ? others.find(w => w.id === change.beforeId) : undefined
        const at = before ? others.indexOf(before) : others.length
        if (at === index) throw new DatabaseError('Already there')
        others.splice(at, 0, widget)
        from.widgets = others
        return 'Widget moved'
      }
      if (change.toRowId === null && from.widgets.length === 1 && (change.rowBeforeId ?? null) === (dashboard.rows[dashboard.rows.indexOf(from) + 1]?.id ?? null)) throw new DatabaseError('Already there')
      const before = change.rowBeforeId ? dashboard.rows.find(r => r.id === change.rowBeforeId) : undefined
      const to = change.toRowId === null ? newRow(change.newRowId, before, from.height) : rowOf(change.toRowId)
      if (to.widgets.length >= dashboardLimits.perRow) throw new DatabaseError(`${dashboardLimits.perRow} widgets to a row at most`)
      leave(from, widget)
      placeIn(to.widgets, widget, change.beforeId ? to.widgets.find(w => w.id === change.beforeId) : undefined)
      resplit(to)
      return 'Widget moved'
    }
    case 'swapWidget': {
      const order = dashboard.rows.flatMap(r => r.widgets.map(w => ({ row: r, widget: w })))
      const a = order.findIndex(x => x.widget.id === change.widgetId), b = order.findIndex(x => x.widget.id === change.withId)
      if (a < 0 || b < 0) throw new DatabaseError("That widget's gone")
      if (Math.abs(a - b) !== 1) throw new DatabaseError('Not next to each other')
      const one = order[a]!, two = order[b]!, i = one.row.widgets.indexOf(one.widget), j = two.row.widgets.indexOf(two.widget)
      // Each takes the other's place and width, so both rows stay full and nothing else moves.
      const [w1, w2] = [one.widget.width, two.widget.width]
      one.row.widgets[i] = two.widget; two.row.widgets[j] = one.widget
      two.widget.width = w1; one.widget.width = w2
      return 'Widget moved'
    }
    case 'sizeSplit': {
      const row = rowOf(change.rowId)
      const i = row.widgets.findIndex(w => w.id === change.leftId)
      if (i < 0 || row.widgets[i + 1]?.id !== change.rightId) throw new DatabaseError('Not next to each other')
      const left = row.widgets[i]!, right = row.widgets[i + 1]!, total = left.width + right.width
      const widths = row.widgets.map(w => (w === left ? change.leftWidth : w === right ? total - change.leftWidth : w.width))
      if (!Number.isInteger(change.leftWidth) || !allowedSplit(widths)) throw new DatabaseError("That row can't split that way")
      left.width = change.leftWidth; right.width = total - change.leftWidth
      return 'Width saved'
    }
    case 'sizeRow': {
      const row = rowOf(change.rowId)
      if (!Number.isFinite(change.height)) throw new DatabaseError('Invalid height')
      row.height = snapHeight(change.height)
      return 'Height saved'
    }
    case 'duplicateWidget': {
      const { row, widget, index } = found(change.widgetId)
      // The stored copy as it is, held settings and all (Ratchet 29f73fd7): only its ids are new, so nothing is cleaned away.
      const taken = idsIn(db), newWidgetId = checkId(change.newId), newViewId = checkId(change.newViewId)
      if (taken.has(newWidgetId) || taken.has(newViewId) || newWidgetId === newViewId) throw new DatabaseError('Invalid id')
      const copy: DashboardWidget = { id: newWidgetId, width: widget.width, source: widget.source, view: { ...structuredClone(widget.view), id: newViewId } }
      // After the original, in its row if there's room, or in a new row under it (Jazz f547a588).
      if (row.widgets.length < dashboardLimits.perRow) { row.widgets.splice(index + 1, 0, copy); resplit(row) }
      else { copy.width = 12; newRow(change.newRowId, dashboard.rows[dashboard.rows.indexOf(row) + 1], row.height).widgets.push(copy) }
      checkCount(dashboard)
      return 'Widget duplicated'
    }
    case 'removeWidget': {
      const { row, widget } = found(change.widgetId)
      leave(row, widget)
      return 'View removed'
    }
    default:
      throw new DatabaseError('Unknown change')
  }
}

/** The widths to draw a row with: as stored when they're an allowed split, equal otherwise. A projection for drawing only, never saved (Ratchet). */
export const shownWidths = (row: DashboardRow): number[] => {
  const widths = row.widgets.map(w => w.width)
  return allowedSplit(widths) ? widths : equalSplit(row.widgets.length)
}
/** The view a new widget starts from: the source's first that a widget can be, or a plain table (Ratchet: a first view may be a dashboard or a form). */
export function firstWidgetView(source: Database, id: string): View {
  const first = source.views.find(v => v.layout !== 'dashboard' && v.layout !== 'form')
  return first ? { ...structuredClone(first), id } : { id, name: 'Table', layout: 'table', columns: source.properties.map(p => ({ id: p.id })), sort: [], filter: [] }
}
