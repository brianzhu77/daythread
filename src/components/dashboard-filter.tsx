// A dashboard's Filter sheet (dashboard-edit.md §9, dashboard.md §4): the view's Filter sheet, with properties listed once by
// name and type across its widgets ("3 of 4"), options once by name, and each rule that doesn't apply to the widget it was
// opened from marked "Not in Runs". Every change saves the whole list as one `setDashboardFilter`.
import { filterState, ruleIn, widgetRules, type Dashboard, type DashboardRule } from '../domain/dashboard'
import { databaseRows, isDatabase, limits, opsFor, type Condition, type Database, type FilterOp, type Json, type Option, type Property, type View } from '../domain/database'
import { readingWorkspace, todosSourceId, todosTitle } from '../domain/todos-source'
import type { Page, Workspace } from '../domain/types'
import { opLabels, RuleValue } from './database-menu'
import { displayPageTitle } from './page-title'
import { useWorkspace } from './use-day'

type DatabasePage = Page & { database: Database }
type RuleInput = Omit<DashboardRule, 'on'>
const named = (s: string) => s.trim().toLocaleLowerCase()
const newId = (): string => crypto.randomUUID()

/** The widget a sheet was opened from, for its "Not in …" marks; none from the head (§9). */
let openedFrom: string | null = null
export const openDashboardFilterFrom = (widgetId: string | null) => { openedFrom = widgetId }

interface Source { id: string; title: string; db: Database }
/** The sources a dashboard's widgets show, once each, in the widgets' order. */
export function dashboardSources(workspace: Workspace, d: Dashboard): Source[] {
  const seen = new Set<string>(), out: Source[] = []
  for (const w of d.rows.flatMap(r => r.widgets)) {
    if (seen.has(w.source)) continue
    seen.add(w.source)
    const page = readingWorkspace(workspace, w.source).pages.find(p => p.id === w.source)
    if (isDatabase(page) && !page.trashedAt) out.push({ id: w.source, title: w.source === todosSourceId ? todosTitle : displayPageTitle(page), db: page.database })
  }
  return out
}

/** A property as the sheet lists it: once by name and type (and a Relation's database), with its options once by name. */
interface Entry { key: string; name: string; type: Property['type']; target?: string; options: Option[]; widgets: number }
const keyOf = (p: { name: string; type: string; target?: string; title?: true }) => (p.title ? 'title' : `${named(p.name)}|${p.type}|${p.type === 'relation' ? p.target ?? '' : ''}`)
function entriesOf(workspace: Workspace, d: Dashboard, sources: Source[]): Entry[] {
  const entries = new Map<string, Entry>()
  const widgets = d.rows.flatMap(r => r.widgets)
  for (const s of sources) for (const p of s.db.properties) {
    if (p.type === 'button' || !opsFor(p.type).length) continue
    const key = keyOf(p)
    const entry = entries.get(key) ?? { key, name: p.name, type: p.type, ...(p.type === 'relation' && p.target ? { target: p.target } : {}), options: [], widgets: 0 }
    // Options once by name: its own id is its name here, as a rule stores names (§4).
    for (const o of p.options ?? []) if (!entry.options.some(x => named(x.name) === named(o.name))) entry.options.push({ ...o, id: o.name })
    entries.set(key, entry)
  }
  // A Relation's values are its database's rows, by id: one database for the entry, so the same rows in every widget it reaches.
  for (const e of entries.values()) if (e.type === 'relation' && e.target) e.options = databaseRows(workspace, e.target).map(r => ({ id: r.id, name: displayPageTitle(r) }) as Option)
  // Name first: every widget has it, so a rule on it reaches them all (Bumblebee 0d1055eb).
  const title: Entry = { key: 'title', name: 'Name', type: 'text', options: [], widgets: widgets.length }
  for (const e of entries.values()) e.widgets = widgets.filter(w => { const s = sources.find(x => x.id === w.source); return s?.db.properties.some(p => keyOf(p) === e.key) }).length
  return [title, ...entries.values()]
}
/** The entry as a property RuleValue can draw, its options' ids being their names. */
const asProperty = (e: Entry): Property => ({ id: e.key, name: e.name, type: e.type, ...(e.options.length ? { options: e.options } : {}), ...(e.target ? { target: e.target } : {}) }) as Property

export function DashboardFilterPanel({ workspace, host, view, back }: { workspace: Workspace; host: DatabasePage; view: View; back: () => void }) {
  const { run } = useWorkspace()
  const d: Dashboard = view.dashboard ?? { rows: [] }
  const sources = dashboardSources(workspace, d), entries = entriesOf(workspace, d, sources)
  const rules: RuleInput[] = (d.filter ?? []).map(({ on: _on, ...r }) => r)
  const from = openedFrom ? d.rows.flatMap(r => r.widgets).find(w => w.id === openedFrom) : undefined
  const fromSource = from && sources.find(s => s.id === from.source)
  const save = (next: RuleInput[], any = Boolean(d.filterAny)) => void run({ type: 'change-database', pageId: host.id, change: { kind: 'setDashboardFilter', viewId: view.id, rules: next, any } })
  const set = (i: number, rule: RuleInput) => save(rules.map((r, j) => (j === i ? rule : r)))
  const onEntry = (e: Entry): RuleInput => ({ id: newId(), name: e.name, type: e.type, op: opsFor(e.type)[0]!, ...(e.type === 'checkbox' ? { value: true } : {}), ...(e.target ? { target: e.target } : {}), ...(e.key === 'title' ? { title: true as const } : {}) })
  // Two properties with one name but different types are two entries, and only then is the type named (§9).
  const label = (e: Entry) => (e.key !== 'title' && entries.filter(x => named(x.name) === named(e.name)).length > 1 ? `${e.name} · ${typeName(e.type)}` : e.name)
  return <div className="database-filter-sheet dashboard-filter">
    <div className="database-menu-head">{back && <button type="button" className="database-menu-back" aria-label="Back" onClick={back}>‹</button>}<span>Filter</span></div>
    {!rules.length && <p className="database-menu-quiet">No filters</p>}
    {rules.length > 1 && <label className="database-menu-row">Show rows where
      <select aria-label="Show rows where" value={d.filterAny ? 'any' : 'all'} onChange={e => save(rules, e.target.value === 'any')}><option value="all">all match</option><option value="any">any matches</option></select>
    </label>}
    {rules.map((r, i) => {
      const entry = entries.find(e => e.key === keyOf(r)) ?? { key: keyOf(r), name: r.name, type: r.type, options: [], widgets: 0, ...(r.target ? { target: r.target } : {}) }
      const stored = d.filter?.[i]
      const missing = fromSource && stored && !ruleIn(stored, fromSource.id, fromSource.db)
      const condition: Condition = { by: entry.key, op: r.op, ...(r.value !== undefined ? { value: r.value } : {}) }
      return <div key={r.id} className="database-rule">
        <select aria-label="Property" value={entry.key} onChange={e => { const next = entries.find(x => x.key === e.target.value); if (next) set(i, { ...onEntry(next), id: newId() }) }}>
          {!entries.some(e => e.key === entry.key) && <option value={entry.key}>{r.name}</option>}
          {entries.map(e => <option key={e.key} value={e.key}>{label(e)}</option>)}
        </select>
        <select aria-label="Condition" value={r.op} onChange={e => set(i, { ...r, op: e.target.value as FilterOp, ...(e.target.value.includes('Empty') ? { value: undefined } : {}) })}>
          {opsFor(r.type).map(op => <option key={op} value={op}>{opLabels[op]}</option>)}
        </select>
        <RuleValue property={asProperty(entry)} condition={condition} onChange={(value: Json | undefined) => { const { value: _v, ...rest } = r; set(i, value === undefined ? rest : { ...rest, value }) }} />
        {missing && <span className="dashboard-rule-missing">Not in {fromSource.title}</span>}
        <button type="button" className="database-rule-remove" aria-label="Remove filter" onClick={() => save(rules.filter((_, j) => j !== i))}>×</button>
      </div>
    })}
    {rules.length >= limits.conditions
      ? <p className="database-filter-full">{limits.conditions} rules at most</p>
      : entries.length > 0 && <div className="database-filter-adds dashboard-filter-adds">
        <span className="database-menu-quiet">Add a filter on</span>
        {entries.map(e => <button key={e.key} type="button" role="menuitem" className="database-add-rule" onClick={() => save([...rules, onEntry(e)])}>
          <span>{label(e)}</span><span className="dashboard-filter-count">{e.widgets} of {d.rows.reduce((n, r) => n + r.widgets.length, 0)}</span>
        </button>)}
      </div>}
  </div>
}

const typeNames: Partial<Record<Property['type'], string>> = { text: 'Text', number: 'Number', select: 'Select', status: 'Status', multiSelect: 'Multi-select', date: 'Date', checkbox: 'Checkbox', relation: 'Relation', url: 'URL', email: 'Email', phone: 'Phone', files: 'Files', createdTime: 'Created time', editedTime: 'Edited time', id: 'ID' }
const typeName = (t: Property['type']) => typeNames[t] ?? t

/** "Not filtered" or "Partly filtered" beside a widget's name, opening the sheet with this widget's marks; nothing when all apply. */
export function filterLabel(d: Dashboard, widget: { id: string; source: string }, source: Database): 'Not filtered' | 'Partly filtered' | null {
  const state = filterState(widgetRules(d, widget, source))
  return state === 'none' ? 'Not filtered' : state === 'partly' ? 'Partly filtered' : null
}
