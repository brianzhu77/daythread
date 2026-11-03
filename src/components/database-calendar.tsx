// Databases R3: the Calendar view (design §7.2, R3-1). A month of days at 1280, up to 3 row titles on each, then "+2"; on the
// phone the month with dots, and the chosen day's rows under it. Rows with no date stay in reach in one line under the month.
// A row drags to another day at 1280, moving its date and keeping its time and length. Which month is showing is this tab's,
// never a save, like which view is showing.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { calendarRows, databaseRows, movedDate, rowMatches, titleId, viewDateBy, viewRows, type Json, type View } from '../domain/database.ts'
import type { LocalDate, Page } from '../domain/types'
import { blockActions, cellKey, DatabaseHeader, pendingCells, setOpenCell, shownRaw, useAddRow, useCommitCell, useOpenRow, usePendingCells, useReturnedRow, useUndoKey, useViewClipboard, ViewNotes, type ChangeView, type DatabaseViewProps } from './database-block'
import { openDatabaseMenu } from './database-menu'
import { addDays, fromIso, longLabel, todayIso } from './dates'
import { ArrowLeftIcon, ArrowRightIcon } from './icons'
import { useWide } from './property-editors'
import { useWorkspace } from './use-day'

/** Titles a day shows at 1280 (design §7.2) before "+2". */
const perDay = 3
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Where a block's calendar is, for this tab: BlockNote may draw a block again, which would otherwise send him back to this month. */
const places = new Map<string, { month: string; chosen: LocalDate | null; undatedOpen: boolean }>()

const monthOf = (day: LocalDate) => day.slice(0, 7)
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7)
}
/** The weeks a month's grid draws: whole weeks from Sunday, as the date picker's. */
function monthDays(month: string): LocalDate[] {
  const first = `${month}-01`
  const start = addDays(first, -fromIso(first).getDay())
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1)
  // Rounded first: a day with a clock change isn't 24 hours.
  const count = Math.ceil((Math.round((fromIso(last).getTime() - fromIso(start).getTime()) / 86_400_000) + 1) / 7) * 7
  return Array.from({ length: count }, (_, i) => addDays(start, i))
}

export function DatabaseCalendar({ workspace, db, view, changeView, blockId, pageDate, cap, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const { latest } = useWorkspace()
  const commit = useCommitCell()
  const openRow = useOpenRow()
  const undoKey = useUndoKey()
  const wide = useWide()
  const today = todayIso()
  const context = useMemo(() => ({ today, pageDate }), [today, pageDate])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  usePendingCells()
  const returned = useReturnedRow(rows)
  const property = viewDateBy(db.database, view)

  const placeKey = `${blockId}|${view.id}`
  const [place, setPlaceState] = useState(() => places.get(placeKey) ?? { month: monthOf(pageDate ?? today), chosen: wide ? null as LocalDate | null : pageDate ?? today, undatedOpen: false })
  const setPlace = (next: Partial<typeof place>) => setPlaceState(now => { const merged = { ...now, ...next }; places.set(placeKey, merged); return merged })
  const days = monthDays(place.month)
  const { days: onDays, undated } = calendarRows(property, rows, days[0]!, days.at(-1)!, shownRaw)
  const [undatedLimit, setUndatedLimit] = useState(cap)

  const wrap = useRef<HTMLDivElement>(null)
  useViewClipboard(wrap)
  const addRow = useAddRow(db, view, context, blockId, pageId => requestAnimationFrame(() => setOpenCell({ blockId, databaseId: db.id, rowId: pageId, columnId: titleId })))
  const addOn = (day: LocalDate) => { setPlace({ chosen: day }); addRow(undefined, property ? { [property.id]: { start: day } as unknown as Json } : undefined) }

  /** A row's date moved, one change with one Undo; the notice says where, and if the filter then hides it. */
  const moveTo = (row: Page, from: LocalDate | null, to: LocalDate) => {
    if (!property || from === to) return
    const value = movedDate(property, shownRaw(row, property.id), from, to)
    const hidden = !rowMatches(db.database, { ...row, values: { ...row.values, [property.id]: value as unknown as Json } } as Page, view.filter, context)
    commit(db, row, property.id, value as unknown as Json, `Moved to ${longLabel(to)}${hidden ? " · hidden by this view's filter" : ''}`)
  }

  // Dragging at 1280: a press on a title past 4 px; nothing moves until the drop, so a redraw can't lose it.
  const [drag, setDrag] = useState<{ rowId: string; over: LocalDate | null } | null>(null)
  const justDragged = useRef(false)
  const startDrag = (e: ReactPointerEvent, row: Page, from: LocalDate | null) => {
    if (e.button !== 0 || e.pointerType !== 'mouse' || !property) return
    const start = { x: e.clientX, y: e.clientY }
    let lifted = false
    const dayAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]')?.dataset.day ?? null
    const finish = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', esc, true) }
    const move = (ev: PointerEvent) => {
      if (!lifted && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= 4) return
      lifted = true
      const over = dayAt(ev.clientX, ev.clientY)
      setDrag(d => (d?.over === over && d.rowId === row.id ? d : { rowId: row.id, over }))
    }
    const up = (ev: PointerEvent) => {
      finish(); setDrag(null)
      if (!lifted) return
      justDragged.current = true; setTimeout(() => { justDragged.current = false })
      const to = dayAt(ev.clientX, ev.clientY)
      if (to) moveTo(row, from, to)
    }
    const cancel = () => { finish(); setDrag(null); if (lifted) { justDragged.current = true; setTimeout(() => { justDragged.current = false }) } }
    const esc = (ev: globalThis.KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); cancel() } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); document.addEventListener('keydown', esc, true)
  }
  // Scrolled or redrawn away, nothing stays lifted.
  useEffect(() => () => setDrag(null), [])

  // A row moved by keys is drawn in its new day: the focus goes with it, so ⌘Z and the next arrow still work.
  const refocus = useRef<{ rowId: string; day: LocalDate } | null>(null)
  useLayoutEffect(() => {
    if (!refocus.current) return
    const el = wrap.current?.querySelector<HTMLElement>(`[data-day="${refocus.current.day}"] [data-chip="${CSS.escape(refocus.current.rowId)}"]`)
    if (el) { el.focus(); refocus.current = null }
  })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (undoKey(e)) return
    const target = e.target as HTMLElement
    // ⌘A here selects nothing: the browser's select-all would take the page around it, and the next key replace it.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && target.tagName !== 'INPUT') { e.preventDefault(); return }
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); blockActions.get(blockId)?.select(blockId); return }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!step) return
    // Shift-arrows move a row's date; arrows move between days.
    const chip = target.closest<HTMLElement>('[data-chip]')
    if (chip && e.shiftKey) {
      const row = rows.find(r => r.id === chip.dataset.chip), from = chip.dataset.from
      if (row && from) { e.preventDefault(); const to = addDays(from, step); refocus.current = { rowId: row.id, day: to }; moveTo(row, from, to); if (!days.includes(to)) setPlace({ month: monthOf(to) }) }
      return
    }
    const day = target.closest<HTMLElement>('[data-day]')?.dataset.day
    if (!day) return
    const next = addDays(day, step)
    e.preventDefault()
    if (monthOf(next) !== place.month && !days.includes(next)) setPlace({ month: monthOf(next) })
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>(`[data-day="${next}"] .database-day-number`)?.focus())
  }

  const rowLine = (row: Page, from: LocalDate | null) => {
    const unsaved = [...pendingCells.values()].some(p => p.failed && p.rowId === row.id)
    return <div key={row.id} className={`database-day-row${returned === row.id ? ' is-returned' : ''}`} data-row={row.id}>
      <button type="button" className={`database-day-title${row.title ? '' : ' is-placeholder'}`} data-chip={row.id} data-from={from ?? undefined} data-cell={cellKey({ blockId, databaseId: db.id, rowId: row.id, columnId: titleId })}
        onPointerDown={e => startDrag(e, row, from)} onMouseDown={e => e.preventDefault()} onClick={() => { if (!justDragged.current) openRow(row.id) }}>{row.title || 'Untitled'}</button>
      {unsaved && <span className="database-card-unsaved">Not saved</span>}
    </div>
  }
  const chosenRows = place.chosen ? onDays.get(place.chosen) ?? [] : []
  const showsChosen = Boolean(place.chosen) && (!wide || chosenRows.length > perDay)
  const monthLabel = fromIso(`${place.month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const thisMonth = monthOf(today)

  return <div className="database-table-wrap" ref={wrap} onKeyDown={onKeyDown}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addOn(place.chosen ?? today) }} />
    {!property && <p className="database-empty"><button type="button" className="app-link" onClick={() => openDatabaseMenu(blockId, db.id, 'layout')}>Choose a date property</button></p>}
    <div className="database-calendar-head">
      <span className="database-calendar-month">{monthLabel}</span>
      {place.month !== thisMonth && <button type="button" className="database-calendar-today" onClick={() => setPlace({ month: thisMonth, chosen: today })}>Today</button>}
      <button type="button" className="database-calendar-arrow" aria-label="Previous month" onClick={() => setPlace({ month: shiftMonth(place.month, -1) })}><ArrowLeftIcon /></button>
      <button type="button" className="database-calendar-arrow" aria-label="Next month" onClick={() => setPlace({ month: shiftMonth(place.month, 1) })}><ArrowRightIcon /></button>
    </div>
    <div className={`database-calendar${drag ? ' is-dragging' : ''}`} role="grid" aria-label={monthLabel}>
      {weekdays.map(d => <div key={d} className="database-calendar-weekday" role="columnheader">{wide ? d : d[0]}</div>)}
      {days.map((day, i) => {
        const here = onDays.get(day) ?? []
        const more = here.length - perDay
        const classes = `database-day${monthOf(day) !== place.month ? ' is-other-month' : ''}${day === today ? ' is-today' : ''}${day === place.chosen ? ' is-chosen' : ''}${drag?.over === day ? ' is-drop' : ''}`
        return <div key={day} role="gridcell" data-day={day} className={classes}>
          <button type="button" className="database-day-number" data-nav={day === (place.month === thisMonth ? today : `${place.month}-01`) ? '0:0' : undefined} tabIndex={i === 0 ? 0 : -1} aria-label={longLabel(day)}
            onClick={() => setPlace({ chosen: day })}>{Number(day.slice(8))}</button>
          {wide
            ? <>
                {here.slice(0, perDay).map(row => rowLine(row, day))}
                {more > 0 && <button type="button" className="database-day-more" onClick={() => setPlace({ chosen: day })}>+{more}</button>}
                <button type="button" className="database-day-add" aria-label={`New on ${longLabel(day)}`} onClick={() => addOn(day)}>+</button>
              </>
            : here.length > 0 && <span className="database-day-dot" aria-label={`${here.length} ${here.length === 1 ? 'row' : 'rows'}`} />}
        </div>
      })}
    </div>
    {showsChosen && <div className="database-day-list" aria-label={longLabel(place.chosen!)}>
      <div className="database-day-list-head">{longLabel(place.chosen!)}</div>
      {chosenRows.map(row => rowLine(row, place.chosen))}
      {!wide && <button type="button" className="database-new" onClick={() => addOn(place.chosen!)}>+ New</button>}
    </div>}
    {undated.length > 0 && <div className="database-undated" data-day-none>
      <button type="button" className="database-undated-head" aria-expanded={place.undatedOpen} onClick={() => setPlace({ undatedOpen: !place.undatedOpen })}>No date · {undated.length} ›</button>
      {place.undatedOpen && <>
        {undated.slice(0, undatedLimit).map(row => rowLine(row, null))}
        {undated.length > undatedLimit && <button type="button" className="database-more" onClick={() => setUndatedLimit(undatedLimit + 25)}>Show 25 more</button>}
      </>}
    </div>}
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
  </div>
}
