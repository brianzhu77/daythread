import { Link, useRouterState } from '@tanstack/react-router'
import { rememberOpened, SidebarTree, useToday } from './page-tree'
import { useEffect, useRef, useState } from 'react'
import { CaptureBar, CaptureReceipts } from './capture'
import { todayIso } from './dates'
import { CalendarIcon, PagesIcon, PlusIcon, ReviewIcon, TagsIcon, TasksIcon, TodayIcon } from './icons'
import type { LocalDate } from '../domain/types'
import { useDay, useWorkspace } from './use-day'
import { useCreatePage } from './pages-screen'
import { SidebarTrashRow } from './trash'

// Highlight only where you are: Today is today's page, not any day (another day highlights its Days row, or nothing).
const destinations = [
  { to: '/', label: 'Today', Icon: TodayIcon, match: (path: string, today: LocalDate) => path === '/' || path === `/day/${today}` },
  { to: '/tasks', label: 'Tasks', Icon: TasksIcon, match: (path: string) => path.startsWith('/tasks') },
  { to: '/calendar', label: 'Calendar', Icon: CalendarIcon, match: (path: string) => path.startsWith('/calendar') },
  { to: '/pages', label: 'Pages', Icon: PagesIcon, match: (path: string) => path.startsWith('/pages') },
  // Tags is its own module beside Pages on laptop and phone (Brian 77423ea0, bc661669).
  { to: '/tags', label: 'Tags', Icon: TagsIcon, match: (path: string) => path.startsWith('/tags') },
] as const

/** Sidebar on laptop, floating tab capsule + capture button on phone (craft-v1 §3). CSS picks one. */
export function Navigation() {
  const path = useRouterState({ select: s => s.location.pathname })
  const openPageId = useRouterState({ select: s => (s.location.search as { page?: string }).page })
  const trashView = useRouterState({ select: s => (s.location.search as { view?: string }).view === 'trash' })
  const today = useToday()
  const [captureOpen, setCaptureOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); setCaptureOpen(true) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <aside className="sidebar" aria-label="Navigation">
        <Link to="/" className="brand">
          Daythread
        </Link>
        <nav className="sidebar-nav" aria-label="Main">
          {destinations.map(({ to, label, Icon, match }) => (
            // An open page is highlighted in the tree, so the sidebar's Pages row is only current on the list itself;
            // the Link's own active state has to compare the search too, or it marks the row current anyway.
            <Link key={to} to={to} className="side-row" activeOptions={to === '/pages' ? { exact: true, includeSearch: true } : undefined}
              aria-current={match(path, today) && !(to === '/pages' && (openPageId || trashView)) ? 'page' : undefined}>
              <Icon />
              {label}
            </Link>
          ))}
          <Link to="/review" className="side-row" aria-current={path.startsWith('/review') ? 'page' : undefined}>
            <ReviewIcon />
            Review
          </Link>
        </nav>
        <PageGroups path={path} openPageId={openPageId} trashView={trashView} today={today} />
      </aside>

      <nav className="tab-bar" aria-label="Main">
        <div className="tab-capsule">
          {destinations.map(({ to, label, Icon, match }) => (
            <Link key={to} to={to} className="tab" aria-label={label} aria-current={match(path, today) ? 'page' : undefined}>
              <Icon />
            </Link>
          ))}
        </div>
        <button type="button" className="tab-plus" aria-label="Capture" onClick={() => setCaptureOpen(true)}>
          <PlusIcon />
        </button>
      </nav>

      <button type="button" className="desktop-capture-plus" aria-label="Capture · ⌘J" onClick={() => setCaptureOpen(true)}><PlusIcon /></button>
      {captureOpen && <CaptureSheet onClose={() => setCaptureOpen(false)} />}
    </>
  )
}

/**
 * An action, not a destination: a link to /pages would be marked current (and look selected) on the Pages screen.
 * The new page opens the same way the sidebar's page rows do.
 */
function NewPageRow() {
  const createPage = useCreatePage()
  return <button type="button" className="side-row small" onClick={async () => { const id = await createPage(); if (id) window.location.assign(`/pages?page=${encodeURIComponent(id)}`) }}>＋ New page</button>
}

/** The page on screen: a day page by its date (`/` is today), or the page opened in Pages. */
function PageGroups({ path, openPageId, trashView, today }: { path: string; openPageId?: string; trashView: boolean; today: LocalDate }) {
  const { workspace } = useWorkspace()
  const date = path === '/' ? today : path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/)?.[1]
  const activeId = (date ? workspace?.pages.find(p => p.type === 'daily' && p.date === date)?.id : path.startsWith('/pages') ? openPageId : undefined) ?? null
  useEffect(() => { if (activeId) rememberOpened(activeId) }, [activeId])
  if (!workspace) return null
  // The Trash row is current on the Trash screen and on a trashed page, which has no row in the tree (layout T3/T4).
  const trashOpen = path.startsWith('/pages') && (trashView || Boolean(openPageId && workspace.pages.find(p => p.id === openPageId)?.trashedAt))
  return <SidebarTree workspace={workspace} activeId={activeId} today={today} newPageRow={<><NewPageRow /><SidebarTrashRow current={trashOpen} /></>} />
}

/** Phone capture (craft-v1 §5.3): a bottom sheet with the cursor already in the field. */
function CaptureSheet({ onClose }: { onClose: () => void }) {
  const [today] = useState(todayIso)
  const { run } = useWorkspace()
  const { view, workspace } = useDay(today)
  const page = view?.page ?? null
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (workspace && !page) void run({ type: 'ensure-day', date: today })
  }, [workspace, page, today, run])

  useEffect(() => {
    sheetRef.current?.querySelector('textarea')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [page, onClose])

  return (
    <div className="sheet-scrim" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Capture" ref={sheetRef}>
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-head">
          <h2>Capture</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>
        {page && workspace ? (
          <>
            <CaptureBar page={page} placeholder="What’s on your mind?" />
            <CaptureReceipts page={page} workspace={workspace} />
          </>
        ) : (
          <p className="loading">Opening today…</p>
        )}
      </div>
    </div>
  )
}
