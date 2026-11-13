// Dashboard (docs/design/dashboard.md, dashboard-edit.md): rows of widgets, each a linked view of any database with its own
// copy of its settings. Read mode draws each as any linked view; edit mode draws a frame over them, makes their content
// inert, and arranges them with the dashboard's own commands (dashboard.ts), one command and one Undo each.
import { useNavigate } from '@tanstack/react-router'
import { toast } from '@heroui/react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { dashboardLimits, filteredView, findWidget, firstWidgetView, handleChoices, rowHeights, shownWidths, snapHeight, widgetRules, type Dashboard, type DashboardChange, type DashboardRow, type DashboardWidget } from '../domain/dashboard'
import { useRoom } from './drag-lift'
import { isDatabase, type Database, type View } from '../domain/database'
import { readingWorkspace, todosSourceId, todosTitle } from '../domain/todos-source'
import type { Page, Workspace } from '../domain/types'
import { DatabaseHeader, LaidOutView, rowCaps, setLinkedBlock, type ChangeView, type DatabaseViewProps } from './database-block'
import { SourceLine, TrashedSource } from './database-linked'
import { openDatabaseMenu, opLabels } from './database-menu'
import { filterLabel, openDashboardFilterFrom } from './dashboard-filter'
import { displayPageTitle } from './page-title'
import { RowMenu, type MenuItem } from './row-menu'
import { useWide } from './property-editors'
import { useWorkspace } from './use-day'

type DatabasePage = Page & { database: Database }
const sourceTitle = (source: DatabasePage) => (source.id === todosSourceId ? todosTitle : displayPageTitle(source))
type Props = DatabaseViewProps & { view: View; changeView: ChangeView }
const newId = (): string => crypto.randomUUID()

/** What a dashboard command can be refused for once the dashboard has changed under it: said in place, nothing to Retry. */
const refusals = /Saved elsewhere|That widget's gone|That row's gone|That row's changed since|Not next to each other|Already there|widgets to a row at most|widgets at most|That database is gone/
/** The commands' common part, built from the dashboard as the workspace holds it when the command goes. */
function useDashboardRun(hostId: string, viewId: string) {
  const { run } = useWorkspace()
  return async (build: (dashboard: Dashboard) => DashboardChange | null, notice?: string) => {
    const once = () => {
      let stale = false, refusal: string | null = null, gone = false
      const receipt = run(ws => {
        const host = ws.pages.find(p => p.id === hostId), view = isDatabase(host) ? host.database.views.find(v => v.id === viewId) : undefined
        const change = view?.dashboard ? build(view.dashboard) : null
        // Nothing to send: what it was for isn't there any more (a widget removed in another tab).
        if (!change) gone = true
        return change ? { type: 'change-database', pageId: hostId, change } : null
      }, notice ? r => ({ text: notice, undoOperationId: r.operationId }) : undefined, undefined, { inlineRefusal: refusals, onRefused: m => { if (/Saved elsewhere/.test(m)) stale = true; else refusal = m } })
      return receipt.then(r => ({ r, stale, refusal, gone }))
    }
    // A tab behind the workspace is refused whatever it sends, and comes back up to date (G6-5). Each command names only
    // its own widget or row, so it's built again from what's there now and sent once more; a real refusal says so.
    const first = await once()
    if (first.r || !first.stale) { if (!first.r && first.refusal) toast(first.refusal, { timeout: 6000 }); return first.r }
    // Sent again and still refused (its neighbour moved, or it's been removed): said, and the dashboard as it is now is
    // drawn, so a change never fails silently (Bumblebee ba4322f2).
    const again = await once()
    if (!again.r && again.gone) toast("That widget's gone · removed in another tab", { timeout: 6000 })
    else if (!again.r && (again.stale || again.refusal)) toast('Changed in another tab, so nothing was changed', { timeout: 6000 })
    return again.r
  }
}

/** Where a dashboard isn't its database's own page, as on a day page: a link to it, never its widgets (dashboard.md §5). */
function DashboardLink({ db, view }: { db: DatabasePage; view: View }) {
  const navigate = useNavigate()
  return <p className="dashboard-link"><button type="button" className="app-link" onClick={() => void navigate({ to: '/pages', search: { page: db.id } })}>{view.name} · {displayPageTitle(db)}</button></p>
}

export function DatabaseDashboard(props: Props) {
  const { db, view, blockId } = props
  // A dashboard is only ever a full page (Lead 4a1712e6): anywhere else it's a link to one.
  if (!blockId.startsWith('page:')) return <DashboardLink db={db} view={view} />
  return <FullDashboard {...props} />
}

/** Where a dragged widget would land: into a row before a widget (last when null), or a new row before a row (last when null). */
type Landing = { rowId: string; beforeId: string | null } | { newRowBefore: string | null }
const sameLanding = (a: Landing | null, b: Landing | null) => JSON.stringify(a) === JSON.stringify(b)
/** "1/3" for 4 twelfths. */
const fraction = (twelfths: number) => ({ 3: '1/4', 4: '1/3', 6: '1/2', 8: '2/3', 9: '3/4', 12: '1' } as Record<number, string>)[twelfths] ?? `${twelfths}/12`

function FullDashboard({ workspace, db, view, changeView, blockId, showTitle }: Props) {
  const [editing, setEditing] = useState(false)
  const dashboard: Dashboard = view.dashboard ?? { rows: [] }
  const send = useDashboardRun(db.id, view.id)
  const count = dashboard.rows.reduce((n, r) => n + r.widgets.length, 0)
  const root = useRef<HTMLDivElement>(null)
  const room = useRoom(() => [...(root.current?.querySelectorAll('.dashboard-widget, .dashboard-row') ?? [])], id => root.current?.querySelector<HTMLElement>(`[data-widget="${CSS.escape(id)}"]`) ?? null)
  // The widget being dragged and where it would land; the rows are drawn without it, and a slot where it would go.
  const [drag, setDrag] = useState<{ widgetId: string; landing: Landing | null } | null>(null)
  // Esc leaves edit mode, unless a menu, sheet or drag has it first (dashboard-edit.md §2).
  useEffect(() => {
    if (!editing) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !drag && !document.querySelector('.app-menu, .database-menu, [role=dialog]')) setEditing(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [editing, drag])
  const order = dashboard.rows.flatMap(r => r.widgets.map(w => w.id))
  const moving = drag ? findWidget(dashboard, drag.widgetId) : null

  /** The landing under the pointer: a row's side of a widget, or the gap between rows. A full row takes nothing (§4). */
  const landingAt = (x: number, y: number, widgetId: string): Landing | null => {
    // The rows as stored: a slot's own row isn't one of them.
    const rows = [...(root.current?.querySelectorAll<HTMLElement>('.dashboard-row[data-row]') ?? [])]
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i]!, rect = el.getBoundingClientRect(), id = el.dataset.row!
      if (y < rect.top) return { newRowBefore: id }
      if (y > rect.bottom) continue
      const row = dashboard.rows.find(r => r.id === id)
      if (!row) continue
      const own = row.widgets.some(w => w.id === widgetId)
      if (!own && row.widgets.length >= dashboardLimits.perRow) return null
      const others = [...el.querySelectorAll<HTMLElement>('.dashboard-widget:not(.is-lifted)')]
      const before = others.find(w => { const r = w.getBoundingClientRect(); return x < r.left + r.width / 2 && y >= r.top && y <= r.bottom })
      return { rowId: id, beforeId: before?.dataset.widget ?? null }
    }
    return { newRowBefore: null }
  }
  /** Whether landing there would put it where it is: then nothing is sent (Jazz 06c36e09). */
  const inPlace = (landing: Landing, widgetId: string): boolean => {
    const at = findWidget(dashboard, widgetId)
    if (!at) return true
    if ('rowId' in landing) {
      if (landing.rowId !== at.row.id) return false
      const others = at.row.widgets.filter(w => w.id !== widgetId)
      const index = landing.beforeId ? others.findIndex(w => w.id === landing.beforeId) : others.length
      return index === at.index
    }
    const next = dashboard.rows[dashboard.rows.indexOf(at.row) + 1]?.id ?? null
    return at.row.widgets.length === 1 && (landing.newRowBefore === at.row.id || landing.newRowBefore === next)
  }
  const startDrag = (e: React.PointerEvent<HTMLElement>, widgetId: string) => {
    if (!editing || e.button !== 0 || e.pointerType !== 'mouse' || (e.target as Element).closest('button, [role=menu], .dashboard-split, .dashboard-row-size')) return
    const el = e.currentTarget, x0 = e.clientX, y0 = e.clientY
    let lifted = false, landing: Landing | null = null
    const move = (ev: PointerEvent) => {
      if (!lifted) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
        lifted = true
        room.pickUp(el, ev.clientX, ev.clientY, { context: 'database-block is-page dashboard is-editing is-dragging' })
        setDrag({ widgetId, landing: null })
      }
      room.copy.current?.move(ev.clientX, ev.clientY)
      const next = landingAt(ev.clientX, ev.clientY, widgetId)
      if (!sameLanding(next, landing)) { landing = next; room.willRedraw(); setDrag({ widgetId, landing }) }
    }
    const end = (ev: PointerEvent, cancel = false) => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('keydown', key, true)
      if (!lifted) return
      const target = cancel ? null : landingAt(ev.clientX, ev.clientY, widgetId) ?? landing
      if (!target || inPlace(target, widgetId)) { setDrag(null); room.land(widgetId); return }
      // Saved first and drawn in place; then the copy settles into it (§4).
      const change: DashboardChange = 'rowId' in target
        ? { kind: 'moveWidget', viewId: view.id, widgetId, toRowId: target.rowId, beforeId: target.beforeId }
        : { kind: 'moveWidget', viewId: view.id, widgetId, toRowId: null, newRowId: newId(), rowBeforeId: target.newRowBefore, beforeId: null }
      void send(() => change, 'Widget moved').finally(() => { setDrag(null); room.land(widgetId) })
    }
    const up = (ev: PointerEvent) => end(ev)
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && lifted) { ev.preventDefault(); ev.stopPropagation(); end(new PointerEvent('pointerup', { clientX: x0, clientY: y0 }), true) } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('keydown', key, true)
  }
  const wide = useWide()
  // Between 900 and 1100, or with the Comments pane open, a row can wrap: a width handle shows only between neighbours side by side (§7).
  useLayoutEffect(() => {
    if (!wide || !root.current) return
    for (const row of root.current.querySelectorAll<HTMLElement>('.dashboard-row[data-row]')) {
      let top: number | null = null
      for (const w of row.querySelectorAll<HTMLElement>(':scope > .dashboard-widget')) {
        const now = Math.round(w.getBoundingClientRect().top)
        w.toggleAttribute('data-wrapped', top !== null && now !== top)
        top = now
      }
    }
  })
  /** After a menu move at 390: scroll the widget into view and give it the moved-line wash (dashboard-edit.md §7). */
  const moved = (id: string) => requestAnimationFrame(() => {
    const el = root.current?.querySelector<HTMLElement>(`[data-widget="${CSS.escape(id)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    el.classList.add('is-moved'); setTimeout(() => el.classList.remove('is-moved'), 1000)
  })
  const rules = dashboard.filter ?? []
  const openFilter = () => { openDashboardFilterFrom(null); openDatabaseMenu(blockId, db.id, 'filter') }
  const head = <>
    <div className="dashboard-head">
      <div className="dashboard-head-main"><DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle ?? true} onTitleEnter={() => {}} /></div>
      <button type="button" className={`dashboard-edit${editing ? ' is-on' : ''}`} aria-pressed={editing} onClick={() => setEditing(e => !e)}>{editing ? 'Done' : 'Edit'}</button>
    </div>
    {/* The rules across widgets as chips on their own row; none, and the row isn't there (dashboard-edit.md §9). */}
    {rules.length > 0 && <div className="dashboard-rules database-filter-line">
      {rules.map(r => <span key={r.id} className="database-filter-chip">
        <button type="button" className="database-chip-open" onClick={openFilter}>{r.name} {opLabels[r.op]}{ruleValueWords(r.value)}</button>
        <button type="button" className="database-chip-remove" aria-label={`Remove ${r.name} filter`} onClick={() => void send(d => ({ kind: 'setDashboardFilter', viewId: view.id, rules: (d.filter ?? []).filter(x => x.id !== r.id).map(({ on: _on, ...x }) => x), any: Boolean(d.filterAny) }))}>×</button>
      </span>)}
    </div>}
  </>
  const adding = editing && (count >= dashboardLimits.widgets
    ? <p className="dashboard-limit">{dashboardLimits.widgets} widgets at most</p>
    : <AddWidget workspace={workspace} onPick={(source, sourceView) => void send(() => ({ kind: 'addWidget', viewId: view.id, widget: { id: newId(), source, view: sourceView }, rowId: null, newRowId: newId(), beforeId: null }), 'Widget added')} />)
  // At 390: every widget full width, one above another in reading order; stored widths ignored, nothing stored differently (§7).
  if (!wide) return <div ref={root} className={`dashboard is-phone${editing ? ' is-editing' : ''}`} data-dashboard={view.id}>
    {head}
    {dashboard.rows.flatMap((row, r) => row.widgets.map(widget => <WidgetFrame key={widget.id} workspace={workspace} host={db} view={view} row={row} widget={widget} width={12} editing={editing} blockId={`${blockId}|widget:${widget.id}`}
      previous={order[order.indexOf(widget.id) - 1]} next={order[order.indexOf(widget.id) + 1]} rowAbove={dashboard.rows[r - 1]} rowBelow={dashboard.rows[r + 1]} send={send} phone onMoved={moved} />))}
    {adding}
    {!dashboard.rows.length && !editing && <p className="database-empty">No widgets · <button type="button" className="app-link" onClick={() => setEditing(true)}>Edit</button></p>}
  </div>
  const slot = (width: number, key: string) => <div key={key} className="drag-slot dashboard-slot" style={{ ['--widget-width' as string]: width }} aria-hidden="true" />
  const landing = drag?.landing ?? null
  return <div ref={root} className={`dashboard${editing ? ' is-editing' : ''}${drag ? ' is-dragging' : ''}`} data-dashboard={view.id}>
    {head}
    {dashboard.rows.map((row, r) => {
      const ownRow = moving?.row.id === row.id
      // While dragging, the widget leaves its row (whose neighbours make room) and a slot shows where it would go.
      const shown = drag ? row.widgets.filter(w => w.id !== drag.widgetId) : row.widgets
      const into = landing && 'rowId' in landing && landing.rowId === row.id
      const widths = drag
        ? (into ? (ownRow ? null : Array.from({ length: shown.length + 1 }, () => 12 / (shown.length + 1))) : shown.length ? Array.from({ length: shown.length }, () => 12 / shown.length) : [])
        : shownWidths(row)
      const items = shown.map((widget, i) => {
        const width = drag && ownRow && into ? widget.width : widths?.[i] ?? 12 / Math.max(1, shown.length)
        return <WidgetFrame key={widget.id} workspace={workspace} host={db} view={view} row={row} widget={widget} width={width} editing={editing} blockId={`${blockId}|widget:${widget.id}`}
          previous={order[order.indexOf(widget.id) - 1]} next={order[order.indexOf(widget.id) + 1]} rowAbove={dashboard.rows[r - 1]} rowBelow={dashboard.rows[r + 1]} send={send}
          onPointerDown={e => startDrag(e, widget.id)} split={!drag && i > 0 && editing ? i : undefined} />
      })
      if (into && landing && 'rowId' in landing) {
        const at = landing.beforeId ? shown.findIndex(w => w.id === landing.beforeId) : shown.length
        items.splice(at < 0 ? shown.length : at, 0, slot(ownRow ? moving!.widget.width : 12 / (shown.length + 1), 'slot'))
      }
      const rowEl = (shown.length || into) ? <div key={row.id} className="dashboard-row" data-row={row.id} style={{ ['--row-height' as string]: `${into && !ownRow ? row.height : row.height}px` }}>
        {items}
        {editing && !drag && <RowSize row={row} viewId={view.id} send={send} />}
      </div> : null
      const newRowSlot = landing && 'newRowBefore' in landing && landing.newRowBefore === row.id
        ? <div key={`new-${row.id}`} className="dashboard-row" style={{ ['--row-height' as string]: `${moving?.row.height ?? rowHeights.initial}px` }}>{slot(12, 'slot')}</div> : null
      return [newRowSlot, rowEl]
    })}
    {landing && 'newRowBefore' in landing && landing.newRowBefore === null && <div className="dashboard-row" style={{ ['--row-height' as string]: `${moving?.row.height ?? rowHeights.initial}px` }}>{slot(12, 'slot')}</div>}
    {!drag && adding}
    {!dashboard.rows.length && !editing && <p className="database-empty">No widgets · <button type="button" className="app-link" onClick={() => setEditing(true)}>Edit</button></p>}
  </div>
}

/**
 * A handle's drag: the value shows at once as `preview` draws it, saves on release, and Esc puts it back and saves
 * nothing (Ratchet a950bc9e). Its listeners go with it, as does a drag still held when the handle goes.
 */
function useHandleDrag<T>(preview: (value: T | null) => void, save: (value: T) => void) {
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  return (initial: T, valueAt: (ev: PointerEvent) => T) => {
    let value = initial
    const end = (commit: boolean) => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('keydown', key, true)
      stop.current = null
      preview(null)
      if (commit) save(value)
    }
    const move = (ev: PointerEvent) => { value = valueAt(ev); preview(value) }
    const up = () => end(true)
    // Capturing, so the dashboard's own Esc (which leaves edit mode) never sees this one.
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(false) } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('keydown', key, true)
    stop.current = () => end(false)
  }
}

/** The handle between widget `k - 1` and widget `k` of a row: it snaps through `handleChoices`, by where the boundary between the two
 * would sit, each showing at once on the widgets; one drag or one arrow key is one whole-row command and one Undo (§5). */
function SplitHandle({ row, k, viewId, send }: { row: DashboardRow; k: number; viewId: string; send: ReturnType<typeof useDashboardRun> }) {
  const [shown, setShown] = useState<number[] | null>(null)
  const [badgeY, setBadgeY] = useState(0)
  const ids = row.widgets.map(w => w.id), now = row.widgets.map(w => w.width)
  const choices = handleChoices(row.widgets.length, k)
  const boundary = (widths: number[]) => widths.slice(0, k).reduce((a, b) => a + b, 0)
  const save = (widths: number[]) => { if (widths.join() !== now.join()) void send(() => ({ kind: 'sizeSplit', viewId, rowId: row.id, widgetIds: ids, widths }), 'Width saved') }
  const els = useRef<HTMLElement[]>([])
  const drag = useHandleDrag<number[]>(widths => {
    setShown(widths)
    els.current.forEach((el, i) => el.style.setProperty('--widget-width', String((widths ?? now)[i])))
  }, save)
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault(); e.stopPropagation()
    const rowEl = e.currentTarget.closest<HTMLElement>('.dashboard-row')!
    els.current = ids.map(id => rowEl.querySelector<HTMLElement>(`[data-widget="${CSS.escape(id)}"]`)!).filter(Boolean)
    const rowBox = rowEl.getBoundingClientRect(), first = els.current[0]!.getBoundingClientRect().left, span = els.current.at(-1)!.getBoundingClientRect().right - first
    // The badge rides at the pointer's height on the handle, inside the row, so it never covers a widget's name (Jazz 6f0ebb20).
    const placeBadge = (y: number) => setBadgeY(Math.min(rowBox.height - 14, Math.max(14, y - rowBox.top)))
    placeBadge(e.clientY)
    drag(now, ev => {
      placeBadge(ev.clientY)
      const want = ((ev.clientX - first) / span) * 12
      return choices.reduce((best, c) => (Math.abs(boundary(c) - want) < Math.abs(boundary(best) - want) ? c : best), choices[0]!)
    })
  }
  const step = (d: number) => {
    const at = choices.findIndex(c => c.join() === now.join())
    const next = at < 0 ? choices.find(c => c.join() === '4,4,4') ?? choices[0] : choices[at + d]
    if (next) save(next)
  }
  if (choices.length < 2) return null
  return <button type="button" className={`dashboard-split${shown !== null ? ' is-held' : ''}`} aria-label={`Widths: ${now.map(fraction).join(' · ')}`}
    onPointerDown={onPointerDown} onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) } if (e.key === 'ArrowRight') { e.preventDefault(); step(1) } }}>
    {shown !== null && <span className="dashboard-badge" style={{ top: badgeY }}>{shown.map(fraction).join(' · ')}</span>}
  </button>
}

/** The handle under a row: its height in 40 px steps from 160 to 800, saved on release (§5). */
function RowSize({ row, viewId, send }: { row: DashboardRow; viewId: string; send: ReturnType<typeof useDashboardRun> }) {
  const [shown, setShown] = useState<number | null>(null)
  const save = (height: number) => { if (height !== row.height) void send(() => ({ kind: 'sizeRow', viewId, rowId: row.id, height }), 'Height saved') }
  const rowEl = useRef<HTMLElement | null>(null)
  const drag = useHandleDrag<number>(value => { setShown(value); rowEl.current?.style.setProperty('--row-height', `${value ?? row.height}px`) }, save)
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault(); e.stopPropagation()
    const y0 = e.clientY
    rowEl.current = e.currentTarget.closest<HTMLElement>('.dashboard-row')
    drag(row.height, ev => snapHeight(row.height + ev.clientY - y0))
  }
  return <button type="button" className={`dashboard-row-size${shown !== null ? ' is-held' : ''}`} aria-label={`Height of this row: ${row.height} px`}
    onPointerDown={onPointerDown} onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); save(snapHeight(row.height - rowHeights.step)) } if (e.key === 'ArrowDown') { e.preventDefault(); save(snapHeight(row.height + rowHeights.step)) } }}>
    {shown !== null && <span className="dashboard-badge">{shown} px</span>}
  </button>
}

/** One widget: in read mode its linked view as any; in edit mode the same, inert, under a frame with its menu. */
function WidgetFrame({ workspace, host, view, row, widget, width, editing, blockId, previous, next, rowAbove, rowBelow, send, onPointerDown, split, phone, onMoved }: {
  workspace: Workspace; host: DatabasePage; view: View; row: DashboardRow; widget: DashboardWidget; width: number; editing: boolean; blockId: string
  previous?: string; next?: string; rowAbove?: DashboardRow; rowBelow?: DashboardRow; send: ReturnType<typeof useDashboardRun>
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void; /** The handle on its left edge, between it and widget `split - 1`. */ split?: number
  /** At 390: Move up and Move down, no row items, and its height following its content up to 360 px (§7). */ phone?: boolean; onMoved?: (id: string) => void
}) {
  const body = useRef<HTMLDivElement>(null)
  // `inert` keeps every click, tap, key and focus out of the content while arranging (dashboard-edit.md §3).
  useLayoutEffect(() => { if (body.current) body.current.inert = editing }, [editing])
  const reading = readingWorkspace(workspace, widget.source)
  const source = reading.pages.find(p => p.id === widget.source)
  const viewId = view.id, id = widget.id
  const swap = (withId: string) => () => void send(() => ({ kind: 'swapWidget', viewId, widgetId: id, withId }), 'Widget moved').then(() => onMoved?.(id))
  const items: MenuItem[] = [
    { label: 'Duplicate', onSelect: () => void send(() => ({ kind: 'duplicateWidget', viewId, widgetId: id, newId: newId(), newViewId: newId(), newRowId: newId() }), 'Widget duplicated') },
    ...(previous ? [{ label: phone ? 'Move up' : 'Move left', onSelect: swap(previous) }] : []),
    ...(next ? [{ label: phone ? 'Move down' : 'Move right', onSelect: swap(next) }] : []),
    // Rows aren't visible at 390, so neither row item shows there (§3).
    ...(!phone && row.widgets.length > 1 ? [{ label: 'Move to its own row', onSelect: () => void send(() => ({ kind: 'moveWidget', viewId, widgetId: id, toRowId: null, newRowId: newId(), rowBeforeId: rowBelow?.id ?? null, beforeId: null }), 'Widget moved') }] : []),
    ...(!phone && rowAbove && rowAbove.widgets.length < dashboardLimits.perRow ? [{ label: 'Join the row above', onSelect: () => void send(() => ({ kind: 'moveWidget', viewId, widgetId: id, toRowId: rowAbove.id, beforeId: null }), 'Widget moved') }] : []),
    { label: 'Remove', danger: true, onSelect: () => void send(() => ({ kind: 'removeWidget', viewId, widgetId: id }), 'View removed') },
  ]
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!editing || e.target !== e.currentTarget) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); void send(() => ({ kind: 'removeWidget', viewId, widgetId: id }), 'View removed') }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector<HTMLButtonElement>('.dashboard-widget-more')?.click() }
  }
  const label = source && isDatabase(source) ? `${sourceTitle(source)} · ${widget.view.name}` : widget.view.name
  return <section className="dashboard-widget" data-widget={id} style={{ ['--widget-width' as string]: width }} aria-label={label} tabIndex={editing ? 0 : undefined} onKeyDown={onKeyDown} {...(onPointerDown ? { onPointerDown } : {})}>
    {split !== undefined && <SplitHandle row={row} k={split} viewId={viewId} send={send} />}
    {editing && <span className="dashboard-widget-menu"><RowMenu label={`Actions for ${label}`} triggerClass="dashboard-widget-more" groups={[{ items }]} /></span>}
    <div ref={body} className="dashboard-widget-body">
      {!source || !isDatabase(source)
        ? <><div className="database-title-row"><span className="database-title is-static">{widget.view.name}</span></div><p className="database-empty">Source deleted{editing ? '' : <> · <button type="button" className="app-link" onClick={() => void send(() => ({ kind: 'removeWidget', viewId, widgetId: id }), 'View removed')}>Remove</button></>}</p></>
        : source.trashedAt ? <TrashedSource db={source} label={widget.view.name} />
        : <Lazy id={blockId} phone={Boolean(phone)}>{phone
            ? <PhoneClip id={blockId}><WidgetView workspace={reading} source={source} host={host} view={view} widget={widget} blockId={blockId} /></PhoneClip>
            : <WidgetView workspace={reading} source={source} host={host} view={view} widget={widget} blockId={blockId} />}</Lazy>}
    </div>
  </section>
}

/** A widget's linked view: registered by its block and widget, so two blocks showing one dashboard each act on their own (Lead 3e548c4e). */
function WidgetView({ workspace, source, host, view, widget, blockId }: { workspace: Workspace; source: DatabasePage; host: DatabasePage; view: View; widget: DashboardWidget; blockId: string }) {
  // Drawn through its own filter and the dashboard's rules that apply here, as two whole groups; neither is saved into the other (§4).
  const dashboard = view.dashboard ?? { rows: [] }
  const { applied } = widgetRules(dashboard, widget, source.database)
  const drawn = filteredView(widget.view, applied, Boolean(dashboard.filterAny))
  const label = filterLabel(dashboard, widget, source.database), hostBlock = blockId.slice(0, blockId.indexOf('|widget:'))
  const send = useDashboardRun(host.id, view.id)
  // Built from the widget as the workspace holds it when it goes, so it carries only this edit.
  const change: ChangeView = (build, notice) => void send(dashboard => {
    const now = findWidget(dashboard, widget.id)?.widget
    return now ? { kind: 'updateWidget', viewId: view.id, widgetId: widget.id, fields: build(now.view) } : null
  }, notice)
  const json = JSON.stringify(widget.view)
  useLayoutEffect(() => { setLinkedBlock(blockId, { view: widget.view, json, change }) })
  useLayoutEffect(() => () => setLinkedBlock(blockId, null), [blockId])
  // Its heading is its database, and its tab is its view ("Table"), as a linked view's is (Jazz 6f0ebb20).
  return <LaidOutView workspace={workspace} db={source} view={drawn} changeView={change} blockId={blockId} pageDate={null} cap={rowCaps.inline}
    linked={{ title: sourceTitle(source), rename: () => {}, source: <SourceLine workspace={workspace} db={source} />, fixedTitle: true,
      ...(label ? { after: <button type="button" className="app-link dashboard-filter-label" onClick={() => { openDashboardFilterFrom(widget.id); openDatabaseMenu(hostBlock, host.id, 'filter') }}>{label}</button> } : {}) }} />
}

/** `+ Add widget`: a database (To-dos too) and its first view a widget can be, as a full-width row at the end. */
function AddWidget({ workspace, onPick }: { workspace: Workspace; onPick: (source: string, view: View) => void }) {
  const [open, setOpen] = useState(false)
  const sources = [
    ...readingWorkspace(workspace, todosSourceId).pages.filter((p): p is DatabasePage => p.id === todosSourceId && isDatabase(p)),
    ...workspace.pages.filter((p): p is DatabasePage => isDatabase(p) && !p.trashedAt && !p.database.fixed),
  ]
  if (!open) return <button type="button" className="dashboard-add" onClick={() => setOpen(true)}>+ Add widget</button>
  return <div className="dashboard-add-pick app-menu" role="menu" aria-label="Add widget" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }}>
    {sources.map(s => <button key={s.id} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(s.id, firstWidgetView(s.database, newId())) }}>{s.id === todosSourceId ? todosTitle : displayPageTitle(s)}</button>)}
    <button type="button" role="menuitem" onClick={() => setOpen(false)}>Cancel</button>
  </div>
}

/** The height each widget was last drawn at, for the session: one that loads late holds it, so nothing below jumps (Jazz 352627d8). */
const lastHeights = new Map<string, number>()
/** A widget's content, drawn once it's near the screen (G6-7): until then its place holds its last height, 360 px at least the first time. */
function Lazy({ id, phone, children }: { id: string; phone: boolean; children: React.ReactNode }) {
  const holder = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = holder.current
    if (near || !el) return
    const seen = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setNear(true) }, { rootMargin: '300px 0px' })
    seen.observe(el)
    return () => seen.disconnect()
  }, [near])
  useEffect(() => {
    const el = holder.current
    if (!near || !el) return
    const keep = new ResizeObserver(() => { if (el.offsetHeight) lastHeights.set(id, el.offsetHeight) })
    keep.observe(el)
    return () => keep.disconnect()
  }, [near, id])
  return <div ref={holder} className="dashboard-lazy" style={near ? undefined : { minHeight: phone ? Math.max(360, lastHeights.get(id) ?? 0) : undefined }} data-loaded={near || undefined}>{near ? children : null}</div>
}

/** Opened with Show more, for the session (§7). */
const openWidgets = new Set<string>()
/** At 390 a widget's content up to 360 px, then a fade and Show more; it never scrolls down inside, so a thumb can't get trapped there. */
function PhoneClip({ id, children }: { id: string; children: React.ReactNode }) {
  const body = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(() => openWidgets.has(id))
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const measure = () => setOver(el.scrollHeight > 360 + 1)
    measure()
    const seen = new ResizeObserver(measure)
    seen.observe(el)
    for (const child of el.children) seen.observe(child)
    return () => seen.disconnect()
  }, [])
  const toggle = () => { const next = !open; if (next) openWidgets.add(id); else openWidgets.delete(id); setOpen(next) }
  return <>
    <div ref={body} className={`dashboard-clip${over && !open ? ' is-clipped' : ''}`}>{children}</div>
    {over && <button type="button" className="app-link dashboard-more" aria-expanded={open} onClick={toggle}>{open ? 'Show less' : 'Show more'}</button>}
  </>
}

/** A rule's value as its chip says it: "Idea, Done", a number or words; nothing for "is empty". */
function ruleValueWords(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.length ? ` ${value.join(', ')}` : ''
  if (value === true) return ' checked'
  if (value === false) return ' unchecked'
  if (typeof value === 'object') return ` ${(value as { date?: string }).date ?? ''}`
  return ` ${String(value)}`
}
