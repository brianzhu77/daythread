// B98's conflict keys inside a page (docs/design/outbox.md §6, Lead b9a9108b, Ratchet bab28cc3 58a63858): what a change
// to a page touched, finer than the whole stored row, so two changes to unrelated parts of one database page (a widget
// moved, a dashboard's filter edited) don't meet. The server's row check and the browser's dependencies both read them.
//
// Each part of a page has a key and a value; a change writes the keys whose value it changed, added or removed. A part
// also has guards: the lifecycle keys of what it sits in (the page, the view, the widget). A change is checked against
// its guards as well as its writes, so an edit can't land in a view or widget removed, replaced or trashed since it was
// made, even on a field the removed one never had. Guards are only checked, never stamped by the edit itself.
import type { Page } from './types.ts'
import type { View } from './database.ts'

/** What a page change touched: keys it wrote, and the lifecycle keys those sit under. */
export interface PageKeys { writes: string[]; guards: string[] }

interface Part { value: string; guards: string[] }

/** A view's fields, by the key they're kept under: a filter's rules, any/all and groups are one part. */
const viewGroup = (field: string): string => (field === 'filterAny' || field === 'filterGroups' ? 'filter' : field)

function viewParts(out: Map<string, Part>, prefix: string, view: View, guards: string[]): void {
  const groups = new Map<string, Record<string, unknown>>()
  for (const [field, value] of Object.entries(view)) {
    // `dashboard` is split below; `widgetFilter` is drawn only, never stored; `id` is the part's own name.
    if (field === 'dashboard' || field === 'widgetFilter' || field === 'id') continue
    const group = viewGroup(field)
    groups.set(group, { ...(groups.get(group) ?? {}), [field]: value })
  }
  for (const [group, fields] of groups) out.set(`${prefix}/${group}`, { value: JSON.stringify(fields), guards })
}

/** Every part of a page, with its value and guards. */
export function partsOf(page: Page): Map<string, Part> {
  const out = new Map<string, Part>()
  const { database, editedAt: _edited, ...own } = page
  const life = `life:${page.id}`
  // The page itself: whether it's there, in Trash, a database; everything below sits under this.
  out.set(life, { value: JSON.stringify({ trashed: Boolean(page.trashedAt), database: Boolean(database) }), guards: [] })
  out.set(`page:${page.id}`, { value: JSON.stringify(own), guards: [] })
  if (!database) return out
  const d = `db/${page.id}`, inDb = [life]
  const { views, properties, ...rest } = database
  out.set(`${d}/views`, { value: JSON.stringify(views.map(v => v.id)), guards: inDb })
  out.set(`${d}/props`, { value: JSON.stringify(properties), guards: inDb })
  for (const [field, value] of Object.entries(rest)) out.set(`${d}/${field}`, { value: JSON.stringify(value), guards: inDb })
  for (const view of views) {
    const viewLife = `life:view:${view.id}`, inView = [life, viewLife]
    out.set(viewLife, { value: '1', guards: inDb })
    viewParts(out, `view/${view.id}`, view, inView)
    const dash = view.dashboard
    if (!dash) continue
    const layout = dash.rows.map(r => ({ id: r.id, height: r.height, widgets: r.widgets.map(w => ({ id: w.id, width: w.width })) }))
    out.set(`dash/${view.id}/layout`, { value: JSON.stringify(layout), guards: inView })
    out.set(`dash/${view.id}/filter`, { value: JSON.stringify({ filter: dash.filter ?? [], any: Boolean(dash.filterAny) }), guards: inView })
    for (const row of dash.rows) for (const widget of row.widgets) {
      const widgetLife = `life:widget:${widget.id}`, inWidget = [life, viewLife, widgetLife]
      out.set(widgetLife, { value: '1', guards: inView })
      out.set(`widget/${widget.id}/source`, { value: JSON.stringify({ source: widget.source, view: widget.view.id }), guards: inWidget })
      viewParts(out, `widget/${widget.id}`, widget.view, inWidget)
    }
  }
  return out
}

/** The keys a change from `before` to `after` of one page wrote (absent: made or removed), and their guards. */
export function pageKeys(before: Page | undefined, after: Page | undefined): PageKeys {
  const was = before ? partsOf(before) : new Map<string, Part>(), now = after ? partsOf(after) : new Map<string, Part>()
  const writes: string[] = [], guards = new Set<string>()
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(key), b = now.get(key)
    if (a?.value === b?.value) continue
    writes.push(key)
    for (const g of [...(a?.guards ?? []), ...(b?.guards ?? [])]) guards.add(g)
  }
  for (const key of writes) guards.delete(key)
  return { writes, guards: [...guards] }
}

/**
 * The ids a key says a change made or removed, for the browser's dependencies by reference (§6): a page, view or
 * widget's lifecycle, and the rows kept one per id (tasks, deleted tasks, threads, links). A page's own fields or a part
 * inside it name nothing, so edits to sibling parts of one page don't wait on each other (Ratchet 58a63858).
 */
export function idsOfKey(key: string): string[] {
  if (key.startsWith('life:view:')) return [key.slice('life:view:'.length)]
  if (key.startsWith('life:widget:')) return [key.slice('life:widget:'.length)]
  if (key.startsWith('life:')) return [key.slice('life:'.length)]
  for (const kind of ['task:', 'deleted:', 'thread:', 'link:']) if (key.startsWith(kind)) return [key.slice(kind.length)]
  return []
}
