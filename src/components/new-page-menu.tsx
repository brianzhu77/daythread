import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PlusIcon } from './icons'
import { holdKeyboard } from './keyboard'
import { chooseCsv } from './csv-import'
import type { Action } from '../domain/types'

/** Pages' `+` → Database, or → Dashboard: a database opening on a dashboard of one widget, its own Table (G6-1). */
export const newDatabaseAction = (pageId: string, dashboard: boolean): Action => ({
  type: 'create-database', pageId, homeBlockId: null, title: '',
  ...(dashboard ? { dashboard: { viewId: crypto.randomUUID(), rowId: crypto.randomUUID(), widgetId: crypto.randomUUID(), widgetViewId: crypto.randomUUID() } } : {}),
})

/** Pages' `+` (design §3.1): Page first (Enter takes it), then Database and Dashboard. */
export function NewPageMenu({ onPage, onDatabase, onDashboard, className = 'round-add', children = <PlusIcon /> }: { onPage: () => void; onDatabase: () => void; onDashboard: () => void; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  // Both open a new page with the caret in its title; the keyboard has to be raised inside this tap (holdKeyboard).
  const pick = (f: () => void) => { setOpen(false); holdKeyboard(); f() }
  return <div className="new-page-menu" ref={ref}>
    <button type="button" className={className} aria-label="New page" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>{children}</button>
    {open && <div className="app-menu new-page-menu-list" role="menu" onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>
      <button type="button" role="menuitem" autoFocus onClick={() => pick(onPage)}>Page</button>
      <button type="button" role="menuitem" onClick={() => pick(onDatabase)}>Database</button>
      <button type="button" role="menuitem" onClick={() => pick(onDashboard)}>Dashboard</button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); chooseCsv({ kind: 'new' }) }}>Import CSV</button>
    </div>}
  </div>
}

