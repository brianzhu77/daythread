// Feed (docs/design/feed.md): the rows themselves, read one above another, like a blog. Each card is its title, the view's
// properties on one line, and the row's body drawn read only (feed-body.tsx), capped by height with Show more. `+ New` is at
// the top and opens the row, as a card's body can't be written in. Order is the view's sort; groups fold as in a list.
import { useNavigate } from '@tanstack/react-router'
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { threadsShownOn } from '../domain/comments'
import { cellValue, databaseRows, isEmptyValue, isReadOnly, readValue, sectionKey, viewColumns, viewGroups, viewRows, viewSubGroups, type View } from '../domain/database.ts'
import { formulaErrorOf } from '../domain/formula'
import type { Page, Workspace } from '../domain/types'
import { openComments } from './comments-pane'
import { DatabaseHeader, GroupName, HiddenGroups, NewRow, rowTint, shownRaw, SubGroupHead, useAddRow, useCommitCell, useFolds, useGroupLimits, useOpenRow, usePendingCells, useReturnedRow, ViewNotes, pendingCells, pendingKey, type ChangeView, type DatabaseViewProps } from './database-block'
import { todayIso } from './dates'
import { FeedBody } from './feed-body'
import { ChevronRightIcon, PageEmoji } from './icons'
import { displayPageTitle } from './page-title'
import { openPeek } from './peek-state'
import { PropertyCell, PropertyCheckbox, useWide } from './property-editors'

/** Cards opened with Show more, for the session: coming back from a row finds them as they were. */
const expanded = new Set<string>()
/** Under about three lines hidden, a card shows them all rather than hide so little. */
const smallestHidden = 72

/** A card's body, capped by height (288 px at 1280, 384 at 390, from the stylesheet) with a fade and Show more, which opens it in place. */
function Clipped({ id, title, children }: { id: string; title: () => HTMLElement | null; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(() => expanded.has(id))
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const measure = () => { const cap = parseFloat(getComputedStyle(el).getPropertyValue('--feed-cap')) || 288; setOver(el.scrollHeight > cap + smallestHidden) }
    measure()
    const seen = new ResizeObserver(measure)
    seen.observe(el)
    for (const child of el.children) seen.observe(child)
    return () => seen.disconnect()
  }, [])
  const toggle = () => {
    const next = !open
    if (next) expanded.add(id); else expanded.delete(id)
    setOpen(next)
    // Show less keeps the card's title on screen, so the reader isn't left somewhere further down.
    if (!next) requestAnimationFrame(() => { const t = title(); if (t && t.getBoundingClientRect().top < 0) t.scrollIntoView({ block: 'start' }) })
  }
  return <>
    <div ref={body} className={`feed-clip${over && !open ? ' is-clipped' : ''}`}>{children}</div>
    {over && <button type="button" className="feed-more" aria-expanded={open} onClick={toggle}>{open ? 'Show less' : 'Show more'}</button>}
  </>
}

function Card({ workspace, db, view, row, blockId, group, returned, context }: { workspace: Workspace; db: DatabaseViewProps['db']; view: View; row: Page; blockId: string; group?: string; returned: boolean; context: { today: string; pageDate: string | null; weekStart: 0 | 1 } }) {
  const wide = useWide()
  const commit = useCommitCell()
  const openRow = useOpenRow(view, undefined, blockId)
  const title = useRef<HTMLButtonElement>(null)
  const tint = rowTint(db.database, view, row, context)
  const threads = threadsShownOn(workspace, row.id).filter(t => !t.resolvedAt).length
  const columns = viewColumns(db.database, view)
  const values = columns.flatMap(({ property }) => {
    const pending = pendingCells.get(pendingKey(row.id, property.id))
    const value = pending ? readValue(property, pending.raw) : cellValue(db.database, row, property.id)
    if (property.type === 'checkbox') return [<span key={property.id} className="feed-value is-check"><PropertyCheckbox checked={value === true} label={`${property.name}: ${displayPageTitle(row)}`} disabled={isReadOnly(property)} onToggle={next => commit(db, row, property.id, next ? true : undefined)} />{property.name}</span>]
    return isEmptyValue(value) && !formulaErrorOf(row, property) ? [] : [<span key={property.id} className="feed-value"><PropertyCell property={property} value={value} row={row} today={context.today} /></span>]
  })
  return <article data-row={row.id} {...(group !== undefined ? { 'data-group': group } : {})} {...(tint ? { style: tint.style } : {})} className={`feed-card${tint ? tint.className : ''}${returned ? ' is-returned' : ''}`}>
    <button type="button" ref={title} className={`feed-title${row.title ? '' : ' is-placeholder'}`} onClick={() => openRow(row.id)}>{row.icon && <PageEmoji icon={row.icon} className="database-row-icon" />}{row.title || 'Untitled'}</button>
    {(values.length > 0 || threads > 0) && <div className="feed-values">
      {values}
      {threads > 0 && <button type="button" className="feed-comments" onClick={() => openComments(row.id)}>{threads === 1 ? '1 comment' : `${threads} comments`}</button>}
    </div>}
    <Clipped id={`${blockId}|${row.id}`} title={() => title.current}><FeedBody workspace={workspace} row={row} openRow={() => openRow(row.id)} /></Clipped>
  </article>
}

export function DatabaseFeed({ workspace, db, view, changeView, blockId, pageDate, cap, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const wide = useWide()
  const navigate = useNavigate()
  const today = todayIso()
  const weekStart = workspace.weekStart ?? 0
  const context = useMemo(() => ({ today, pageDate, weekStart }), [today, pageDate, weekStart])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  const openRow = useOpenRow(view, rows, blockId)
  usePendingCells()
  const groups = viewGroups(db.database, view, rows, shownRaw, weekStart)
  const { limitOf, showMore } = useGroupLimits(`${blockId}|${view.id}`, cap)
  const { folded, toggle } = useFolds(blockId, view.id)
  const returned = useReturnedRow(rows)
  const [limit, setLimit] = useState(cap)
  // A new row opens: in a peek with room for one, on its page on a phone, where its title takes the caret.
  const addRow = useAddRow(db, view, context, blockId, pageId => requestAnimationFrame(() => { if (wide) openPeek(navigate, pageId, undefined, false); else openRow(pageId, 'title') }))
  const card = (row: Page, group?: string) => <Card key={`${group ?? ''}:${row.id}`} workspace={workspace} db={db} view={view} row={row} blockId={blockId} {...(group !== undefined ? { group } : {})} returned={returned === row.id} context={context} />
  return <div className="database-table-wrap">
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addRow(groups?.shown[0]?.key) }} />
    {/* Newest usually comes first, so + New is at the top. */}
    {!groups && <div className="feed-new"><NewRow db={db} blockId={blockId} addRow={addRow} /></div>}
    <div className="database-feed">
      {groups ? groups.shown.map(group => {
        const isFolded = folded.has(group.key)
        const subs = viewSubGroups(db.database, view, group.rows, shownRaw, weekStart)
        const body = (key: string, all: readonly Page[]) => {
          if (folded.has(key)) return null
          const shown = all.slice(0, limitOf(key))
          return <>
            <div className="feed-new"><NewRow db={db} blockId={blockId} addRow={addRow} group={key} /></div>
            {shown.map(row => card(row, key))}
            {all.length > shown.length && <button type="button" className="database-more" onClick={() => showMore(key)}>Show 25 more</button>}
          </>
        }
        return <Fragment key={group.key}>
          <div className="database-group-inner">
            <button type="button" className="database-group-fold" aria-expanded={!isFolded} onClick={() => toggle(group.key)}>
              <ChevronRightIcon /><GroupName groups={groups} group={group} /><span className="database-group-count">· {group.rows.length}</span>
            </button>
          </div>
          {!isFolded && (subs && group.rows.length
            ? subs.shown.map(sub => { const key = sectionKey(group.key, sub.key); return <Fragment key={key}><SubGroupHead groups={subs} group={sub} isFolded={folded.has(key)} onToggle={() => toggle(key)} />{body(key, sub.rows)}</Fragment> })
            : body(group.key, group.rows))}
        </Fragment>
      }) : rows.slice(0, limit).map(row => card(row))}
    </div>
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
    {groups && <HiddenGroups groups={groups} changeView={changeView} />}
    {!groups && rows.length > limit && <button type="button" className="database-more" onClick={() => setLimit(limit + 25)}>Show 25 more</button>}
  </div>
}
