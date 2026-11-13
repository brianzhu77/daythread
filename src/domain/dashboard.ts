// Dashboard (docs/design/dashboard.md, D13): a view of rows of widgets, each a linked view of any database holding its own
// copy of its settings, with no link back to the view it came from. Stored on the host database's page with its views, so
// an older build keeps it (its `updateView` spreads the fields it doesn't know) and draws a table of the host's rows.
// Every row is full: its widths add up to 12 twelfths (Jazz df571c9f). Changes are per widget or row (database.ts), so a
// move in one tab and a filter edit in another touch different fields and both survive.
import { checkId, cleanView, DatabaseError, limits, opsFor, titleId, updatedView, type Condition, type Database, type FilterOp, type Json, type PropertyType, type View, type ViewChange } from './database.ts'

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
/** `filter`: rules across its widgets (G6-6), all holding or, with `filterAny`, any; each bound to a property per source. */
export interface Dashboard { rows: DashboardRow[]; filter?: DashboardRule[]; filterAny?: true }
/**
 * A rule across widgets (dashboard.md §4): made on a property by its name and type, its options by name, and bound when
 * saved to that property in each source (`on`, by id). After that it reads only its bound id, so a rename keeps it and
 * no other property renamed to the old name picks it up (G6-6).
 */
export interface DashboardRule { id: string; name: string; type: PropertyType; op: FilterOp; value?: Json; /** A Relation's database. */ target?: string; /** On every widget's Name, which every database has (Bumblebee 0d1055eb). */ title?: true; on: Record<string, RuleBinding> }
/** Where a rule reads in one source: its property, and for options their ids there, so a rename of either keeps it (Lead ad03bcd0). */
export interface RuleBinding { propertyId: string; optionIds?: string[] }

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
  /** A handle: the row's widths, left to right, for its widgets as the handle saw them; an allowed split, or refused (Jazz 36988993). */
  | { kind: 'sizeSplit'; viewId: string; rowId: string; widgetIds: string[]; widths: number[] }
  | { kind: 'sizeRow'; viewId: string; rowId: string; height: number }
  | { kind: 'duplicateWidget'; viewId: string; widgetId: string; newId: string; newViewId: string; newRowId: string }
  | { kind: 'removeWidget'; viewId: string; widgetId: string }
  /** Duplicate view on a dashboard (Lead ad6dae7b): a copy as stored, every row, widget and widget view under the new id `ids` gives it. */
  | { kind: 'duplicateDashboard'; viewId: string; newViewId: string; ids: Record<string, string> }
  /** The rules across widgets: the list as it now reads. A rule already there keeps its binding; a new one is bound now. */
  | { kind: 'setDashboardFilter'; viewId: string; rules: Omit<DashboardRule, 'on'>[]; any?: boolean }
export const dashboardKinds: ReadonlySet<string> = new Set(['addDashboard', 'addWidget', 'updateWidget', 'moveWidget', 'swapWidget', 'sizeSplit', 'sizeRow', 'duplicateWidget', 'removeWidget', 'duplicateDashboard', 'setDashboardFilter'])
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
      // A source new to the dashboard is bound as it arrives; one already there keeps what it has, bound or not (Ratchet 1fc10a66).
      const known = dashboard.rows.some(r => r.widgets.some(w => w.source === widget.source))
      { const source = sourceOf(widget.source); if (source && !known) bindSource(dashboard, widget.source, source) }
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
      // A lone widget to a new row just above or below its own is where it already is.
      if (change.toRowId === null && from.widgets.length === 1 && ([from.id, dashboard.rows[dashboard.rows.indexOf(from) + 1]?.id ?? null] as (string | null)[]).includes(change.rowBeforeId ?? null)) throw new DatabaseError('Already there')
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
      // Across two rows each takes the other's place and width, so both rows stay full; within one row each keeps its own
      // width, as a reorder there does (Jazz c80ba341). Nothing else moves either way.
      one.row.widgets[i] = two.widget; two.row.widgets[j] = one.widget
      if (one.row !== two.row) { const width = one.widget.width; one.widget.width = two.widget.width; two.widget.width = width }
      return 'Widget moved'
    }
    case 'sizeSplit': {
      const row = rowOf(change.rowId)
      // Its widgets as the handle saw them, in order: a row changed since (a widget in or out, or moved) is refused, not resized.
      if (!Array.isArray(change.widgetIds) || change.widgetIds.join() !== row.widgets.map(w => w.id).join()) throw new DatabaseError("That row's changed since")
      if (!Array.isArray(change.widths) || change.widths.length !== row.widgets.length || !change.widths.every(Number.isInteger) || !allowedSplit(change.widths)) throw new DatabaseError("That row can't split that way")
      row.widgets.forEach((w, i) => { w.width = change.widths[i]! })
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
    case 'setDashboardFilter': {
      if (!Array.isArray(change.rules) || change.rules.length > limits.conditions) throw new DatabaseError(`${limits.conditions} rules at most`)
      const held = new Map((dashboard.filter ?? []).map(r => [r.id, r]))
      const sources = [...new Set(dashboard.rows.flatMap(r => r.widgets.map(w => w.source)))]
      const rules = change.rules.map(input => {
        const rule = cleanRule(input), kept = held.get(rule.id)
        // Its property changed (another name, type or Relation database): a rule on something else, bound afresh (Ratchet 1fc10a66).
        const was = kept && kept.name === rule.name && kept.type === rule.type && kept.target === rule.target && kept.title === rule.title ? kept : undefined
        const on: Record<string, RuleBinding> = structuredClone(was?.on ?? {})
        for (const id of sources) {
          const source = sourceOf(id)
          if (!source) continue
          const bound = on[id], property = bound && source.properties.find(p => p.id === bound.propertyId)
          // A source with no binding yet is bound now, so a property added since is picked up on the next save (Lead ad03bcd0,
          // Bumblebee 012cf5ed); one already bound keeps its property, and only its options are read again if they changed.
          if (!bound) { const fresh = bindingIn(rule, source); if (fresh) on[id] = fresh }
          else if (property && optionTypes.has(rule.type) && JSON.stringify(was?.value) !== JSON.stringify(rule.value)) on[id] = { propertyId: bound.propertyId, ...(rule.value !== undefined && rule.value !== null ? { optionIds: optionIdsIn(property, rule.value) } : {}) }
        }
        return { ...rule, on }
      })
      if (new Set(rules.map(r => r.id)).size !== rules.length) throw new DatabaseError('Invalid id')
      if (rules.length) dashboard.filter = rules; else delete dashboard.filter
      if (change.any) dashboard.filterAny = true; else delete dashboard.filterAny
      return 'Filter saved'
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

/**
 * The layouts a handle between widget `k - 1` and widget `k` snaps through, left to right as the handle moves
 * (dashboard-edit.md §5): with two, every allowed split; with three, the right one grown to 1/2, all equal, then the
 * left one grown; with four, only equal, so nothing to move.
 */
export function handleChoices(count: number, k: number): number[][] {
  if (count === 2) return [[3, 9], [4, 8], [6, 6], [8, 4], [9, 3]]
  if (count !== 3) return [equalSplit(count)]
  const grow = (i: number) => [0, 1, 2].map(j => (j === i ? 6 : 3))
  return [grow(k), [4, 4, 4], grow(k - 1)]
}

// ---------------------------------------------------------------- rules across widgets (G6-6)

const optionTypes: ReadonlySet<string> = new Set(['select', 'status', 'multiSelect'])
const named = (s: string) => s.trim().toLocaleLowerCase()
/** Where a rule would be bound in a source now: the same name and type (for a Relation the same database), and its options by name. */
function bindingIn(rule: Pick<DashboardRule, 'name' | 'type' | 'target' | 'value' | 'title'>, source: Database): RuleBinding | undefined {
  if (rule.title) return { propertyId: titleId }
  const property = source.properties.find(p => named(p.name) === named(rule.name) && p.type === rule.type && (rule.type !== 'relation' || p.target === rule.target))
  if (!property) return undefined
  return { propertyId: property.id, ...(optionTypes.has(rule.type) && rule.value !== undefined && rule.value !== null ? { optionIds: optionIdsIn(property, rule.value) } : {}) }
}
/** Option names as a property's ids: an option it lacks reads as '' and so never matches, leaving the rule unreadable there. */
function optionIdsIn(property: Database['properties'][number], value: Json): string[] {
  return (Array.isArray(value) ? value : [value]).map(n => property.options?.find(o => typeof n === 'string' && named(o.name) === named(n))?.id ?? '')
}
/** Each rule bound for `sourceId` where it isn't yet, as a widget of a source arrives; a rule bound there already keeps its property. */
export function bindSource(d: Dashboard, sourceId: string, source: Database): void {
  for (const rule of d.filter ?? []) if (!(sourceId in rule.on)) { const binding = bindingIn(rule, source); if (binding) rule.on[sourceId] = binding }
}

/**
 * The rule as a widget of `sourceId` reads it: a condition on its bound property, with option names as that property's
 * ids; null where it's unreadable there (no binding, the property gone or changed type, an option it lacks, another
 * Relation target), which counts neither way (§4).
 */
export function ruleIn(rule: DashboardRule, sourceId: string, source: Database): Condition | null {
  // A source that has never had a binding for it reads it by name and type now, writing nothing, so the sheet and the widget
  // agree; the next save stores it (Bumblebee 4cea29f6). A source bound before keeps its binding, even to a deleted property.
  const binding = rule.on[sourceId] ?? bindingIn(rule, source)
  if (rule.title && binding?.propertyId === titleId) return { by: titleId, op: rule.op, ...(rule.value !== undefined ? { value: rule.value } : {}) }
  const property = binding && source.properties.find(p => p.id === binding.propertyId)
  if (!property || property.type !== rule.type || (rule.type === 'relation' && property.target !== rule.target)) return null
  if (!optionTypes.has(rule.type) || rule.value === undefined || rule.value === null) return { by: property.id, op: rule.op, ...(rule.value !== undefined ? { value: rule.value } : {}) }
  // By the ids bound when saved: a renamed option still reads; a deleted one, or one it never had, leaves it unreadable.
  const ids = binding.optionIds ?? []
  if (!ids.length || ids.some(id => !property.options?.some(o => o.id === id))) return null
  return { by: property.id, op: rule.op, value: Array.isArray(rule.value) ? ids : ids[0]! }
}
/** How the dashboard's rules read in one widget: those that apply, and how many there are. */
export function widgetRules(d: Dashboard, widget: Pick<DashboardWidget, 'source'>, source: Database): { applied: Condition[]; total: number } {
  const rules = d.filter ?? []
  return { applied: rules.flatMap(r => { const c = ruleIn(r, widget.source, source); return c ? [c] : [] }), total: rules.length }
}
/** "Not filtered", "Partly filtered" or nothing, beside a widget's name (Lead 495829a7): state, not instruction. */
export const filterState = (r: { applied: Condition[]; total: number }): 'none' | 'partly' | null => (!r.total ? null : !r.applied.length ? 'none' : r.applied.length < r.total ? 'partly' : null)
/**
 * The view a widget is drawn through: its own filter and the dashboard's applicable rules as two whole groups, both
 * holding. `+ New` takes its own filter's values first, and a dashboard rule fills only what that leaves (`widgetFilter`). Never stored (§4).
 */
export function filteredView(view: View, applied: readonly Condition[], any: boolean): View {
  if (!applied.length) return view
  const own = { ...(view.filterAny ? { any: true as const } : {}), rules: view.filter, ...(view.filterGroups?.length ? { groups: view.filterGroups } : {}) }
  const { filterAny: _any, ...rest } = view, dashboard = { ...(any ? { any: true as const } : {}), rules: [...applied] }
  return { ...rest, filter: [], filterGroups: [own, dashboard], widgetFilter: { own: view, dashboard } }
}
/** A rule as a command brings it, checked; its binding comes from the dashboard, never from the tab. */
function cleanRule(input: Omit<DashboardRule, 'on'>): Omit<DashboardRule, 'on'> {
  const id = checkId(input?.id)
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > limits.name) throw new DatabaseError('A rule needs a property')
  if (!(opsFor(input.type as PropertyType) ?? []).includes(input.op)) throw new DatabaseError('Invalid rule')
  if (optionTypes.has(input.type) && input.value !== undefined && !(Array.isArray(input.value) ? input.value.every(v => typeof v === 'string') : typeof input.value === 'string')) throw new DatabaseError('Invalid rule')
  if (input.title && input.type !== 'text') throw new DatabaseError('Invalid rule')
  return { id, name: input.name.trim(), type: input.type, op: input.op, ...(input.value !== undefined ? { value: input.value } : {}), ...(input.type === 'relation' && input.target ? { target: checkId(input.target) } : {}), ...(input.title ? { title: true as const } : {}) }
}
