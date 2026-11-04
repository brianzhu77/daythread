// Databases R1: the `⋯` menu of a table (design §8) with its Filter and Sort sheets (§7.3), Properties (§7.5) and a
// property's own menu (§6.2). Like the cell editors it lives outside the page editor's block (one host in the app
// shell), so a redraw of the block never closes it; only which menu is open is shared.
import { useNavigate } from '@tanstack/react-router'
import { useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { calcChoices, canWrap, calcLabels, databaseRows, dateProperties, groupableProperties, isDatabase, isTimeType, viewDateBy, propertyOf, titleId, typeLabels, propertyTypes, viewSubGroupBy, viewSubGroups, viewBoardCalculation, viewCalculations, viewColumns, viewGroupBy, viewGroups, type CalcKind, type Condition, type GroupDateBy, type Database, type DatabaseChange, type FilterOp, type Json, type Property, type Rollup, type RollupFunction, type PropertyType, type Sort, type View } from '../domain/database.ts'
import { defaultRowTemplate, rowTemplates } from '../domain/day-template'
import type { Page, Workspace } from '../domain/types'
import { databaseSource, readingWorkspace, todosSourceId, todosTitle } from '../domain/todos-source'
import { isFormula } from '../domain/formula'
import { rollupFunctionsFor, withLinks } from '../domain/relations'
import { FormulaEditor } from './formula-editor'
import { startPicking, blockActions, isLinkedBlock, MenuBlock, setShownView, shownView, useShownViews, useViewChange } from './database-block'
import { exportDatabase } from './database-export'
import { todayIso } from './dates'
import { flushAllEditors } from './editor-flush'
import { ChevronDownIcon } from './icons'
import { useKeyboardTop } from './keyboard'
import { useSaveOnHide, useWide } from './property-editors'
import { useWorkspace } from './use-day'

type Panel = 'root' | 'filter' | 'sort' | 'group' | 'layout' | 'calculate' | 'properties' | { property: string } | { formula: string } | 'export' | 'new-property' | 'views' | 'templates' | { template: string }
interface OpenMenu { blockId: string; databaseId: string; panel: Panel; /** From `+ New ⌄`: a pick makes the row, in its place. */ pick?: (template: string | null) => void }
/** The views list opens under "Table ⌄" on the left; every other panel under the `⋯` on the right. */
const anchorOf = (m: OpenMenu) => m.panel === 'views' ? `[data-database-views="${CSS.escape(m.blockId)}"]` : `[data-database-menu="${CSS.escape(m.blockId)}"]`
let openMenu: OpenMenu | null = null
const listeners = new Set<() => void>()
function setOpenMenu(next: OpenMenu | null) { openMenu = next; for (const l of listeners) l() }
function useOpenMenu() { return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => openMenu, () => null) }
const newId = (): string => crypto.randomUUID()

/** Opens a table's menu on one of its panels (a filter chip opens Filter). */
export function openDatabaseMenu(blockId: string, databaseId: string, panel: 'filter' | 'sort' | 'group' | 'layout' | 'calculate' | 'templates' = 'filter', pick?: (template: string | null) => void) { setOpenMenu({ blockId, databaseId, panel, ...(pick ? { pick } : {}) }) }

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
      // Under its button, moved up only as far as it takes to stay on screen: a table low on the page would leave it cut off.
      const top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - (ref.current?.offsetHeight ?? 0) - 8))
      // Moved left as far as it takes too, for the same reason: "Table ⌄" sits near the page's right edge.
      // Formula's editor is too wide to hang left from `⋯` without covering the sidebar, so it starts at the block's edge.
      const width = ref.current?.offsetWidth ?? 300, block = anchor.closest('.database-block')?.getBoundingClientRect()
      const next = width > 320 && block && window.innerWidth >= 900 ? { top, left: Math.max(8, Math.min(block.left, window.innerWidth - width - 8)) } : open.panel === 'views' ? { top, left: Math.max(8, Math.min(r.left, window.innerWidth - (ref.current?.offsetWidth ?? 300) - 8)) } : { top, right: Math.max(8, Math.min(window.innerWidth - r.right, window.innerWidth - (ref.current?.offsetWidth ?? 300) - 8)) }
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
  // A phone's sheet sits at the bottom of the screen, so a keyboard left up by the database title or the page's text
  // hides it completely (Jazz's native run on 930e18b2). Leaving the field also saves it.
  const wide = useWide()
  const keyboardTop = useKeyboardTop()
  const opened = Boolean(open)
  useEffect(() => {
    if (!opened || wide) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement) focused.blur()
    window.getSelection()?.removeAllRanges()
  }, [opened, wide])
  useShownViews()
  const db = open && workspace ? databaseSource(workspace, open.databaseId) : undefined
  if (!open || !at || !isDatabase(db) || db.trashedAt) return null
  const view = shownView(db.database, open.blockId)
  const go = (panel: Panel) => setOpenMenu({ ...open, panel })
  // The phone's dimmed page behind the sheet (CSS hides it at ≥ 900 px): a tap there only closes the menu, and never
  // reaches the page under it (Jazz's native run: it put a caret there).
  return <>
    <div className="database-menu-scrim" aria-hidden="true" onClick={() => setOpenMenu(null)} />
    <div ref={ref} className="app-menu database-menu" role="dialog" aria-label="Database options" style={{ position: 'fixed', top: at.top, ...(at.left !== undefined ? { left: at.left } : { right: at.right }), ...(keyboardTop === null ? {} : { '--keyboard-lift': `${window.innerHeight - keyboardTop}px` } as CSSProperties) }}
    onKeyDown={e => e.stopPropagation()}>
    <MenuBlock.Provider value={open.blockId}>
    {open.panel === 'views' && <ViewsPanel db={db} blockId={open.blockId} />}
    {open.panel === 'root' && <RootPanel db={db} view={view} blockId={open.blockId} go={go} />}
    {open.panel === 'group' && <GroupPanel db={db} view={view} back={() => go('root')} />}
    {open.panel === 'layout' && <LayoutPanel db={db} view={view} back={() => go('root')} />}
    {open.panel === 'templates' && <TemplatesPanel db={db} view={view} go={go} close={() => setOpenMenu(null)} {...(open.pick ? { pick: open.pick } : {})} />}
    {typeof open.panel === 'object' && 'template' in open.panel && <TemplatePanel db={db} view={view} templateId={open.panel.template} go={go} close={() => setOpenMenu(null)} />}
    {open.panel === 'calculate' && <CalculatePanel db={db} view={view} back={() => go('root')} />}
    {open.panel === 'filter' && <FilterPanel db={db} view={view} back={() => go('root')} />}
    {open.panel === 'sort' && <SortPanel db={db} view={view} back={() => go('root')} />}
    {open.panel === 'export' && <ExportPanel db={db} view={view} blockId={open.blockId} back={() => go('root')} close={() => setOpenMenu(null)} />}
    {open.panel === 'properties' && <PropertiesPanel db={db} view={view} go={go} />}
    {open.panel === 'new-property' && <NewPropertyPanel db={db} view={view} go={go} />}
    {typeof open.panel === 'object' && 'property' in open.panel && <PropertyPanel db={db} view={view} propertyId={open.panel.property} go={go} />}
    {typeof open.panel === 'object' && 'formula' in open.panel && <FormulaPanel db={db} propertyId={open.panel.formula} go={go} />}
    </MenuBlock.Provider>
  </div>
  </>
}

type DatabasePage = Page & { database: Database }

function useChange(db: DatabasePage) {
  const { run } = useWorkspace()
  // Built from the latest database, inside the queue: two quick changes each build on the one before (Lead's review, 7).
  return (change: DatabaseChange | ((current: Database) => DatabaseChange), withUndo = false) => void run(ws => {
    const now = ws.pages.find(p => p.id === db.id)
    return isDatabase(now) ? { type: 'change-database', pageId: db.id, change: typeof change === 'function' ? change(now.database) : change } : null
  }, withUndo ? r => ({ text: r.message, undoOperationId: r.operationId }) : null)
}

/** The type he chose, where it reads as the type it works out to. */
const kindOf = (p: Property): PropertyType => (p.rollup ? 'rollup' : isFormula(p) ? 'formula' : p.type)

function Head({ title, back }: { title: string; back?: () => void }) {
  return <div className="database-menu-head">{back && <button type="button" className="database-menu-back" aria-label="Back" onClick={back}>‹</button>}<span>{title}</span></div>
}

function RootPanel({ db, view, blockId, go }: { db: DatabasePage; view: View; blockId: string; go: (p: Panel) => void }) {
  const { run } = useWorkspace()
  const navigate = useNavigate()
  const inline = !blockId.startsWith('page:') && db.database.homeBlockId === blockId
  const linked = isLinkedBlock(blockId)
  const actions = blockActions.get(blockId)
  const wide = useWide()
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
      {view.layout !== 'calendar' && <button type="button" onClick={() => go('group')}>Group</button>}
    </div>
    <button type="button" role="menuitem" onClick={() => go('properties')}>Properties<span className="database-menu-chevron">›</span></button>
    <button type="button" role="menuitem" onClick={() => go('layout')}>Layout<span className="database-menu-chevron">{layoutLabels[view.layout]} ›</span></button>
    {view.layout === 'table' && !wide && !db.database.fixed && <button type="button" role="menuitem" onClick={() => { close(); startPicking(blockId) }}>Select rows</button>}
    {(view.layout === 'table' || view.layout === 'board') && <button type="button" role="menuitem" onClick={() => go('calculate')}>Calculate<span className="database-menu-chevron">›</span></button>}
    {!db.database.fixed && <button type="button" role="menuitem" onClick={() => go('templates')}>Templates<span className="database-menu-chevron">›</span></button>}
    <hr />
    {(inline || linked) && !db.database.fixed && <button type="button" role="menuitem" onClick={() => { close(); void navigate({ to: '/pages', search: { page: db.id } }) }}>Open as page</button>}
    {(inline || linked) && actions && <button type="button" role="menuitem" onClick={() => { close(); actions.duplicate(blockId) }}>Duplicate</button>}
    {inline && actions && <button type="button" role="menuitem" onClick={() => { close(); actions.turnIntoPage(blockId, db.id) }}>Turn into page</button>}
    {!db.database.fixed && <button type="button" role="menuitem" onClick={copyLink}>Copy link</button>}
    <button type="button" role="menuitem" onClick={() => go('export')}>Export<span className="database-menu-chevron">›</span></button>
    <hr />
    {linked
      ? <button type="button" role="menuitem" className="is-danger" onClick={() => { close(); actions?.remove(blockId) }}>Remove this view</button>
      : <button type="button" role="menuitem" className="is-danger" onClick={remove}>Delete database</button>}
  </>
}

// ---------------------------------------------------------------- export (csv design §2)

function ExportPanel({ db, view, blockId, back, close }: { db: DatabasePage; view: View; blockId: string; back: () => void; close: () => void }) {
  const { workspace } = useWorkspace()
  const [withBodies, setWithBodies] = useState(false)
  const [state, setState] = useState<'idle' | 'busy' | 'unsaved' | 'failed'>('idle')
  const take = async (whole: boolean) => {
    if (!workspace || state === 'busy') return
    setState('busy')
    try {
      // A body he just typed is part of it: open editors save first, as the whole export's do.
      if (withBodies && !(await flushAllEditors())) { setState('unsaved'); return }
      const hostPage = blockActions.get(blockId)?.hostPageId
      const context = { today: todayIso(), pageDate: workspace.pages.find(p => p.id === hostPage)?.date ?? null, weekStart: workspace.weekStart ?? 0 }
      const title = db.title.trim() || 'Untitled'
      await exportDatabase(readingWorkspace(workspace, db.id), db, whole ? 'whole' : { view, context }, withBodies, whole ? title : `${title} - ${view.name}`)
      close()
    } catch { setState('failed') }
  }
  return <>
    <Head title="Export" back={back} />
    <button type="button" role="menuitem" disabled={state === 'busy'} onClick={() => void take(false)}>This view</button>
    <button type="button" role="menuitem" disabled={state === 'busy'} onClick={() => void take(true)}>Whole database</button>
    {!db.database.fixed && <label className="database-menu-row">Include page bodies
      <input type="checkbox" checked={withBodies} onChange={e => setWithBodies(e.target.checked)} />
    </label>}
    {state === 'unsaved' && <p className="database-menu-quiet is-error" role="status">No file came: a page hasn't saved yet. Try again in a moment.</p>}
    {state === 'failed' && <p className="database-menu-quiet is-error" role="status">No file came. Try again.</p>}
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
    case 'text': case 'url': case 'email': case 'phone': return ['contains', 'is', 'isEmpty', 'isNotEmpty']
    case 'number': return ['eq', 'ne', 'gt', 'lt', 'isEmpty']
    case 'id': return ['eq', 'ne', 'gt', 'lt']
    case 'createdTime': case 'editedTime': return ['is', 'before', 'after', 'within']
    case 'select': case 'status': return ['isAnyOf', 'isNoneOf', 'isEmpty']
    case 'relation': case 'multiSelect': return ['contains', 'doesNotContain', 'isEmpty']
    // Read as the type it works out to (relations.ts), so it never gets here.
    case 'rollup':
    case 'formula': return []
    case 'date': return ['is', 'before', 'after', 'within', 'isEmpty']
    case 'checkbox': return ['is']
  }
}
const titleProperty: Property = { id: titleId, name: 'Name', type: 'text' }
function columnsOf(db: Database): Property[] { return [titleProperty, ...db.properties] }

function FilterPanel({ db, view, back }: { db: DatabasePage; view: View; back: () => void }) {
  const changeView = useViewChange(db.id, view.id)
  const save = (build: (filter: Condition[]) => Condition[]) => changeView(current => ({ filter: build(current.filter) }))
  const set = (i: number, next: Condition) => save(filter => filter.map((c, j) => (j === i ? next : c)))
  const add = () => save(filter => [...filter, { by: titleId, op: 'contains' }])
  return <>
    <Head title="Filter" back={back} />
    {view.filter.length === 0 && <p className="database-menu-quiet">No filters</p>}
    {view.filter.length > 1 && <label className="database-menu-row">Show rows where
      <select aria-label="Show rows where" value={view.filterAny ? 'any' : 'all'} onChange={e => { const filterAny = e.target.value === 'any'; changeView(() => ({ filterAny })) }}>
        <option value="all">all rules match</option><option value="any">any rule matches</option>
      </select>
    </label>}
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
        <button type="button" className="database-rule-remove" aria-label="Remove filter" onClick={() => save(filter => filter.filter((_, j) => j !== i))}>×</button>
      </div>
    })}
    <button type="button" role="menuitem" onClick={add}>+ Add filter</button>
  </>
}

function RuleValue({ property, condition, onChange }: { property: Property; condition: Condition; onChange: (value: Json | undefined) => void }) {
  const { op, value } = condition
  if (op === 'isEmpty' || op === 'isNotEmpty') return null
  switch (property.type) {
    case 'text': case 'url': case 'email': case 'phone':
      return <CommitInput key={String(value ?? '')} initial={typeof value === 'string' ? value : ''} onCommit={v => onChange(v || undefined)} />
    case 'number': case 'id':
      // An ID can be typed as it shows, "BK-12": the prefix isn't part of its number.
      return <CommitInput key={String(value ?? '')} initial={typeof value === 'number' ? String(value) : ''} inputMode={property.prefix ? undefined : 'decimal'} onCommit={v => { const n = Number((property.prefix && v.trim().startsWith(property.prefix) ? v.trim().slice(property.prefix.length) : v).replace(/,/g, '')); onChange(v.trim() && Number.isFinite(n) ? n : undefined) }} />
    case 'checkbox':
      return <select aria-label="Value" value={value === false ? 'no' : 'yes'} onChange={e => onChange(e.target.value === 'yes')}>
        <option value="yes">checked</option><option value="no">unchecked</option>
      </select>
    case 'select': case 'status': case 'multiSelect': case 'relation': {
      const picked = new Set(Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [])
      return <div className="database-rule-options">{(property.options ?? []).map(o => <label key={o.id}>
        <input type="checkbox" checked={picked.has(o.id)} onChange={e => { const next = new Set(picked); if (e.target.checked) next.add(o.id); else next.delete(o.id); onChange(next.size ? [...next] : undefined) }} />{o.name}
      </label>)}</div>
    }
    case 'date': case 'createdTime': case 'editedTime': {
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
  // What it last sent, not `initial`: a hide and then a blur can both land before the reply, and a second "Add an option"
  // with the same name would be refused.
  const sent = useRef(initial)
  const commit = () => { if (v !== sent.current) { sent.current = v; onCommit(v) } }
  useSaveOnHide(commit)
  return <input aria-label={ariaLabel} value={v} inputMode={inputMode} placeholder={placeholder} autoFocus={autoFocus} onFocus={e => { if (autoFocus) e.currentTarget.select() }} onChange={e => setV(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); commit() } }} />
}

// ---------------------------------------------------------------- sort

function SortPanel({ db, view, back }: { db: DatabasePage; view: View; back: () => void }) {
  const changeView = useViewChange(db.id, view.id)
  const save = (build: (sort: Sort[]) => Sort[]) => changeView(current => ({ sort: build(current.sort) }))
  const move = (i: number, by: number) => save(sort => { const next = [...sort]; const [s] = next.splice(i, 1); next.splice(i + by, 0, s!); return next })
  const unused = columnsOf(db.database).find(p => !view.sort.some(s => s.by === p.id))
  return <>
    <Head title="Sort" back={back} />
    {view.sort.length === 0 && <p className="database-menu-quiet">No sorts</p>}
    {view.sort.map((s, i) => <div key={s.by} className="database-rule">
      <select aria-label="Property" value={s.by} onChange={e => { const by = e.target.value; save(sort => sort.map((x, j) => (j === i ? { ...x, by } : x))) }}>
        {columnsOf(db.database).filter(p => p.id === s.by || !view.sort.some(x => x.by === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        {!propertyOf(db.database, s.by) && <option value={s.by}>(deleted)</option>}
      </select>
      <select aria-label="Direction" value={s.direction} onChange={e => { const direction = e.target.value as Sort['direction']; save(sort => sort.map((x, j) => (j === i ? { ...x, direction } : x))) }}>
        <option value="asc">Ascending</option><option value="desc">Descending</option>
      </select>
      {i > 0 && <button type="button" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>}
      <button type="button" className="database-rule-remove" aria-label="Remove sort" onClick={() => save(sort => sort.filter((_, j) => j !== i))}>×</button>
    </div>)}
    {unused && <button type="button" role="menuitem" onClick={() => save(sort => [...sort, { by: unused.id, direction: 'asc' }])}>+ Add sort</button>}
  </>
}

// ---------------------------------------------------------------- group and layout (design §7.2, §7.3)

const layoutLabels: Record<View['layout'], string> = { table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery', calendar: 'Calendar' }
/** "Status", "Status 2", …: never a name the database already has. */
function newPropertyName(db: Database, base: string): string {
  const taken = new Set(['name', ...db.properties.map(p => p.name.toLocaleLowerCase())])
  for (let n = 1; ; n++) { const name = n === 1 ? base : `${base} ${n}`; if (!taken.has(name.toLocaleLowerCase())) return name }
}
/** A board's columns need a Select, Status or Checkbox: asked when one is made (§7.2), or a new Status, when he has none or wants one. */
function BoardGroupChoices({ db, onPick }: { db: DatabasePage; onPick: (propertyId: string) => void }) {
  const change = useChange(db)
  const addStatus = () => {
    const id = newId()
    change(current => ({ kind: 'addProperty', property: { id, name: newPropertyName(current, 'Status'), type: 'status' } }))
    onPick(id)
  }
  return <>
    <p className="database-menu-quiet">Columns come from</p>
    {groupableProperties(db.database, 'board').map(p => <button key={p.id} type="button" role="menuitem" onClick={() => onPick(p.id)}>{p.name}<span className="database-menu-quiet">{typeLabels[p.type]}</span></button>)}
    <button type="button" role="menuitem" onClick={addStatus}>+ New Status property</button>
  </>
}

/** A calendar's rows sit by a date property: asked when one is made (R3-1), as a board asks for its columns. */
function CalendarDateChoices({ db, onPick }: { db: DatabasePage; onPick: (propertyId: string) => void }) {
  const change = useChange(db)
  const addDate = () => {
    const id = newId()
    change(current => ({ kind: 'addProperty', property: { id, name: newPropertyName(current, 'Date'), type: 'date' } }))
    onPick(id)
  }
  return <>
    <p className="database-menu-quiet">Show calendar by</p>
    {dateProperties(db.database).map(p => <button key={p.id} type="button" role="menuitem" onClick={() => onPick(p.id)}>{p.name}</button>)}
    <button type="button" role="menuitem" onClick={addDate}>+ New Date property</button>
  </>
}

function GroupPanel({ db, view, back }: { db: DatabasePage; view: View; back: () => void }) {
  const { workspace } = useWorkspace()
  const changeView = useViewChange(db.id, view.id)
  const property = viewGroupBy(db.database, view)
  if (view.layout === 'board' && !property) return <><Head title="Group" back={back} /><BoardGroupChoices db={db} onPick={groupBy => changeView(() => ({ groupBy }))} /></>
  const choices = groupableProperties(db.database, view.layout)
  // Every group, listed whatever's hidden now, so a hidden one can come back from here too.
  const all = property && workspace ? viewGroups(db.database, { ...view, hideEmptyGroups: false, hiddenGroups: [] }, databaseRows(workspace, db.id), undefined, workspace.weekStart)!.shown : []
  const hidden = new Set(view.hiddenGroups ?? [])
  const subProperty = viewSubGroupBy(db.database, view)
  const subChoices = groupableProperties(db.database, 'table').filter(p => p.id !== property?.id)
  const allSubs = subProperty && workspace ? viewSubGroups(db.database, { ...view, hideEmptyGroups: false, hiddenSubGroups: [] }, databaseRows(workspace, db.id), undefined, workspace.weekStart)!.shown : []
  const hiddenSubs = new Set(view.hiddenSubGroups ?? [])
  return <>
    <Head title="Group" back={back} />
    <label className="database-menu-row">Group by
      <select value={property?.id ?? ''} onChange={e => { const groupBy = e.target.value || null; changeView(() => ({ groupBy, hiddenGroups: [] })) }}>
        {view.layout !== 'board' && <option value="">None</option>}
        {choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    {!choices.length && <p className="database-menu-quiet">No properties to group by yet</p>}
    {property && (property.type === 'date' || isTimeType(property.type)) && <label className="database-menu-row">By
      <select aria-label="By" value={view.groupDateBy ?? 'month'} onChange={e => { const groupDateBy = e.target.value as GroupDateBy; changeView(() => ({ groupDateBy, hiddenGroups: [] })) }}>
        <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
      </select>
    </label>}
    {property && <label className="database-menu-row">Sub-group
      <select aria-label="Sub-group" value={subProperty?.id ?? ''} onChange={e => { const subGroupBy = e.target.value || null; changeView(() => ({ subGroupBy, hiddenSubGroups: [] })) }}>
        <option value="">None</option>
        {subChoices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>}
    {subProperty && (subProperty.type === 'date' || isTimeType(subProperty.type)) && <label className="database-menu-row">By
      <select aria-label="Sub-group date step" value={view.subGroupDateBy ?? 'month'} onChange={e => { const subGroupDateBy = e.target.value as GroupDateBy; changeView(() => ({ subGroupDateBy, hiddenSubGroups: [] })) }}>
        <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
      </select>
    </label>}
    {property && <>
      <label className="database-menu-row">Hide empty groups
        <input type="checkbox" checked={Boolean(view.hideEmptyGroups)} onChange={e => { const hideEmptyGroups = e.target.checked; changeView(() => ({ hideEmptyGroups })) }} />
      </label>
      <hr />
      <div className="database-group-list">
        {all.map(g => <label key={g.key} className="database-menu-row">{g.name}
          <input type="checkbox" aria-label={`Show ${g.name}`} checked={!hidden.has(g.key)} onChange={e => { const show = e.target.checked; changeView(current => ({ hiddenGroups: show ? (current.hiddenGroups ?? []).filter(k => k !== g.key) : [...(current.hiddenGroups ?? []), g.key] })) }} />
        </label>)}
      </div>
      {allSubs.length > 0 && <><hr /><div className="database-group-list">
        {allSubs.map(g => <label key={g.key} className="database-menu-row">{g.name}
          <input type="checkbox" aria-label={`Show ${g.name}`} checked={!hiddenSubs.has(g.key)} onChange={e => { const show = e.target.checked; changeView(current => ({ hiddenSubGroups: show ? (current.hiddenSubGroups ?? []).filter(k => k !== g.key) : [...(current.hiddenSubGroups ?? []), g.key] })) }} />
        </label>)}
      </div></>}
    </>}
  </>
}

/** A view named after its type keeps following it; one he named keeps his name. */
const renamedFor = (view: View, layout: View['layout']) => (view.name === layoutLabels[view.layout] ? { name: layoutLabels[layout] } : {})
function LayoutPanel({ db, view, back }: { db: DatabasePage; view: View; back: () => void }) {
  const wrapsAll = view.columns.some(c => c.wrap) && viewColumns(db.database, view).every(c => c.wrap || !canWrap(c.property.type)) && (view.layout !== 'table' || Boolean(view.wrapName))
  const changeView = useViewChange(db.id, view.id)
  const [asking, setAsking] = useState(false)
  const [askingDate, setAskingDate] = useState(false)
  const toCalendar = (dateBy: string) => { setAskingDate(false); changeView(current => ({ layout: 'calendar', dateBy, ...renamedFor(current, 'calendar') })) }
  const toBoard = (groupBy: string) => { setAsking(false); changeView(current => ({ layout: 'board', groupBy, ...renamedFor(current, 'board') })) }
  const pick = (layout: View['layout']) => {
    if (layout === view.layout) return
    if (layout === 'calendar') {
      const kept = viewDateBy(db.database, view), only = dateProperties(db.database)
      if (kept) toCalendar(kept.id); else if (only.length === 1) toCalendar(only[0]!.id); else setAskingDate(true)
      return
    }
    if (layout !== 'board') { changeView(current => ({ layout, ...renamedFor(current, layout) })); return }
    // Grouped already by what a board can use: those are its columns.
    const kept = viewGroupBy(db.database, { ...view, layout: 'board' })
    const only = groupableProperties(db.database, 'board')
    if (kept) toBoard(kept.id); else if (only.length === 1) toBoard(only[0]!.id); else setAsking(true)
  }
  if (asking) return <><Head title="Board" back={() => setAsking(false)} /><BoardGroupChoices db={db} onPick={toBoard} /></>
  if (askingDate) return <><Head title="Calendar" back={() => setAskingDate(false)} /><CalendarDateChoices db={db} onPick={toCalendar} /></>
  return <>
    <Head title="Layout" back={back} />
    {(['table', 'board', 'list', 'gallery', 'calendar'] as const).map(layout => <button key={layout} type="button" role="menuitemradio" aria-checked={view.layout === layout} onClick={() => pick(layout)}>{layoutLabels[layout]}{view.layout === layout && <span aria-hidden="true">✓</span>}</button>)}
    {(view.layout === 'table' || view.layout === 'board' || view.layout === 'gallery') && <label className="database-menu-row">Wrap all
      <input type="checkbox" checked={wrapsAll} onChange={e => { const on = e.target.checked; changeView(({ columns }) => ({ wrapName: on, columns: columns.map(c => withWrap(c, on)) })) }} />
    </label>}
    {view.layout === 'calendar' && <label className="database-menu-row">Show as
      <select aria-label="Show as" value={view.calendarSpan ?? 'month'} onChange={e => { const calendarSpan = e.target.value === 'week' ? 'week' as const : null; changeView(() => ({ calendarSpan })) }}>
        <option value="month">Month</option><option value="week">Week</option>
      </select>
    </label>}
    {view.layout === 'calendar' && dateProperties(db.database).length > 0 && <label className="database-menu-row">Show calendar by
      <select value={viewDateBy(db.database, view)?.id ?? ''} onChange={e => { const dateBy = e.target.value; if (dateBy) changeView(() => ({ dateBy })) }}>
        {!viewDateBy(db.database, view) && <option value="">Choose…</option>}
        {dateProperties(db.database).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>}
  </>
}

// ---------------------------------------------------------------- properties (design §7.5, §6.2)

function withWrap(column: View['columns'][number], on: boolean): View['columns'][number] {
  const { wrap: _wrap, ...rest } = column
  return on ? { ...rest, wrap: true } : rest
}

function PropertiesPanel({ db, view, go }: { db: DatabasePage; view: View; go: (p: Panel) => void }) {
  const change = useChange(db)
  const shown = new Set(view.columns.map(c => c.id))
  // Shown ones in the view's order, then the hidden ones in the database's order.
  const ordered = [...view.columns.map(c => db.database.properties.find(p => p.id === c.id)).filter((p): p is Property => Boolean(p)), ...db.database.properties.filter(p => !shown.has(p.id))]
  const changeView = useViewChange(db.id, view.id)
  const setColumns = (build: (columns: View['columns']) => View['columns']) => changeView(current => ({ columns: build(current.columns) }))
  const toggle = (p: Property) => setColumns(columns => (columns.some(c => c.id === p.id) ? columns.filter(c => c.id !== p.id) : [...columns, { id: p.id }]))
  // Left and right, one place at a time (R1-14); dragging comes later.
  const shift = (p: Property, by: -1 | 1) => setColumns(columns => { const i = columns.findIndex(c => c.id === p.id), j = i + by; if (i < 0 || j < 0 || j >= columns.length) return columns; const next = [...columns]; [next[i], next[j]] = [next[j]!, next[i]!]; return next })
  return <>
    <Head title="Properties" back={() => go('root')} />
    <div className="database-property-line is-title"><span>Name</span><span className="database-menu-quiet">always shown</span></div>
    {(view.layout === 'table' || view.layout === 'list') && <label className="database-menu-row">Wrap Name
      <input type="checkbox" checked={Boolean(view.wrapName)} onChange={e => { const wrapName = e.target.checked; changeView(() => ({ wrapName })) }} />
    </label>}
    {ordered.map(p => <div key={p.id} className="database-property-line">
      <label className="database-property-switch"><input type="checkbox" checked={shown.has(p.id)} onChange={() => toggle(p)} aria-label={`Show ${p.name}`} /></label>
      {db.database.fixed
        ? <span className="database-property-name">{p.name}<span className="database-menu-quiet"> · {typeLabels[kindOf(p)]}</span></span>
        : <button type="button" className="database-property-name" onClick={() => go({ property: p.id })}>{p.name}<span className="database-menu-quiet"> · {typeLabels[kindOf(p)]}</span></button>}
      {shown.has(p.id) && view.columns[0]?.id !== p.id && <button type="button" aria-label={`Move ${p.name} left`} onClick={() => shift(p, -1)}>↑</button>}
      {shown.has(p.id) && view.columns.at(-1)?.id !== p.id && <button type="button" aria-label={`Move ${p.name} right`} onClick={() => shift(p, 1)}>↓</button>}
    </div>)}
    {!db.database.fixed && <button type="button" role="menuitem" onClick={() => go('new-property')}>+ Add property</button>}
  </>
}

/** Add (design §6.2): a name, then a type; Enter makes a Text property. */
/** What a new relation or rollup starts from, changed in its own panel: another database if there is one, its first relation and a count. */
function linkFields(workspace: Workspace | null, db: DatabasePage, type: PropertyType): Pick<Property, 'target' | 'rollup'> {
  if (type === 'relation') return { target: linkableDatabases(workspace).find(p => p.id !== db.id)?.id ?? db.id }
  const relation = db.database.properties.find(p => p.type === 'relation')
  return type === 'rollup' && relation ? { rollup: { relation: relation.id, property: titleId, fn: 'countAll' } } : {}
}
const linkableDatabases = (workspace: Workspace | null): DatabasePage[] => (workspace?.pages ?? []).filter((p): p is DatabasePage => isDatabase(p) && !p.trashedAt && !p.database.fixed)
const rollupLabels: Record<RollupFunction, string> = { original: 'Show original', unique: 'Show unique values', countAll: 'Count all', countValues: 'Count values', countUnique: 'Count unique values', countEmpty: 'Count empty', countNotEmpty: 'Count not empty', percentEmpty: 'Percent empty', percentNotEmpty: 'Percent not empty', sum: 'Sum', average: 'Average', median: 'Median', min: 'Min', max: 'Max', range: 'Range', earliest: 'Earliest date', latest: 'Latest date', dateRange: 'Date range', checked: 'Checked', unchecked: 'Unchecked', percentChecked: 'Percent checked', percentUnchecked: 'Percent unchecked' }
/** A relation's and a rollup's own settings (design §6.2, R3-5, R3-6, R3-7). */
function LinkSettings({ db, property, update, change }: { db: DatabasePage; property: Property; update(fields: { target?: string; limit?: 1 | null; rollup?: Rollup }): void; change(c: DatabaseChange, withUndo?: boolean): void }) {
  const { workspace } = useWorkspace()
  if (property.type === 'relation') {
    const targets = linkableDatabases(workspace)
    const toTodos = property.target === todosSourceId
    const target = targets.find(p => p.id === property.target)
    const shows = () => {
      if (property.mirror) { change({ kind: 'setMirror', propertyId: property.id, mirror: null }, true); return }
      const taken = new Set(['name', ...(target?.database.properties ?? []).map(p => p.name.toLocaleLowerCase())]), base = db.title || 'Related'
      let name = base
      for (let n = 2; taken.has(name.toLocaleLowerCase()); n++) name = `${base} ${n}`
      change({ kind: 'setMirror', propertyId: property.id, mirror: { id: crypto.randomUUID(), name } }, true)
    }
    return <>
      <label className="database-menu-row">Related to
        <select value={property.target} disabled={Boolean(property.mirror)} onChange={e => update({ target: e.target.value })}>
          {targets.map(p => <option key={p.id} value={p.id}>{p.title || 'Untitled'}</option>)}
          <option value={todosSourceId}>{todosTitle}</option>
        </select>
      </label>
      <label className="database-menu-row">Limit
        <select value={property.limit === 1 ? '1' : 'none'} onChange={e => update({ limit: e.target.value === '1' ? 1 : null })}>
          <option value="none">No limit</option><option value="1">1 page</option>
        </select>
      </label>
      {toTodos && <p className="database-menu-quiet">One way: to-dos can't have extra properties.</p>}
      {target && <label className="database-menu-row">{target.id === db.id ? 'Two separate properties' : `Show on ${target.title || 'Untitled'}`}
        <input type="checkbox" checked={Boolean(property.mirror)} onChange={shows} />
      </label>}
    </>
  }
  const rollup = property.rollup
  if (!rollup) return null
  const relations = db.database.properties.filter(p => p.type === 'relation')
  const through = relations.find(p => p.id === rollup.relation)
  const target = through && workspace ? databaseSource(workspace, through.target!) : undefined
  const readable = isDatabase(target) ? target.database.properties.filter(p => p.type !== 'rollup') : []
  const read = readable.find(p => p.id === rollup.property)
  const fns = rollupFunctionsFor(read?.type ?? 'title')
  return <>
    <label className="database-menu-row">Relation
      <select value={rollup.relation} onChange={e => update({ rollup: { relation: e.target.value, property: titleId, fn: 'countAll' } })}>
        {relations.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <label className="database-menu-row">Property
      <select value={rollup.property} onChange={e => { const next = readable.find(p => p.id === e.target.value); const can = rollupFunctionsFor(next?.type ?? 'title'); update({ rollup: { ...rollup, property: e.target.value, fn: can.includes(rollup.fn) ? rollup.fn : 'countAll' } }) }}>
        <option value={titleId}>Name</option>
        {readable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <label className="database-menu-row">Calculate
      <select value={rollup.fn} onChange={e => update({ rollup: { ...rollup, fn: e.target.value as RollupFunction } })}>
        {fns.map(fn => <option key={fn} value={fn}>{rollupLabels[fn]}</option>)}
      </select>
    </label>
  </>
}
function NewPropertyPanel({ db, view, go }: { db: DatabasePage; view: View; go: (p: Panel) => void }) {
  const change = useChange(db)
  const changeView = useViewChange(db.id, view.id)
  const blockId = useContext(MenuBlock) ?? ''
  const [name, setName] = useState('')
  const { workspace } = useWorkspace()
  const firstRelation = db.database.properties.some(p => p.type === 'relation')
  const make = (type: PropertyType) => {
    const id = newId()
    const linked = isLinkedBlock(blockId)
    change({ kind: 'addProperty', property: { id, name: name.trim() || typeLabels[type], type, ...linkFields(workspace, db, type) }, ...(linked ? {} : { viewId: view.id }) })
    if (linked) changeView(current => ({ columns: [...current.columns, { id }] }))
    go(type === 'formula' ? { formula: id } : { property: id })
  }
  return <>
    <Head title="New property" back={() => go('properties')} />
    <input className="database-menu-field" aria-label="Property name" placeholder="Name" autoFocus value={name} onChange={e => setName(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); make('text') } }} />
    {propertyTypes.map(t => <button key={t} type="button" role="menuitem" disabled={t === 'rollup' && !firstRelation} onClick={() => make(t)}>{typeLabels[t]}{t === 'rollup' && !firstRelation && <span className="database-menu-quiet"> · add a relation first</span>}</button>)}
  </>
}

/**
 * A database's row templates (R3-12). From `+ New ⌄` a tap makes a row from one; from `⋯` it opens it to edit.
 * Empty is only there when `+ New` would otherwise start from a default.
 */
function TemplatesPanel({ db, view, pick, go, close }: { db: DatabasePage; view: View; pick?: (template: string | null) => void; go: (p: Panel) => void; close: () => void }) {
  const { workspace, run } = useWorkspace()
  const navigate = useNavigate()
  const list = workspace ? rowTemplates(workspace, db.id) : []
  const current = workspace ? defaultRowTemplate(workspace, db, view) : undefined
  const edit = (pageId: string, focus?: 'title') => { close(); void navigate({ to: '/pages', search: { page: pageId, ...(focus ? { focus } : {}) } }) }
  const add = async () => {
    const pageId = newId()
    if (await run({ type: 'create-template', databaseId: db.id, title: '', pageId })) edit(pageId, 'title')
  }
  return <>
    <Head title="Templates" {...(pick ? {} : { back: () => go('root') })} />
    {pick && current && <button type="button" role="menuitem" onClick={() => { close(); pick(null) }}>Empty</button>}
    {list.map(t => <div key={t.id} className="database-property-line">
      <button type="button" className="database-property-name" onClick={() => { if (pick) { close(); pick(t.id) } else edit(t.id) }}>{t.title.trim() || 'Untitled'}{t.id === current?.id && <span className="database-menu-quiet"> · default</span>}</button>
      <button type="button" aria-label={`${t.title.trim() || 'Untitled'} options`} onClick={() => go({ template: t.id })}>⋯</button>
    </div>)}
    <button type="button" role="menuitem" onClick={() => void add()}>+ New template</button>
  </>
}

/** One template: edit it, make it the default here or everywhere, or delete it. Rows made from it stay as they are. */
function TemplatePanel({ db, view, templateId, go, close }: { db: DatabasePage; view: View; templateId: string; go: (p: Panel) => void; close: () => void }) {
  const { workspace, run } = useWorkspace()
  const navigate = useNavigate()
  const change = useChange(db)
  const changeView = useViewChange(db.id, view.id)
  const template = workspace?.pages.find(p => p.id === templateId)
  if (!template) return <><Head title="Template" back={() => go('templates')} /><p className="database-menu-quiet">Deleted</p></>
  const hereOn = view.defaultTemplate === templateId, allOn = db.database.defaultTemplate === templateId
  // The view's own would hide a new default for every view, so that one goes.
  const setAll = () => { if (!allOn && view.defaultTemplate) changeView(() => ({ defaultTemplate: null })); change({ kind: 'setDefaultTemplate', templateId: allOn ? null : templateId }) }
  return <>
    <Head title={template.title.trim() || 'Untitled'} back={() => go('templates')} />
    <button type="button" role="menuitem" onClick={() => { close(); void navigate({ to: '/pages', search: { page: templateId } }) }}>Edit</button>
    <button type="button" role="menuitemcheckbox" aria-checked={hereOn} onClick={() => changeView(() => ({ defaultTemplate: hereOn ? null : templateId }))}>Default for this view{hereOn && <span className="database-menu-chevron">✓</span>}</button>
    <button type="button" role="menuitemcheckbox" aria-checked={allOn} onClick={setAll}>Default for all views{allOn && <span className="database-menu-chevron">✓</span>}</button>
    <hr />
    <button type="button" role="menuitem" className="is-danger" onClick={() => { go('templates'); void run({ type: 'delete-template', pageId: templateId }, r => ({ text: r.message, undoOperationId: r.operationId })) }}>Delete</button>
  </>
}

/** Each shown column's calculation at the table's foot, Name first (design §4.1a). */
function CalculatePanel({ db, view, back }: { db: DatabasePage; view: View; back: () => void }) {
  const changeView = useViewChange(db.id, view.id)
  if (view.layout === 'board') {
    // One per view, in every column's head: a count until he picks something else (R3-24).
    const chosen = viewBoardCalculation(db.database, view)
    const properties = [propertyOf(db.database, titleId)!, ...db.database.properties]
    const of = chosen ? propertyOf(db.database, chosen.by) : null
    return <>
      <Head title="Calculate" back={back} />
      <label className="database-menu-row">Property
        <select aria-label="Property" value={chosen?.by ?? ''} onChange={e => {
          const by = e.target.value, property = by ? propertyOf(db.database, by) : null
          changeView(() => ({ boardCalculation: property ? { by, kind: property.type === 'number' ? 'sum' : calcChoices(property.type)[0]! } : null }))
        }}>
          <option value="">Count of rows</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {chosen && of && <label className="database-menu-row">Calculate
        <select aria-label="Calculate" value={chosen.kind} onChange={e => { const kind = e.target.value as CalcKind; changeView(() => ({ boardCalculation: { by: chosen.by, kind } })) }}>
          {calcChoices(of.type).map(kind => <option key={kind} value={kind}>{calcLabels[kind]}</option>)}
        </select>
      </label>}
    </>
  }
  const chosen = viewCalculations(db.database, view)
  const set = (columnId: string, kind: string) => changeView(current => {
    const { [columnId]: _old, ...rest } = current.calculations ?? {}
    return { calculations: kind ? { ...rest, [columnId]: kind as CalcKind } : rest }
  })
  const shown = [propertyOf(db.database, titleId)!, ...viewColumns(db.database, view).map(c => c.property)]
  return <>
    <Head title="Calculate" back={back} />
    {shown.map(p => <label key={p.id} className="database-menu-row">{p.name}
      <select aria-label={p.name} value={chosen[p.id] ?? ''} onChange={e => set(p.id, e.target.value)}>
        <option value="">None</option>
        {calcChoices(p.type).map(kind => <option key={kind} value={kind}>{calcLabels[kind]}</option>)}
      </select>
    </label>)}
  </>
}

function FormulaPanel({ db, propertyId, go }: { db: DatabasePage; propertyId: string; go: (p: Panel) => void }) {
  const { workspace } = useWorkspace()
  const change = useChange(db)
  const wide = useWide()
  const property = db.database.properties.find(p => p.id === propertyId)
  const back = () => go({ property: propertyId })
  if (!property || !workspace) return <><Head title="Formula" back={() => go('properties')} /><p className="database-menu-quiet">Deleted</p></>
  return <>
    <Head title={`Edit formula · ${property.name}`} back={back} />
    <FormulaEditor workspace={workspace} read={withLinks(workspace)} db={db} propertyId={propertyId} stored={property.formula ?? ''} wide={wide}
      onCancel={back} onDone={stored => { if (stored !== property.formula) change({ kind: 'updateProperty', propertyId, formula: stored }, true); back() }} />
  </>
}

function PropertyPanel({ db, view, propertyId, go }: { db: DatabasePage; view: View; propertyId: string; go: (p: Panel) => void }) {
  const change = useChange(db)
  const changeView = useViewChange(db.id, view.id)
  const property = db.database.properties.find(p => p.id === propertyId)
  if (!property) return <><Head title="Property" back={() => go('properties')} /><p className="database-menu-quiet">Deleted</p></>
  const { workspace } = useWorkspace()
  const update = (fields: Omit<Extract<DatabaseChange, { kind: 'updateProperty' }>, 'kind' | 'propertyId'>, withUndo = false) => change({ kind: 'updateProperty', propertyId, ...fields }, withUndo)
  const hasOptions = property.type === 'select' || property.type === 'multiSelect' || property.type === 'status'
  const options = property.options ?? []
  const updateOptions = (build: (options: Property['options'] & object) => Property['options'] & object, withUndo = false) =>
    change(current => ({ kind: 'updateProperty', propertyId, options: build(current.properties.find(p => p.id === propertyId)?.options ?? []) }), withUndo)
  const shown = view.columns.some(c => c.id === propertyId)
  return <>
    <Head title={property.name} back={() => go('properties')} />
    <CommitInput key={property.name} ariaLabel="Name" initial={property.name} onCommit={v => { if (v.trim()) update({ name: v.trim() }) }} />
    <label className="database-menu-row">Type
      {/* Changing the type converts what it can and says how many it couldn't, with Undo (design §6.2). */}
      <select value={kindOf(property)} onChange={e => { const type = e.target.value as PropertyType; update({ type, ...linkFields(workspace, db, type) }, true) }}>
        {propertyTypes.map(t => <option key={t} value={t}>{typeLabels[t]}</option>)}
      </select>
    </label>
    <LinkSettings db={db} property={property} update={fields => update(fields, true)} change={change} />
    {isFormula(property) && <>
      <button type="button" role="menuitem" onClick={() => go({ formula: propertyId })}>Edit formula</button>
      {property.formulaError && <p className="database-menu-quiet is-error" role="status">{property.formulaError}</p>}
    </>}
    {property.type === 'number' && kindOf(property) === 'number' && <label className="database-menu-row">Format
      <select value={property.format ?? 'plain'} onChange={e => update({ format: e.target.value as Property['format'] })}>
        <option value="plain">Number</option><option value="comma">1,000</option><option value="percent">Percent</option><option value="currency">Currency</option>
      </select>
    </label>}
    {shown && canWrap(property.type) && <label className="database-menu-row">Wrap in this view
      <input type="checkbox" checked={Boolean(view.columns.find(c => c.id === propertyId)?.wrap)} onChange={e => { const on = e.target.checked; changeView(({ columns }) => ({ columns: columns.map(c => (c.id !== propertyId ? c : withWrap(c, on))) })) }} />
    </label>}
    {property.type === 'id' && <label className="database-menu-row">Prefix
      <CommitInput key={property.prefix ?? ''} ariaLabel="Prefix" initial={property.prefix ?? ''} placeholder="None" onCommit={v => update({ prefix: v })} />
    </label>}
    {property.type === 'date' && kindOf(property) === 'date' && <label className="database-menu-row">Include time
      <input type="checkbox" checked={Boolean(property.withTime)} onChange={e => update({ withTime: e.target.checked })} />
    </label>}
    {hasOptions && <div className="database-options">
      {options.map((o, i) => <div key={o.id} className="database-option-line">
        {property.type === 'status' && <select aria-label="Group" value={o.group ?? 'todo'} onChange={e => { const group = e.target.value as 'todo'; updateOptions(now => now.map(x => (x.id === o.id ? { ...x, group } : x))) }}>
          <option value="todo">To do</option><option value="active">In progress</option><option value="done">Done</option>
        </select>}
        <CommitInput key={o.name} ariaLabel="Option name" initial={o.name} onCommit={v => { if (v.trim()) updateOptions(now => now.map(x => (x.id === o.id ? { ...x, name: v.trim() } : x))) }} />
        {i > 0 && <button type="button" aria-label="Move up" onClick={() => updateOptions(now => { const at = now.findIndex(x => x.id === o.id); if (at < 1) return now; const next = [...now]; [next[at - 1], next[at]] = [next[at]!, next[at - 1]!]; return next })}>↑</button>}
        <button type="button" className="database-rule-remove" aria-label={`Delete ${o.name}`} onClick={() => updateOptions(now => now.filter(x => x.id !== o.id), true)}>×</button>
      </div>)}
      <CommitInput key={options.length} ariaLabel="New option" initial="" placeholder="Add an option" onCommit={v => { if (v.trim()) { const made = { id: newId(), name: v.trim(), ...(property.type === 'status' ? { group: 'todo' as const } : {}) }; updateOptions(now => [...now, made]) } }} />
    </div>}
    <hr />
    <button type="button" role="menuitem" onClick={() => changeView(({ columns }) => ({ columns: columns.some(c => c.id === propertyId) ? columns.filter(c => c.id !== propertyId) : [...columns, { id: propertyId }] }))}>{shown ? 'Hide in this view' : 'Show in this view'}</button>
    {property.mirror && <p className="database-menu-quiet">Deleting it also deletes its other side.</p>}
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
  const [adding, setAdding] = useState<null | 'type' | 'board' | 'calendar'>(null)
  const views = db.database.views
  const pick = (id: string) => { setShownView(blockId, id); setOpenMenu(null) }
  const add = (from?: View, groupBy?: string, layout: 'table' | 'list' | 'gallery' | 'calendar' = 'table', dateBy?: string) => {
    const id = newId()
    // A new view is named after its type, with the name ready to rename (design §7.1); Duplicate copies one. A new board's or
    // gallery's cards start as titles alone: Properties adds what he wants on them (§7.5).
    const view: View = from ? { ...structuredClone(from), id, name: `${from.name} (copy)` } : { id, name: groupBy ? 'Board' : layoutLabels[layout], layout: groupBy ? 'board' : layout, columns: groupBy || layout === 'gallery' || layout === 'calendar' ? [] : current.columns, sort: [], filter: [], ...(groupBy ? { groupBy } : {}), ...(dateBy ? { dateBy } : {}) }
    change({ kind: 'addView', view })
    setShownView(blockId, id)
    setActions(null); setAdding(null); setRenaming(id)
  }
  const addBoard = () => { const only = groupableProperties(db.database, 'board'); if (only.length === 1) add(undefined, only[0]!.id); else setAdding('board') }
  const addCalendar = () => { const only = dateProperties(db.database); if (only.length === 1) add(undefined, undefined, 'calendar', only[0]!.id); else setAdding('calendar') }
  if (adding === 'calendar') return <><Head title="New calendar" back={() => setAdding('type')} /><CalendarDateChoices db={db} onPick={id => add(undefined, undefined, 'calendar', id)} /></>
  if (adding === 'board') return <><Head title="New board" back={() => setAdding('type')} /><BoardGroupChoices db={db} onPick={id => add(undefined, id)} /></>
  if (adding === 'type') return <>
    <Head title="New view" back={() => setAdding(null)} />
    <button type="button" role="menuitem" onClick={() => add()}>Table</button>
    <button type="button" role="menuitem" onClick={addBoard}>Board</button>
    <button type="button" role="menuitem" onClick={() => add(undefined, undefined, 'list')}>List</button>
    <button type="button" role="menuitem" onClick={() => add(undefined, undefined, 'gallery')}>Gallery</button>
    <button type="button" role="menuitem" onClick={addCalendar}>Calendar</button>
  </>
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
    <button type="button" role="menuitem" onClick={() => setAdding('type')}>+ Add view</button>
  </>
}
