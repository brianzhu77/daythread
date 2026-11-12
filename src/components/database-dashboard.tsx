// Dashboard (docs/design/dashboard.md, dashboard-edit.md): rows of widgets, each a linked view of any database with its own
// copy of its settings. Read mode draws each as any linked view; edit mode draws a frame over them, makes their content
// inert, and arranges them with the dashboard's own commands (dashboard.ts), one command and one Undo each.
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { dashboardLimits, findWidget, firstWidgetView, shownWidths, type Dashboard, type DashboardChange, type DashboardRow, type DashboardWidget } from '../domain/dashboard'
import { isDatabase, type Database, type View } from '../domain/database'
import { readingWorkspace, todosSourceId, todosTitle } from '../domain/todos-source'
import type { Page, Workspace } from '../domain/types'
import { DatabaseHeader, LaidOutView, rowCaps, setLinkedBlock, type ChangeView, type DatabaseViewProps } from './database-block'
import { SourceLine, TrashedSource } from './database-linked'
import { displayPageTitle } from './page-title'
import { RowMenu, type MenuItem } from './row-menu'
import { useWorkspace } from './use-day'

type DatabasePage = Page & { database: Database }
type Props = DatabaseViewProps & { view: View; changeView: ChangeView }
const newId = (): string => crypto.randomUUID()

/** The commands' common part, built from the dashboard as the workspace holds it when the command goes. */
function useDashboardRun(hostId: string, viewId: string) {
  const { run } = useWorkspace()
  return (build: (dashboard: Dashboard) => DashboardChange | null, notice?: string) => void run(ws => {
    const host = ws.pages.find(p => p.id === hostId), view = isDatabase(host) ? host.database.views.find(v => v.id === viewId) : undefined
    const change = view?.dashboard ? build(view.dashboard) : null
    return change ? { type: 'change-database', pageId: hostId, change } : null
  }, notice ? r => ({ text: notice, undoOperationId: r.operationId }) : undefined)
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

function FullDashboard({ workspace, db, view, changeView, blockId, showTitle }: Props) {
  const [editing, setEditing] = useState(false)
  const dashboard: Dashboard = view.dashboard ?? { rows: [] }
  const send = useDashboardRun(db.id, view.id)
  const count = dashboard.rows.reduce((n, r) => n + r.widgets.length, 0)
  // Esc leaves edit mode, unless a menu, sheet or drag has it first (dashboard-edit.md §2).
  useEffect(() => {
    if (!editing) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.app-menu, .database-menu, [role=dialog]')) setEditing(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [editing])
  const order = dashboard.rows.flatMap(r => r.widgets.map(w => w.id))
  return <div className={`dashboard${editing ? ' is-editing' : ''}`} data-dashboard={view.id}>
    <div className="dashboard-head">
      <div className="dashboard-head-main"><DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle ?? true} onTitleEnter={() => {}} /></div>
      <button type="button" className={`dashboard-edit${editing ? ' is-on' : ''}`} aria-pressed={editing} onClick={() => setEditing(e => !e)}>{editing ? 'Done' : 'Edit'}</button>
    </div>
    {dashboard.rows.map((row, r) => <div key={row.id} className="dashboard-row" data-row={row.id} style={{ ['--row-height' as string]: `${row.height}px` }}>
      {row.widgets.map((widget, i) => <WidgetFrame key={widget.id} workspace={workspace} host={db} view={view} row={row} widget={widget} width={shownWidths(row)[i]!} editing={editing} blockId={`${blockId}|widget:${widget.id}`}
        previous={order[order.indexOf(widget.id) - 1]} next={order[order.indexOf(widget.id) + 1]} rowAbove={dashboard.rows[r - 1]} rowBelow={dashboard.rows[r + 1]} send={send} />)}
    </div>)}
    {editing && (count >= dashboardLimits.widgets
      ? <p className="dashboard-limit">{dashboardLimits.widgets} widgets at most</p>
      : <AddWidget workspace={workspace} onPick={(source, sourceView) => send(() => ({ kind: 'addWidget', viewId: view.id, widget: { id: newId(), source, view: sourceView }, rowId: null, newRowId: newId(), beforeId: null }), 'Widget added')} />)}
    {!dashboard.rows.length && !editing && <p className="database-empty">No widgets · <button type="button" className="app-link" onClick={() => setEditing(true)}>Edit</button></p>}
  </div>
}

/** One widget: in read mode its linked view as any; in edit mode the same, inert, under a frame with its menu. */
function WidgetFrame({ workspace, host, view, row, widget, width, editing, blockId, previous, next, rowAbove, rowBelow, send }: {
  workspace: Workspace; host: DatabasePage; view: View; row: DashboardRow; widget: DashboardWidget; width: number; editing: boolean; blockId: string
  previous?: string; next?: string; rowAbove?: DashboardRow; rowBelow?: DashboardRow; send: ReturnType<typeof useDashboardRun>
}) {
  const body = useRef<HTMLDivElement>(null)
  // `inert` keeps every click, tap, key and focus out of the content while arranging (dashboard-edit.md §3).
  useLayoutEffect(() => { if (body.current) body.current.inert = editing }, [editing])
  const reading = readingWorkspace(workspace, widget.source)
  const source = reading.pages.find(p => p.id === widget.source)
  const viewId = view.id, id = widget.id
  const items: MenuItem[] = [
    { label: 'Duplicate', onSelect: () => send(() => ({ kind: 'duplicateWidget', viewId, widgetId: id, newId: newId(), newViewId: newId(), newRowId: newId() }), 'Widget duplicated') },
    ...(previous ? [{ label: 'Move left', onSelect: () => send(() => ({ kind: 'swapWidget', viewId, widgetId: id, withId: previous }), 'Widget moved') }] : []),
    ...(next ? [{ label: 'Move right', onSelect: () => send(() => ({ kind: 'swapWidget', viewId, widgetId: id, withId: next }), 'Widget moved') }] : []),
    ...(row.widgets.length > 1 ? [{ label: 'Move to its own row', onSelect: () => send(() => ({ kind: 'moveWidget', viewId, widgetId: id, toRowId: null, newRowId: newId(), rowBeforeId: rowBelow?.id ?? null, beforeId: null }), 'Widget moved') }] : []),
    ...(rowAbove && rowAbove.widgets.length < dashboardLimits.perRow ? [{ label: 'Join the row above', onSelect: () => send(() => ({ kind: 'moveWidget', viewId, widgetId: id, toRowId: rowAbove.id, beforeId: null }), 'Widget moved') }] : []),
    { label: 'Remove', danger: true, onSelect: () => send(() => ({ kind: 'removeWidget', viewId, widgetId: id }), 'View removed') },
  ]
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!editing || e.target !== e.currentTarget) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); send(() => ({ kind: 'removeWidget', viewId, widgetId: id }), 'View removed') }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector<HTMLButtonElement>('.dashboard-widget-more')?.click() }
  }
  return <section className="dashboard-widget" data-widget={id} style={{ ['--widget-width' as string]: width }} aria-label={widget.view.name} tabIndex={editing ? 0 : undefined} onKeyDown={onKeyDown}>
    {editing && <span className="dashboard-widget-menu"><RowMenu label={`Actions for ${widget.view.name}`} triggerClass="dashboard-widget-more" groups={[{ items }]} /></span>}
    <div ref={body} className="dashboard-widget-body">
      {!source || !isDatabase(source)
        ? <><div className="database-title-row"><span className="database-title is-static">{widget.view.name}</span></div><p className="database-empty">Source deleted{editing ? '' : <> · <button type="button" className="app-link" onClick={() => send(() => ({ kind: 'removeWidget', viewId, widgetId: id }), 'View removed')}>Remove</button></>}</p></>
        : source.trashedAt ? <TrashedSource db={source} label={widget.view.name} />
        : <WidgetView workspace={reading} source={source} host={host} view={view} widget={widget} blockId={blockId} />}
    </div>
  </section>
}

/** A widget's linked view: registered by its block and widget, so two blocks showing one dashboard each act on their own (Lead 3e548c4e). */
function WidgetView({ workspace, source, host, view, widget, blockId }: { workspace: Workspace; source: DatabasePage; host: DatabasePage; view: View; widget: DashboardWidget; blockId: string }) {
  const send = useDashboardRun(host.id, view.id)
  // Built from the widget as the workspace holds it when it goes, so it carries only this edit.
  const change: ChangeView = (build, notice) => send(dashboard => {
    const now = findWidget(dashboard, widget.id)?.widget
    return now ? { kind: 'updateWidget', viewId: view.id, widgetId: widget.id, fields: build(now.view) } : null
  }, notice)
  const json = JSON.stringify(widget.view)
  useLayoutEffect(() => { setLinkedBlock(blockId, { view: widget.view, json, change }) })
  useLayoutEffect(() => () => setLinkedBlock(blockId, null), [blockId])
  return <LaidOutView workspace={workspace} db={source} view={widget.view} changeView={change} blockId={blockId} pageDate={null} cap={rowCaps.inline}
    linked={{ title: widget.view.name, rename: name => { if (name.trim() && name !== widget.view.name) change(() => ({ name })) }, source: <SourceLine workspace={workspace} db={source} /> }} />
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
