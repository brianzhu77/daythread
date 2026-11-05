// Databases R3: the Calendar view (design §7.2, R3-1). A month of days at 1280, up to 3 row titles on each, then "+2"; on the
// phone the month with dots, and the chosen day's rows under it. Rows with no date stay in reach in one line under the month.
// A row drags to another day at 1280, moving its date and keeping its time and length. By a created or edited time, which no
// one can set, rows don't drag and a day has no `+` (R3-21). The month or week showing is this
// device's, never a save, as a group's fold is: it comes back to where it was left.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { calendarRows, databaseRows, inView, isReadOnly, movedDate, startOfWeek, titleId, viewDateBy, viewRows, type Json, type View } from '../domain/database.ts'
import type { LocalDate, Page, WeekStart } from '../domain/types'
import { rowTint, blockActions, cellKey, DatabaseHeader, pendingCells, setOpenCell, shownRaw, useAddRow, useCommitCell, useOpenRow, usePendingCells, useReturnedRow, useUndoKey, useViewClipboard, ViewNotes, type ChangeView, type DatabaseViewProps } from './database-block'
import { openDatabaseMenu } from './database-menu'
import { addDays, fromIso, longLabel, todayIso } from './dates'
import { ArrowLeftIcon, ArrowRightIcon, PageEmoji } from './icons'
import { useWide } from './property-editors'
import { useWorkspace } from './use-day'

/** Titles a day shows at 1280 (design §7.2) before "+2". */
const perDay = 3
const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Where a block's calendar is, for this tab: BlockNote may draw a block again, which would otherwise send him back to this month. */
const places = new Map<string, { anchor: LocalDate; chosen: LocalDate | null; undatedOpen: boolean }>()

const anchorKey = (blockId: string, viewId: string) => `daythread.database-calendar.${blockId}.${viewId}`
function savedAnchor(blockId: string, viewId: string): LocalDate | null {
  try { const day = localStorage.getItem(anchorKey(blockId, viewId)); return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null } catch { return null }
}
const monthOf = (day: LocalDate) => day.slice(0, 7)
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7)
}
/** The weeks a month's grid draws: whole weeks, as the date picker's. */
function monthDays(month: string, weekStart: WeekStart): LocalDate[] {
  const first = `${month}-01`
  const start = startOfWeek(first, weekStart)
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1)
  // Rounded first: a day with a clock change isn't 24 hours.
  const count = Math.ceil((Math.round((fromIso(last).getTime() - fromIso(start).getTime()) / 86_400_000) + 1) / 7) * 7
  return Array.from({ length: count }, (_, i) => addDays(start, i))
}

export function DatabaseCalendar({ workspace, db, view, changeView, blockId, pageDate, cap, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const { latest } = useWorkspace()
  const commit = useCommitCell()
  const undoKey = useUndoKey()
  const wide = useWide()
  const today = todayIso()
  const weekStart = workspace.weekStart ?? 0
  const context = useMemo(() => ({ today, pageDate, weekStart }), [today, pageDate, weekStart])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  const openRow = useOpenRow(view, rows, blockId)
  usePendingCells()
  const returned = useReturnedRow(rows)
  const property = viewDateBy(db.database, view)
  const canSetDate = Boolean(property && !isReadOnly(property))

  const placeKey = `${blockId}|${view.id}`
  const [place, setPlaceState] = useState(() => {
    const anchor = savedAnchor(blockId, view.id) ?? pageDate ?? today
    return places.get(placeKey) ?? { anchor, chosen: wide ? null as LocalDate | null : anchor, undatedOpen: false }
  })
  const setPlace = (next: Partial<typeof place>) => {
    if (next.anchor) { try { localStorage.setItem(anchorKey(blockId, view.id), next.anchor) } catch { /* private mode: this tab only */ } }
    setPlaceState(now => { const merged = { ...now, ...next }; places.set(placeKey, merged); return merged })
  }
  // The month or week showing is `anchor`'s.
  const byWeek = view.calendarSpan === 'week'
  const month = monthOf(place.anchor)
  const days = byWeek ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(place.anchor, weekStart), i)) : monthDays(month, weekStart)
  const { days: onDays, undated } = calendarRows(property, rows, days[0]!, days.at(-1)!, shownRaw)
  const [undatedLimit, setUndatedLimit] = useState(cap)

  const wrap = useRef<HTMLDivElement>(null)
  useViewClipboard(wrap)
  const addRow = useAddRow(db, view, context, blockId, pageId => requestAnimationFrame(() => setOpenCell({ blockId, databaseId: db.id, rowId: pageId, columnId: titleId })))
  const addOn = (day: LocalDate) => { setPlace({ chosen: day }); addRow(undefined, property && canSetDate ? { [property.id]: { start: day } as unknown as Json } : undefined) }

  /** A row's date moved, one change with one Undo; the notice says where, and if the filter then hides it. */
  const moveTo = (row: Page, from: LocalDate | null, to: LocalDate) => {
    if (!property || !canSetDate || from === to) return
    const value = movedDate(property, shownRaw(row, property.id), from, to)
    const hidden = !inView(db.database, { ...row, values: { ...row.values, [property.id]: value as unknown as Json } } as Page, view, context)
    commit(db, row, property.id, value as unknown as Json, `Moved to ${longLabel(to)}${hidden ? " · hidden by this view's filter" : ''}`)
  }

  // Dragging at 1280: a press on a title past 4 px; nothing moves until the drop, so a redraw can't lose it.
  const [drag, setDrag] = useState<{ rowId: string; over: LocalDate | null } | null>(null)
  const justDragged = useRef(false)
  const startDrag = (e: ReactPointerEvent, row: Page, from: LocalDate | null) => {
    if (e.button !== 0 || e.pointerType !== 'mouse' || !canSetDate) return
    const start = { x: e.clientX, y: e.clientY }
    let lifted = false
    const dayAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]')?.dataset.day ?? null
    const finish = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', esc, true) }
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
    // The button's still down, so its click comes when it's let go, and mustn't open the row.
    const esc = (ev: globalThis.KeyboardEvent) => { if (ev.key !== 'Escape') return; ev.stopPropagation(); finish(); setDrag(null); if (lifted) { justDragged.current = true; document.addEventListener('pointerup', () => setTimeout(() => { justDragged.current = false }), { once: true }) } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); window.addEventListener('keydown', esc, true)
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
      if (!canSetDate) return
      const row = rows.find(r => r.id === chip.dataset.chip), from = chip.dataset.from
      if (row && from) { e.preventDefault(); const to = addDays(from, step); refocus.current = { rowId: row.id, day: to }; moveTo(row, from, to); if (!days.includes(to)) setPlace({ anchor: to }) }
      return
    }
    const day = target.closest<HTMLElement>('[data-day]')?.dataset.day
    if (!day) return
    const next = addDays(day, step)
    e.preventDefault()
    if (!days.includes(next)) setPlace({ anchor: next })
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>(`[data-day="${next}"] .database-day-number`)?.focus())
  }

  const rowLine = (row: Page, from: LocalDate | null) => {
    const unsaved = [...pendingCells.values()].some(p => p.failed && p.rowId === row.id)
    const tint = rowTint(db.database, view, row, context)
    return <div key={row.id} className={`database-day-row${returned === row.id ? ' is-returned' : ''}`} data-row={row.id}>
      <button type="button" {...(tint ? { style: tint.style } : {})} className={`database-day-title${tint ? tint.className : ''}${row.title ? '' : ' is-placeholder'}`} data-chip={row.id} data-from={from ?? undefined} data-cell={cellKey({ blockId, databaseId: db.id, rowId: row.id, columnId: titleId })}
        onPointerDown={e => startDrag(e, row, from)} onMouseDown={e => e.preventDefault()} onClick={() => { if (!justDragged.current) openRow(row.id) }}>{row.icon && <PageEmoji icon={row.icon} className="database-row-icon" />}{row.title || 'Untitled'}</button>
      {unsaved && <span className="database-card-unsaved">Not saved</span>}
    </div>
  }
  const chosenRows = place.chosen ? onDays.get(place.chosen) ?? [] : []
  const showsChosen = Boolean(place.chosen) && (!wide || (!byWeek && chosenRows.length > perDay))
  const short = (d: LocalDate) => fromIso(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const periodLabel = byWeek
    ? `${short(days[0]!)} – ${monthOf(days[0]!) === monthOf(days[6]!) ? Number(days[6]!.slice(8)) : short(days[6]!)}, ${days[6]!.slice(0, 4)}`
    : fromIso(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const showsToday = byWeek ? days.includes(today) : month === monthOf(today)
  const step = (by: number) => setPlace({ anchor: byWeek ? addDays(place.anchor, by * 7) : `${shiftMonth(month, by)}-01` })
  const weekdays = weekStart === 1 ? [...weekdayNames.slice(1), weekdayNames[0]!] : weekdayNames

  return <div className="database-table-wrap" ref={wrap} onKeyDown={onKeyDown}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addOn(place.chosen ?? today) }} />
    {!property && <p className="database-empty"><button type="button" className="app-link" onClick={() => openDatabaseMenu(blockId, db.id, 'layout')}>Choose a date property</button></p>}
    <div className="database-calendar-head">
      <span className="database-calendar-month">{periodLabel}</span>
      {!showsToday && <button type="button" className="database-calendar-today" onClick={() => setPlace({ anchor: today, chosen: today })}>Today</button>}
      <button type="button" className="database-calendar-arrow" aria-label={byWeek ? 'Previous week' : 'Previous month'} onClick={() => step(-1)}><ArrowLeftIcon /></button>
      <button type="button" className="database-calendar-arrow" aria-label={byWeek ? 'Next week' : 'Next month'} onClick={() => step(1)}><ArrowRightIcon /></button>
    </div>
    <div className={`database-calendar${byWeek ? ' is-week' : ''}${drag ? ' is-dragging' : ''}`} role="grid" aria-label={periodLabel}>
      {weekdays.map(d => <div key={d} className="database-calendar-weekday" role="columnheader">{wide ? d : d[0]}</div>)}
      {days.map((day, i) => {
        const here = onDays.get(day) ?? []
        // A week has the room to show them all.
        const limit = byWeek ? here.length : perDay
        const more = here.length - limit
        const classes = `database-day${!byWeek && monthOf(day) !== month ? ' is-other-month' : ''}${day === today ? ' is-today' : ''}${day === place.chosen ? ' is-chosen' : ''}${drag?.over === day ? ' is-drop' : ''}`
        return <div key={day} role="gridcell" data-day={day} className={classes}>
          <button type="button" className="database-day-number" data-nav={day === (showsToday ? today : days[0]) ? '0:0' : undefined} tabIndex={i === 0 ? 0 : -1} aria-label={longLabel(day)}
            onClick={() => setPlace({ chosen: day })}>{Number(day.slice(8))}</button>
          {wide
            ? <>
                {here.slice(0, limit).map(row => rowLine(row, day))}
                {more > 0 && <button type="button" className="database-day-more" onClick={() => setPlace({ chosen: day })}>+{more}</button>}
                {(canSetDate || !property) && <button type="button" className="database-day-add" aria-label={`New on ${longLabel(day)}`} onClick={() => addOn(day)}>+</button>}
              </>
            : here.length > 0 && <span className="database-day-dot" aria-label={`${here.length} ${here.length === 1 ? 'row' : 'rows'}`} />}
        </div>
      })}
    </div>
    {showsChosen && <div className="database-day-list" aria-label={longLabel(place.chosen!)}>
      <div className="database-day-list-head">{longLabel(place.chosen!)}</div>
      {chosenRows.map(row => rowLine(row, place.chosen))}
      {!wide && (canSetDate || !property) && <button type="button" className="database-new" onClick={() => addOn(place.chosen!)}>+ New</button>}
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
