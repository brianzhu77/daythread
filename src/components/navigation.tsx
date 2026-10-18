import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { CaptureBar, CaptureReceipts } from './capture'
import { longLabel, todayIso } from './dates'
import { CalendarIcon, PagesIcon, PlusIcon, ReviewIcon, TasksIcon, TodayIcon } from './icons'
import type { LocalDate, Page } from '../domain/types'
import { useDay, useWorkspace } from './use-day'
import { useCreatePage } from './pages-screen'

// Highlight only where you are: Today is today's page, not any day (another day highlights its Days row, or nothing).
const destinations = [
  { to: '/', label: 'Today', Icon: TodayIcon, match: (path: string, today: LocalDate) => path === '/' || path === `/day/${today}` },
  { to: '/tasks', label: 'Tasks', Icon: TasksIcon, match: (path: string) => path.startsWith('/tasks') },
  { to: '/calendar', label: 'Calendar', Icon: CalendarIcon, match: (path: string) => path.startsWith('/calendar') },
  // Tags is part of Pages (tags-r3), so its screens keep Pages highlighted.
  { to: '/pages', label: 'Pages', Icon: PagesIcon, match: (path: string) => path.startsWith('/pages') || path.startsWith('/tags') },
] as const

/** Sidebar on laptop, floating tab capsule + capture button on phone (craft-v1 §3). CSS picks one. */
export function Navigation() {
  const path = useRouterState({ select: s => s.location.pathname })
  const [today] = useState(todayIso)
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
            <Link key={to} to={to} className="side-row" aria-current={match(path, today) ? 'page' : undefined}>
              <Icon />
              {label}
            </Link>
          ))}
          <Link to="/review" className="side-row" aria-current={path.startsWith('/review') ? 'page' : undefined}>
            <ReviewIcon />
            Review
          </Link>
        </nav>
        <DayList path={path} today={today} />
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

/** Something was written or tracked on the page; a page created by opening or browsing a day has neither. */
function hasContent(page: Page): boolean {
  return Boolean(page.reviewText.trim()) || page.sections.some(s => s.blocks.some(b => b.kind === 'task' || b.text.trim()))
}

/**
 * The sidebar's Days group (craft-v1 §3.2): past days with content, newest first.
 * Today is the first nav item, and future pages open from the Calendar.
 */
function DayList({ path, today }: { path: string; today: LocalDate }) {
  const { workspace } = useWorkspace()
  if (!workspace) return null
  const days = workspace.pages
    .filter(p => p.type === 'daily' && p.date && p.date < today && hasContent(p))
    .map(p => p.date!)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 14)
  return (
    <div className="side-group">
      {days.length > 0 && <p className="side-label">Days</p>}
      {days.map(d => (
        <Link key={d} to="/day/$date" params={{ date: d }} className="side-row small" aria-current={path === `/day/${d}` ? 'page' : undefined}>
          {longLabel(d)}
        </Link>
      ))}
      <p className="side-label">Pages</p>
      {workspace?.pages.filter(p => p.type === 'document').map(p => <a className="side-row small" href={`/pages?page=${encodeURIComponent(p.id)}`} key={p.id}>{p.title}</a>)}
      <NewPageRow />
    </div>
  )
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
