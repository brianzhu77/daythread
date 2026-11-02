// Databases R1: the `⋯` menu of a table (design §8) with its Filter and Sort sheets (§7.3), Properties (§7.5) and a
// property's own menu (§6.2). Like the cell editors it lives outside the page editor's block (one host in the app
// shell), so a redraw of the block never closes it; only which menu is open is shared.
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isDatabase, propertyOf, titleId, typeLabels, propertyTypes, type Condition, type Database, type DatabaseChange, type FilterOp, type Json, type Property, type PropertyType, type Sort, type View } from '../domain/database.ts'
import type { Page } from '../domain/types'
import { blockActions, setShownView, shownView } from './database-block'
import { ChevronDownIcon } from './icons'
import { useWorkspace } from './use-day'

type Panel = 'root' | 'filter' | 'sort' | 'properties' | { property: string } | 'new-property' | 'views'
interface OpenMenu { blockId: string; databaseId: string; panel: Panel }
/** The views list opens under "Table ⌄" on the left; every other panel under the `⋯` on the right. */
const anchorOf = (m: OpenMenu) => m.panel === 'views' ? `[data-database-views="${CSS.escape(m.blockId)}"]` : `[data-database-menu="${CSS.escape(m.blockId)}"]`
let openMenu: OpenMenu | null = null
const listeners = new Set<() => void>()
function setOpenMenu(next: OpenMenu | null) { openMenu = next; for (const l of listeners) l() }
function useOpenMenu() { return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => openMenu, () => null) }
const newId = (): string => crypto.randomUUID()

/** Opens a table's menu on one of its panels (a filter chip opens Filter). */
export function openDatabaseMenu(blockId: string, databaseId: string, panel: 'filter' | 'sort' = 'filter') { setOpenMenu({ blockId, databaseId, panel }) }

/** The `⋯` on a table (inline or full page): opens its menu under it. */
export function DatabaseMenuButton({ blockId, databaseId }: { blockId: string; databaseId: string }) {
  const open = useOpenMenu()
  const here = open?.blockId === blockId
  return <button type="button" className="database-more-button" data-database-menu={blockId} aria-label="Database options" aria-haspopup="menu" aria-expanded={here}
    onClick={() => setOpenMenu(here ? null : { blockId, databaseId, panel: 'root' })}>⋯</button>
}

/** "Table ⌄" (design §7.1): the view the block shows, opening the list of views. */
export function DatabaseViewsButton({ blockId, databaseId, name }: { blockId: string; databaseId: string; name: string }) {
  const open = useOpenMenu()
  const here = open?.blockId === blockId && open.panel === 'views'
  return <button type="button" className="database-view-name" data-database-views={blockId} aria-haspopup="menu" aria-expanded={here}
    onClick={() => setOpenMenu(here ? null : { blockId, databaseId, panel: 'views' })}>{name}<ChevronDownIcon /></button>
}

/** Mounted once (app shell): the open table menu, under its `⋯`. */
export function DatabaseMenuHost() {
  const open = useOpenMenu()
  const { workspace } = useWorkspace()
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; right?: number; left?: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) { setAt(null); return }
    let frame = 0
    const place = () => {
      const anchor = document.querySelector<HTMLElement>(anchorOf(open))
      if (!anchor) { setOpenMenu(null); return }
      const r = anchor.getBoundingClientRect()
      const next = open.panel === 'views' ? { top: r.bottom + 4, left: Math.max(8, r.left) } : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }
      setAt(a => (a && a.top === next.top && a.left === next.left && a.right === next.right ? a : next))
      frame = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [open?.blockId, open?.panel === 'views']) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      const t = e.target as Element
      // The scrim closes on its own click, so the tap's click can't land on the page once it's gone.
      if (!ref.current?.contains(t) && !t.closest?.(`[data-database-menu], [data-database-views], .database-menu-scrim`)) setOpenMenu(null)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const db = open ? workspace?.pages.find(p => p.id === open.databaseId) : undefined
  if (!open || !at || !isDatabase(db) || db.trashedAt) return null
  const view = shownView(db.database, open.blockId)
  const go = (panel: Panel) => setOpenMenu({ ...open, panel })
  // The phone's dimmed page behind the sheet (CSS hides it at ≥ 900 px): a tap there only closes the menu, and never
  // reaches the page under it (Jazz's native run: it put a caret there).
  return <>
    <div className="database-menu-scrim" aria-hidden="true" onClick={() => setOpenMenu(null)} />
    <div ref={ref} className="app-menu database-menu" role="dialog" aria-label="Database options" style={{ position: 'fixed', top: at.top, ...(at.left !== undefined ? { left: at.left } : { right: at.right }) }}
    onKeyDown={e => e.stopPropagation()}>
    {open.panel === 'views' && <ViewsPanel db={db} blockId={open.blockId} />}
    {open.panel === 'root' && <RootPanel db={db} blockId={open.blockId} go={go} />}
    {open.panel === 'filter' && <FilterPanel db={db} view={view} back={() => go('root')} />}
    {open.panel === 'sort' && <SortPanel db={db} view={view} back={() => go('root')} />}
    {open.panel === 'properties' && <PropertiesPanel db={db} view={view} go={go} />}
    {open.panel === 'new-property' && <NewPropertyPanel db={db} view={view} go={go} />}
    {typeof open.panel === 'object' && <PropertyPanel db={db} view={view} propertyId={open.panel.property} go={go} />}
  </div>
  </>
}

type DatabasePage = Page & { database: Database }

function useChange(db: DatabasePage) {
  const { run } = useWorkspace()
  return (change: DatabaseChange, withUndo = false) => void run({ type: 'change-database', pageId: db.id, change }, withUndo ? r => ({ text: r.message, undoOperationId: r.operationId }) : null)
}

function Head({ title, back }: { title: string; back?: () => void }) {
  return <div className="database-menu-head">{back && <button type="button" className="database-menu-back" aria-label="Back" onClick={back}>‹</button>}<span>{title}</span></div>
}

function RootPanel({ db, blockId, go }: { db: DatabasePage; blockId: string; go: (p: Panel) => void }) {
  const { run } = useWorkspace()
  const navigate = useNavigate()
  const inline = !blockId.startsWith('page:') && db.database.homeBlockId === blockId
  const actions = blockActions.get(blockId)
  const close = () => setOpenMenu(null)
  const remove = () => {
    close()
    void run({ type: 'delete-page', pageId: db.id, at: new Date().toISOString() }, r => ({ text: `${db.title.trim() || 'Untitled database'} ${r.message.charAt(0).toLowerCase()}${r.message.slice(1)}`, undoOperationId: r.operationId }))
    if (!inline) void navigate({ to: '/pages', search: db.parentId ? { page: db.parentId } : {} })
  }
  const copyLink = () => { close(); void navigator.clipboard?.writeText(new URL(`/pages?page=${encodeURIComponent(db.id)}`, window.location.origin).href) }
  return <>
    <div className="database-menu-tiles">
      <button type="button" onClick={() => go('filter')}>Filter</button>
      <button type="button" onClick={() => go('sort')}>Sort</button>
    </div>
    <button type="button" role="menuitem" onClick={() => go('properties')}>Properties<span className="database-menu-chevron">›</span></button>
    <hr />
    {inline && <button type="button" role="menuitem" onClick={() => { close(); void navigate({ to: '/pages', search: { page: db.id } }) }}>Open as page</button>}
    {inline && actions && <button type="button" role="menuitem" onClick={() => { close(); actions.turnIntoPage(blockId, db.id) }}>Turn into page</button>}
    <button type="button" role="menuitem" onClick={copyLink}>Copy link</button>
    <hr />
    <button type="button" role="menuitem" className="is-danger" onClick={remove}>Delete database</button>
  </>
}

// ---------------------------------------------------------------- filter (design §7.3)

const opLabels: Record<FilterOp, string> = {
  contains: 'contains', doesNotContain: "doesn't contain", is: 'is', isNot: 'is not', isEmpty: 'is empty', isNotEmpty: 'is not empty',
  eq: '=', ne: '≠', gt: '>', lt: '<', gte: '≥', lte: '≤', isAnyOf: 'is any of', isNoneOf: 'is none of',
  before: 'is before', after: 'is after', onOrBefore: 'is on or before', onOrAfter: 'is on or after', within: 'is within',
}
/** The conditions each type offers (design §7.3). */
export function opsFor(type: PropertyType): FilterOp[] {
  switch (type) {
    case 'text': case 'url': return ['contains', 'is', 'isEmpty', 'isNotEmpty']
    case 'number': return ['eq', 'ne', 'gt', 'lt', 'isEmpty']
    case 'select': case 'status': return ['isAnyOf', 'isNoneOf', 'isEmpty']
    case 'multiSelect': return ['contains', 'doesNotContain', 'isEmpty']
    case 'date': return ['is', 'before', 'after', 'within', 'isEmpty']
    case 'checkbox': return ['is']
  }
}
const titleProperty: Property = { id: titleId, name: 'Name', type: 'text' }
function columnsOf(db: Database): Property[] { return [titleProperty, ...db.properties] }

function FilterPanel({ db, view, back }: { db: DatabasePage; view: View; back: () => void }) {
  const change = useChange(db)
  const save = (filter: Condition[]) => change({ kind: 'updateView', viewId: view.id, filter })
  const set = (i: number, next: Condition) => save(view.filter.map((c, j) => (j === i ? next : c)))
  const add = () => save([...view.filter, { by: titleId, op: 'contains' }])
  return <>
    <Head title="Filter" back={back} />
    {view.filter.length === 0 && <p className="database-menu-quiet">No filters</p>}
    {view.filter.map((c, i) => {
      const property = propertyOf(db.database, c.by)
      return <div key={i} className="database-rule">
        {property ? <>
          <select aria-label="Property" value={c.by} onChange={e => { const p = propertyOf(db.database, e.target.value)!; set(i, { by: p.id, op: opsFor(p.type)[0]!, ...(p.type === 'checkbox' ? { value: true } : {}) }) }}>
            {columnsOf(db.database).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select aria-label="Condition" value={c.op} onChange={e => set(i, { by: c.by, op: e.target.value as FilterOp, ...(c.value !== undefined && !e.target.value.includes('Empty') ? { value: c.value } : {}) })}>
            {opsFor(property.type).map(op => <option key={op} value={op}>{opLabels[op]}</option>)}
          </select>
          <RuleValue property={property} condition={c} onChange={value => set(i, value === undefined ? { by: c.by, op: c.op } : { ...c, value })} />
        </> : <span className="database-rule-deleted">(deleted)</span>}
        <button type="button" className="database-rule-remove" aria-label="Remove filter" onClick={() => save(view.filter.filter((_, j) => j !== i))}>×</button>
      </div>
    })}
    <button type="button" role="menuitem" onClick={add}>+ Add filter</button>
  </>
}

function RuleValue({ property, condition, onChange }: { property: Property; condition: Condition; onChange: (value: Json | undefined) => void }) {
  const { op, value } = condition
  if (op === 'isEmpty' || op === 'isNotEmpty') return null
  switch (property.type) {
    case 'text': case 'url':
      return <CommitInput key={String(value ?? '')} initial={typeof value === 'string' ? value : ''} onCommit={v => onChange(v || undefined)} />
    case 'number':
      return <CommitInput key={String(value ?? '')} initial={typeof value === 'number' ? String(value) : ''} inputMode="decimal" onCommit={v => { const n = Number(v.replace(/,/g, '')); onChange(v.trim() && Number.isFinite(n) ? n : undefined) }} />
    case 'checkbox':
      return <select aria-label="Value" value={value === false ? 'no' : 'yes'} onChange={e => onChange(e.target.value === 'yes')}>
        <option value="yes">checked</option><option value="no">unchecked</option>
      </select>
    case 'select': case 'status': case 'multiSelect': {
      const picked = new Set(Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [])
      return <div className="database-rule-options">{(property.options ?? []).map(o => <label key={o.id}>
        <input type="checkbox" checked={picked.has(o.id)} onChange={e => { const next = new Set(picked); if (e.target.checked) next.add(o.id); else next.delete(o.id); onChange(next.size ? [...next] : undefined) }} />{o.name}
      </label>)}</div>
    }
    case 'date': {
      if (op === 'within') return <select aria-label="Value" value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value || undefined)}>
        <option value="">Choose…</option><option value="thisWeek">this week</option><option value="past7">the past 7 days</option><option value="next7">the next 7 days</option>
      </select>
      const ref = value && typeof value === 'object' && !Array.isArray(value) ? value : null
      const kind = ref && 'relative' in ref ? String(ref.relative) : ref && 'date' in ref ? 'date' : ''
      return <span className="database-rule-date">
        <select aria-label="Day" value={kind} onChange={e => onChange(e.target.value === 'today' || e.target.value === 'pageDate' ? { relative: e.target.value } : e.target.value === 'date' ? { date: new Date().toLocaleDateString('en-CA') } : undefined)}>
          <option value="">Choose…</option><option value="today">today</option><option value="pageDate">this page's day</option><option value="date">a date</option>
        </select>
        {kind === 'date' && <input type="date" aria-label="Date" value={String((ref as { date?: string }).date ?? '')} onChange={e => onChange(e.target.value ? { date: e.target.value } : undefined)} />}
      </span>
    }
  }
}

/** A text field that saves on Enter or when it loses focus, never per key: one change, one Undo. */
function CommitInput({ initial, onCommit, inputMode, placeholder, ariaLabel = 'Value', autoFocus }: { initial: string; onCommit: (v: string) => void; inputMode?: 'decimal'; placeholder?: string; ariaLabel?: string; autoFocus?: boolean }) {
  const [v, setV] = useState(initial)
  const commit = () => { if (v !== initial) onCommit(v) }
  return <input aria-label={ariaLabel} value={v} inputMode={inputMode} placeholder={placeholder} autoFocus={autoFocus} onChange={e => setV(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); commit() } }} />
}

// ---------------------------------------------------------------- sort

function SortPanel({ db, view, back }: { db: DatabasePage; view: View; back: () => void }) {
  const change = useChange(db)
  const save = (sort: Sort[]) => change({ kind: 'updateView', viewId: view.id, sort })
  const move = (i: number, by: number) => { const next = [...view.sort]; const [s] = next.splice(i, 1); next.splice(i + by, 0, s!); save(next) }
  const unused = columnsOf(db.database).find(p => !view.sort.some(s => s.by === p.id))
  return <>
    <Head title="Sort" back={back} />
    {view.sort.length === 0 && <p className="database-menu-quiet">No sorts</p>}
    {view.sort.map((s, i) => <div key={s.by} className="database-rule">
      <select aria-label="Property" value={s.by} onChange={e => save(view.sort.map((x, j) => (j === i ? { ...x, by: e.target.value } : x)))}>
        {columnsOf(db.database).filter(p => p.id === s.by || !view.sort.some(x => x.by === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        {!propertyOf(db.database, s.by) && <option value={s.by}>(deleted)</option>}
      </select>
      <select aria-label="Direction" value={s.direction} onChange={e => save(view.sort.map((x, j) => (j === i ? { ...x, direction: e.target.value as Sort['direction'] } : x)))}>
        <option value="asc">Ascending</option><option value="desc">Descending</option>
      </select>
      {i > 0 && <button type="button" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>}
      <button type="button" className="database-rule-remove" aria-label="Remove sort" onClick={() => save(view.sort.filter((_, j) => j !== i))}>×</button>
    </div>)}
    {unused && <button type="button" role="menuitem" onClick={() => save([...view.sort, { by: unused.id, direction: 'asc' }])}>+ Add sort</button>}
  </>
}

// ---------------------------------------------------------------- properties (design §7.5, §6.2)

function PropertiesPanel({ db, view, go }: { db: DatabasePage; view: View; go: (p: Panel) => void }) {
  const change = useChange(db)
  const shown = new Set(view.columns.map(c => c.id))
  // Shown ones in the view's order, then the hidden ones in the database's order.
  const ordered = [...view.columns.map(c => db.database.properties.find(p => p.id === c.id)).filter((p): p is Property => Boolean(p)), ...db.database.properties.filter(p => !shown.has(p.id))]
  const setColumns = (columns: View['columns']) => change({ kind: 'updateView', viewId: view.id, columns })
  const toggle = (p: Property) => setColumns(shown.has(p.id) ? view.columns.filter(c => c.id !== p.id) : [...view.columns, { id: p.id }])
  // Left and right, one place at a time (R1-14); dragging comes later.
  const shift = (p: Property, by: -1 | 1) => { const i = view.columns.findIndex(c => c.id === p.id), j = i + by; if (i < 0 || j < 0 || j >= view.columns.length) return; const next = [...view.columns]; [next[i], next[j]] = [next[j]!, next[i]!]; setColumns(next) }
  return <>
    <Head title="Properties" back={() => go('root')} />
    <div className="database-property-line is-title"><span>Name</span><span className="database-menu-quiet">always shown</span></div>
    {ordered.map(p => <div key={p.id} className="database-property-line">
      <label className="database-property-switch"><input type="checkbox" checked={shown.has(p.id)} onChange={() => toggle(p)} aria-label={`Show ${p.name}`} /></label>
      <button type="button" className="database-property-name" onClick={() => go({ property: p.id })}>{p.name}<span className="database-menu-quiet"> · {typeLabels[p.type]}</span></button>
      {shown.has(p.id) && view.columns[0]?.id !== p.id && <button type="button" aria-label={`Move ${p.name} left`} onClick={() => shift(p, -1)}>↑</button>}
      {shown.has(p.id) && view.columns.at(-1)?.id !== p.id && <button type="button" aria-label={`Move ${p.name} right`} onClick={() => shift(p, 1)}>↓</button>}
    </div>)}
    <button type="button" role="menuitem" onClick={() => go('new-property')}>+ Add property</button>
  </>
}

/** Add (design §6.2): a name, then a type; Enter makes a Text property. */
function NewPropertyPanel({ db, view, go }: { db: DatabasePage; view: View; go: (p: Panel) => void }) {
  const change = useChange(db)
  const [name, setName] = useState('')
  const make = (type: PropertyType) => {
    const id = newId()
    change({ kind: 'addProperty', property: { id, name: name.trim() || typeLabels[type], type }, viewId: view.id })
    go({ property: id })
  }
  return <>
    <Head title="New property" back={() => go('properties')} />
    <input className="database-menu-field" aria-label="Property name" placeholder="Name" autoFocus value={name} onChange={e => setName(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); make('text') } }} />
    {propertyTypes.map(t => <button key={t} type="button" role="menuitem" onClick={() => make(t)}>{typeLabels[t]}</button>)}
  </>
}

function PropertyPanel({ db, view, propertyId, go }: { db: DatabasePage; view: View; propertyId: string; go: (p: Panel) => void }) {
  const change = useChange(db)
  const property = db.database.properties.find(p => p.id === propertyId)
  if (!property) return <><Head title="Property" back={() => go('properties')} /><p className="database-menu-quiet">Deleted</p></>
  const update = (fields: Omit<Extract<DatabaseChange, { kind: 'updateProperty' }>, 'kind' | 'propertyId'>, withUndo = false) => change({ kind: 'updateProperty', propertyId, ...fields }, withUndo)
  const hasOptions = property.type === 'select' || property.type === 'multiSelect' || property.type === 'status'
  const options = property.options ?? []
  const shown = view.columns.some(c => c.id === propertyId)
  return <>
    <Head title={property.name} back={() => go('properties')} />
    <CommitInput key={property.name} ariaLabel="Name" initial={property.name} onCommit={v => { if (v.trim()) update({ name: v.trim() }) }} />
    <label className="database-menu-row">Type
      {/* Changing the type converts what it can and says how many it couldn't, with Undo (design §6.2). */}
      <select value={property.type} onChange={e => update({ type: e.target.value as PropertyType }, true)}>
        {propertyTypes.map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
      </select>
    </label>
    {property.type === 'number' && <label className="database-menu-row">Format
      <select value={property.format ?? 'plain'} onChange={e => update({ format: e.target.value as Property['format'] })}>
        <option value="plain">Number</option><option value="comma">1,000</option><option value="percent">Percent</option><option value="currency">Currency</option>
      </select>
    </label>}
    {property.type === 'date' && <label className="database-menu-row">Include time
      <input type="checkbox" checked={Boolean(property.withTime)} onChange={e => update({ withTime: e.target.checked })} />
    </label>}
    {hasOptions && <div className="database-options">
      {options.map((o, i) => <div key={o.id} className="database-option-line">
        {property.type === 'status' && <select aria-label="Group" value={o.group ?? 'todo'} onChange={e => update({ options: options.map(x => (x.id === o.id ? { ...x, group: e.target.value as 'todo' } : x)) })}>
          <option value="todo">To do</option><option value="active">In progress</option><option value="done">Done</option>
        </select>}
        <CommitInput key={o.name} ariaLabel="Option name" initial={o.name} onCommit={v => { if (v.trim()) update({ options: options.map(x => (x.id === o.id ? { ...x, name: v.trim() } : x)) }) }} />
        {i > 0 && <button type="button" aria-label="Move up" onClick={() => { const next = [...options]; [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; update({ options: next }) }}>↑</button>}
        <button type="button" className="database-rule-remove" aria-label={`Delete ${o.name}`} onClick={() => update({ options: options.filter(x => x.id !== o.id) }, true)}>×</button>
      </div>)}
      <CommitInput key={options.length} ariaLabel="New option" initial="" placeholder="Add an option" onCommit={v => { if (v.trim()) update({ options: [...options, { id: newId(), name: v.trim(), ...(property.type === 'status' ? { group: 'todo' as const } : {}) }] }) }} />
    </div>}
    <hr />
    <button type="button" role="menuitem" onClick={() => change({ kind: 'updateView', viewId: view.id, columns: shown ? view.columns.filter(c => c.id !== propertyId) : [...view.columns, { id: propertyId }] })}>{shown ? 'Hide in this view' : 'Show in this view'}</button>
    <button type="button" role="menuitem" className="is-danger" onClick={() => { change({ kind: 'removeProperty', propertyId }, true); go('properties') }}>Delete property</button>
  </>
}


// ---------------------------------------------------------------- views (design §7.1)

/** Every view, the current one ticked, each with Rename, Duplicate and Delete (none on the last); + Add view. */
function ViewsPanel({ db, blockId }: { db: DatabasePage; blockId: string }) {
  const change = useChange(db)
  const current = shownView(db.database, blockId)
  const [actions, setActions] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const views = db.database.views
  const pick = (id: string) => { setShownView(blockId, id); setOpenMenu(null) }
  const add = (from?: View) => {
    const id = newId()
    // A new view is a Table named after its type, with the name ready to rename (design §7.1); Duplicate copies one.
    const view: View = from ? { ...structuredClone(from), id, name: `${from.name} (copy)` } : { id, name: 'Table', layout: 'table', columns: current.columns, sort: [], filter: [] }
    change({ kind: 'addView', view })
    setShownView(blockId, id)
    setActions(null); setRenaming(id)
  }
  return <>
    <Head title="Views" />
    {views.map(v => <div key={v.id} className="database-view-line">
      {renaming === v.id
        ? <CommitInput key={v.name} ariaLabel="View name" initial={v.name} autoFocus onCommit={name => { if (name.trim()) change({ kind: 'updateView', viewId: v.id, name: name.trim() }); setRenaming(null) }} />
        : <button type="button" role="menuitemradio" aria-checked={v.id === current.id} className="database-view-pick" onClick={() => pick(v.id)}>{v.id === current.id ? '✓ ' : ''}{v.name}</button>}
      <button type="button" className="database-view-more" aria-label={`${v.name} options`} onClick={() => setActions(actions === v.id ? null : v.id)}>⋯</button>
      {actions === v.id && <div className="database-view-actions">
        <button type="button" role="menuitem" onClick={() => { setActions(null); setRenaming(v.id) }}>Rename</button>
        <button type="button" role="menuitem" onClick={() => add(v)}>Duplicate</button>
        {views.length > 1 && <button type="button" role="menuitem" className="is-danger" onClick={() => { setActions(null); change({ kind: 'removeView', viewId: v.id }, true) }}>Delete</button>}
      </div>}
    </div>)}
    <hr />
    <button type="button" role="menuitem" onClick={() => add()}>+ Add view</button>
  </>
}
