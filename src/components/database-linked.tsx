// Linked views (design §9): the same rows in another block, with its own view; and the `/` Database picker that makes one.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { isDatabase, type Database } from '../domain/database'
import { linkedViewOf, linkedViewJson, type LinkedView } from '../domain/linked-view'
import type { Page, Workspace } from '../domain/types'
import { LaidOutView, rowCaps, setLinkedBlock, type BlockActions, type ChangeView } from './database-block'
import { displayPageTitle } from './page-title'
import { useWorkspace } from './use-day'

type DatabasePage = Page & { database: Database }

/** "↳ from Reading list · in Books": tap opens the source (§9.2). */
export function SourceLine({ workspace, db }: { workspace: Workspace; db: DatabasePage }) {
  const navigate = useNavigate()
  const host = db.parentId ? workspace.pages.find(p => p.id === db.parentId) : undefined
  return <button type="button" className="database-source" onClick={() => void navigate({ to: '/pages', search: { page: db.id } })}>
    ↳ from {displayPageTitle(db)}{host ? ` · in ${displayPageTitle(host)}` : ''}
  </button>
}

/** A view whose database is in Trash: its title and one line, and nothing to edit (§9.3). */
export function TrashedSource({ db, label }: { db: DatabasePage; label: string }) {
  const { run } = useWorkspace()
  return <>
    <div className="database-title-row"><span className="database-title is-static">{label}</span></div>
    <p className="database-empty">{displayPageTitle(db)} is in Trash · <button type="button" className="app-link" onClick={() => void run({ type: 'restore-page', pageId: db.id }, { text: `${displayPageTitle(db)} restored` })}>Restore</button></p>
  </>
}

/** A block that isn't its database's home: the source's rows through the block's own view. */
export function LinkedDatabase({ workspace, db, blockId, json, pageDate, actions }: { workspace: Workspace; db: DatabasePage; blockId: string; json: string; pageDate: string | null; actions?: BlockActions | null }) {
  const view: LinkedView = linkedViewOf(db.database, json)
  const change: ChangeView = build => actions?.updateLinkedView(blockId, current => {
    const now = linkedViewOf(db.database, current)
    return JSON.stringify({ ...now, ...build(now) })
  })
  const rename = (title: string) => actions?.updateLinkedView(blockId, current => {
    const { title: _old, ...now } = linkedViewOf(db.database, current)
    return JSON.stringify(title && title !== displayPageTitle(db) ? { ...now, title } : now)
  })
  // The menu lives outside the editor, and finds this block's view here.
  useLayoutEffect(() => { setLinkedBlock(blockId, { view, json, change }) })
  useLayoutEffect(() => () => setLinkedBlock(blockId, null), [blockId])
  if (db.trashedAt) return <TrashedSource db={db} label={view.title || displayPageTitle(db)} />
  return <LaidOutView workspace={workspace} db={db} view={view} changeView={change} blockId={blockId} pageDate={pageDate} cap={rowCaps.inline}
    linked={{ title: view.title ?? displayPageTitle(db), rename, source: <SourceLine workspace={workspace} db={db} /> }} />
}

/** Choosing Database in `/` (design §3.1): Enter takes New database; typing filters the ones he has; picking one makes a linked view. */
export function DatabasePicker({ workspace, at, allowNew, onNew, onPick, onClose }: { workspace: Workspace; at: { top: number; left: number }; allowNew: boolean; onNew(): void; onPick(db: DatabasePage, view: string): void; onClose(): void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const wide = typeof window === 'undefined' || window.matchMedia('(min-width: 900px)').matches
  useEffect(() => { if (wide) field.current?.focus() }, [wide])
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [onClose])
  const q = query.trim().toLocaleLowerCase()
  const sources = workspace.pages.filter((p): p is DatabasePage => isDatabase(p) && !p.trashedAt && (!q || displayPageTitle(p).toLocaleLowerCase().includes(q)))
  const items = [...(allowNew && !q ? [null] : []), ...sources]
  const take = (item: DatabasePage | null | undefined) => {
    if (item) onPick(item, linkedViewJson(item.database.views[0]!))
    else if (allowNew) onNew()
    else onClose()
  }
  return <>
    <div className="database-menu-scrim" aria-hidden="true" onClick={onClose} />
    <div ref={panel} className="app-menu database-menu database-picker" role="dialog" aria-label="Database" style={{ position: 'fixed', top: at.top, left: at.left }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
        else if (e.key === 'Enter') { e.preventDefault(); take(items[active]) }
      }}>
      <input ref={field} className="database-menu-field" aria-label="Find a database" placeholder="Find a database" value={query} onChange={e => { setQuery(e.target.value); setActive(0) }} />
      {items.map((item, i) => item
        ? <button key={item.id} type="button" role="menuitem" className={i === active ? 'is-active' : ''} onClick={() => take(item)}>
            <span>{displayPageTitle(item)}</span><span className="database-menu-quiet">{hostName(workspace, item)}</span>
          </button>
        : <button key="new" type="button" role="menuitem" className={i === active ? 'is-active' : ''} onClick={() => take(null)}><span>New database</span><span className="database-menu-quiet">↵</span></button>)}
      {items.length === 0 && <p className="database-menu-quiet">No database by that name</p>}
    </div>
  </>
}
function hostName(ws: Workspace, db: DatabasePage): string {
  const host = db.parentId ? ws.pages.find(p => p.id === db.parentId) : undefined
  return host ? `in ${displayPageTitle(host)}` : 'full page'
}
