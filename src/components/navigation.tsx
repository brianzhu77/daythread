import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { CaptureBar, CaptureReceipts } from './capture'
import { longLabel, todayIso } from './dates'
import { CalendarIcon, PagesIcon, PlusIcon, ReviewIcon, TasksIcon, TodayIcon } from './icons'
import { useDay, useWorkspace } from './use-day'

const destinations = [
  { to: '/', label: 'Today', Icon: TodayIcon, match: (path: string) => path === '/' || path.startsWith('/day/') },
  { to: '/tasks', label: 'Tasks', Icon: TasksIcon, match: (path: string) => path.startsWith('/tasks') },
  { to: '/calendar', label: 'Calendar', Icon: CalendarIcon, match: (path: string) => path.startsWith('/calendar') },
  { to: '/pages', label: 'Pages', Icon: PagesIcon, match: (path: string) => path.startsWith('/pages') },
] as const

/** Sidebar on laptop, floating tab capsule + capture button on phone (craft-v1 §3). CSS picks one. */
export function Navigation() {
  const path = useRouterState({ select: s => s.location.pathname })
  const [captureOpen, setCaptureOpen] = useState(false)

  return (
    <>
      <aside className="sidebar" aria-label="Navigation">
        <Link to="/" className="brand">
          Daythread
        </Link>
        <nav className="sidebar-nav" aria-label="Main">
          {destinations.map(({ to, label, Icon, match }) => (
            <Link key={to} to={to} className="side-row" aria-current={match(path) ? 'page' : undefined}>
              <Icon />
              {label}
            </Link>
          ))}
          <Link to="/review" className="side-row" aria-current={path.startsWith('/review') ? 'page' : undefined}>
            <ReviewIcon />
            Review
          </Link>
        </nav>
        <DayList path={path} />
      </aside>

      <nav className="tab-bar" aria-label="Main">
        <div className="tab-capsule">
          {destinations.map(({ to, label, Icon, match }) => (
            <Link key={to} to={to} className="tab" aria-label={label} aria-current={match(path) ? 'page' : undefined}>
              <Icon />
            </Link>
          ))}
        </div>
        <button type="button" className="tab-plus" aria-label="Capture" onClick={() => setCaptureOpen(true)}>
          <PlusIcon />
        </button>
      </nav>

      {captureOpen && <CaptureSheet onClose={() => setCaptureOpen(false)} />}
    </>
  )
}

/** Daily pages that exist, newest first: the sidebar's Days group (craft-v1 §3.2). */
function DayList({ path }: { path: string }) {
  const { workspace } = useWorkspace()
  const days = (workspace?.pages ?? [])
    .filter(p => p.type === 'daily' && p.date)
    .map(p => p.date!)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 14)
  if (!days.length) return null
  return (
    <div className="side-group">
      <p className="side-label">Days</p>
      {days.map(d => (
        <Link key={d} to="/day/$date" params={{ date: d }} className="side-row small" aria-current={path === `/day/${d}` ? 'page' : undefined}>
          {longLabel(d)}
        </Link>
      ))}
      <p className="side-label">Pages</p>
      <p className="side-note">Nested pages come with v0.4.</p>
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
