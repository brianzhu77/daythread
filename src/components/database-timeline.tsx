// Databases R4: the Timeline view (docs/design/timeline.md). Bars on a scale at 1280, from one Date's range or a pair of dates; on the
// phone a list by week, since bars don't fit, where dates change in the row's sheet. A bar moves and its edges drag with one Undo; nothing
// moves until the drop, so a redraw can't lose it. By a time no one can set, or nothing to write to, bars don't drag. Rows with no date
// stay in reach in one line under the scale. Where the scale is left is this device's, as a calendar's month is.
import { toast } from '@heroui/react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { columnCalc, databaseRows, inView, isEmptyValue, isReadOnly, propertyOf, readValue, startOfWeek, titleId, viewCalculations, viewColumns, viewDateBy, viewGroups, viewRows, type Database, type DateValue, type Json, type Property, type View, type ViewGroups } from '../domain/database.ts'
import { dayWidth, daysBetween, draggedBar, endAt, snapMinutes, startAt, timelineBars, timelineUnits, timelineWeeks, viewDateEnd, type BarPart, type BarWrite, type TimelineBar, type TimelineUnit } from '../domain/timeline.ts'
import { taskIdOfRow } from '../domain/todos-source'
import type { LocalDate, Page, WeekStart } from '../domain/types'
import { blockActions, cellKey, DatabaseHeader, GroupName, HiddenGroups, pendingCells, setOpenCell, shownRaw, shownValue, useAddRow, useCommitCell, useFolds, useGroupLimits, useMoveRow, useOpenRow, usePendingCells, useReturnedRow, useUndoKey, useViewClipboard, ViewNotes, withPendingMoves, type ChangeView, type DatabaseViewProps } from './database-block'
import { openDatabaseMenu } from './database-menu'
import { addDays, fromIso, todayIso } from './dates'
import { ChevronRightIcon } from './icons'
import { PropertyCell, useWide } from './property-editors'
import { calcText } from './property-values'
import { useWorkspace } from './use-day'

const rowHeight = 36
/** How far either side of the rows and today the scale runs, in days, at each unit. */
const margin: Record<TimelineUnit, number> = { hours: 7, day: 60, week: 120, month: 365, quarter: 730, year: 1825 }
/** Past this the browser can't lay out a page: a date from long ago stays reachable by its arrow, at the scale's end. */
const widest = 8_000_000
const short = (day: LocalDate) => fromIso(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const withYear = (day: LocalDate) => fromIso(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const day = (text: string): LocalDate => text.slice(0, 10)
/** A bar's dates in words. A row without an end says so, and one whose end is before its start says that. */
function datesOf(bar: Pick<TimelineBar, 'start' | 'end' | 'shape'>): string {
  const from = day(bar.start), to = day(bar.end)
  if (bar.shape === 'open-end') return `From ${short(from)}`
  if (bar.shape === 'open-start') return `Until ${short(from)}`
  if (bar.shape === 'inverted') return `${short(from)} · ends before it starts`
  return from === to ? short(from) : `${short(from)} – ${short(to)}`
}
const placeKeyOf = (blockId: string, viewId: string) => `daythread.database-timeline.${blockId}.${viewId}`
function savedPlace(blockId: string, viewId: string): LocalDate | null {
  try { const saved = localStorage.getItem(placeKeyOf(blockId, viewId)); return saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : null } catch { return null }
}
/** Where a block's scale is, for this tab: BlockNote may draw a block again. */
const places = new Map<string, LocalDate>()
const rawValue = (row: Page, property: Property): DateValue | null => readValue(property, shownRaw(row, property.id)) as DateValue | null

export function DatabaseTimeline({ workspace, db, view, changeView, blockId, pageDate, cap, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const { run } = useWorkspace()
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
  const property = viewDateBy(db.database, view), endProperty = viewDateEnd(db.database, view)
  const canSet = Boolean(property && !isReadOnly(property) && !(endProperty && isReadOnly(endProperty)))
  const { bars, undated } = timelineBars(db.database, view, rows, shownRaw)
  const groupsNow = viewGroups(db.database, view, withPendingMoves(rows), shownRaw, weekStart)
  const unit: TimelineUnit = view.timelineUnit ?? 'day'
  // A view of this page's day opens on that day (§5); any other opens on today, wherever it sits.
  const opensOn = pageDate && JSON.stringify(view.filter).includes('"relative":"pageDate"') ? pageDate : today
  const [limit, setLimit] = useState(cap)
  const [undatedOpen, setUndatedOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useViewClipboard(wrap)
  const addRow = useAddRow(db, view, context, blockId, pageId => requestAnimationFrame(() => setOpenCell({ blockId, databaseId: db.id, rowId: pageId, columnId: titleId })))

  /** A move: one change with one Undo; the notice says where, and if the filter then hides it. */
  const write = (row: Page, writes: readonly BarWrite[], words: string) => {
    if (!writes.length) return
    const values = { ...row.values, ...Object.fromEntries(writes.map(w => [w.id, w.value])) } as Page['values']
    const hidden = !inView(db.database, { ...row, values } as Page, view, context)
    const notice = `${words}${hidden ? " · hidden by this view's filter" : ''}`
    const taskId = taskIdOfRow(row.id)
    // A to-do's two dates are one task command, so one Undo. Moving it never touches its line on a day page (§5).
    if (taskId && writes.length > 1) {
      const dateOf = (id: string) => { const w = writes.find(x => x.id === id); return w ? (w.value as unknown as DateValue | undefined)?.start ?? null : undefined }
      const attentionOn = dateOf('start'), deadlineOn = dateOf('deadline')
      void run({ type: 'set-task-dates', taskId, ...(attentionOn !== undefined ? { attentionOn } : {}), ...(deadlineOn !== undefined ? { deadlineOn } : {}) }, r => ({ text: notice, undoOperationId: r.operationId }))
      return
    }
    commit(db, row, writes[0]!.id, writes[0]!.value, notice, undefined, undefined, writes.slice(1).map(w => ({ columnId: w.id, raw: w.value })))
  }

  if (!wide) return <div className="database-table-wrap" ref={wrap}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addRow() }} />
    {!property && <p className="database-empty"><button type="button" className="app-link" onClick={() => openDatabaseMenu(blockId, db.id, 'layout')}>Choose a date property</button></p>}
    <TimelineWeeks bars={bars} undated={undated} from={opensOn} weekStart={weekStart} limit={limit} setLimit={setLimit} returned={returned} openRow={openRow} blockId={blockId} databaseId={db.id} />
    <button type="button" className="database-new" onClick={() => addRow()}>+ New</button>
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
  </div>

  return <div className="database-table-wrap" ref={wrap}>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => { if (!databaseRows(workspace, db.id).length) addRow() }} />
    {!property && <p className="database-empty"><button type="button" className="app-link" onClick={() => openDatabaseMenu(blockId, db.id, 'layout')}>Choose a date property</button></p>}
    <TimelineScale db={db} rows={rows} context={context} addRow={addRow} weekStart={weekStart} cap={cap} bars={bars} undated={undated} unit={unit} today={today} opensOn={opensOn} blockId={blockId} view={view} databaseId={db.id} canSet={canSet} limit={limit} setLimit={setLimit} returned={returned}
      undatedOpen={undatedOpen} setUndatedOpen={setUndatedOpen} openRow={openRow} undoKey={undoKey} changeView={changeView}
      write={write} addOn={from => addRow(undefined, property && canSet ? { [property.id]: { start: from } as unknown as Json } : undefined)} startProperty={property} endProperty={endProperty} />
    {!groupsNow && <button type="button" className="database-new" onClick={() => addRow()}>+ New</button>}
    {groupsNow && <HiddenGroups groups={groupsNow} changeView={changeView} />}
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
  </div>
}

/** At 390 (§4): a list by week, from this week down. Tapping opens a row; dates change in its sheet. */
function TimelineWeeks({ bars, undated, from, weekStart, limit, setLimit, returned, openRow, blockId, databaseId }: { bars: readonly TimelineBar[]; undated: readonly Page[]; from: LocalDate; weekStart: WeekStart; limit: number; setLimit(n: number): void; returned: string | null; openRow(id: string): void; blockId: string; databaseId: string }) {
  const { weeks, earlier } = timelineWeeks(bars, from, weekStart)
  const [earlierOpen, setEarlierOpen] = useState(false), [undatedOpen, setUndatedOpen] = useState(false)
  // A log that's all in the past shouldn't read as empty.
  const showEarlier = earlierOpen || weeks.length === 0
  const earlierCount = earlier.reduce((n, w) => n + w.bars.length, 0)
  const line = (bar: TimelineBar) => <div key={bar.row.id} data-row={bar.row.id} className={`database-week-row${returned === bar.row.id ? ' is-returned' : ''}`}>
    <button type="button" className="database-week-open" data-cell={cellKey({ blockId, databaseId, rowId: bar.row.id, columnId: titleId })} onClick={() => openRow(bar.row.id)}>
      <span className={`database-week-title${bar.row.title ? '' : ' is-placeholder'}`}>{bar.row.title || 'Untitled'}</span>
      <span className={`database-week-dates${bar.shape === 'inverted' ? ' is-error' : ''}`}>{datesOf(bar)}</span>
    </button>
  </div>
  const week = ({ week: first, bars: here }: { week: LocalDate; bars: TimelineBar[] }) => <section key={first} className="database-week" aria-label={`Week of ${withYear(first)}`}>
    <h3 className="database-week-head">{first === startOfWeek(from, weekStart) ? 'This week' : `${short(first)} – ${short(addDays(first, 6))}`}</h3>
    {here.map(line)}
  </section>
  let left = limit
  const within = (list: typeof weeks) => list.flatMap(w => { if (left <= 0) return []; const bars = w.bars.slice(0, left); left -= bars.length; return [{ ...w, bars }] })
  const shown = within(weeks), total = weeks.reduce((n, w) => n + w.bars.length, 0)
  return <div className="database-weeks">
    {earlierCount > 0 && <button type="button" className="database-undated-head database-weeks-earlier" aria-expanded={showEarlier} onClick={() => setEarlierOpen(o => !o)}>Earlier · {earlierCount} ›</button>}
    {showEarlier && earlier.map(week)}
    {shown.map(week)}
    {total > limit && <button type="button" className="database-more" onClick={() => setLimit(limit + 25)}>Show 25 more</button>}
    {undated.length > 0 && <div className="database-undated">
      <button type="button" className="database-undated-head" aria-expanded={undatedOpen} onClick={() => setUndatedOpen(o => !o)}>No date · {undated.length} ›</button>
      {undatedOpen && undated.map(row => <div key={row.id} data-row={row.id} className="database-week-row"><button type="button" className="database-week-open" onClick={() => openRow(row.id)}><span className={`database-week-title${row.title ? '' : ' is-placeholder'}`}>{row.title || 'Untitled'}</span></button></div>)}
    </div>}
  </div>
}

type Tick = { at: number; label: string }
const monthName = (d: LocalDate, length: 'short' | 'long' = 'short') => fromIso(d).toLocaleDateString('en-US', { month: length })
/** The scale's two lines, for the days in view. */
function ticksFor(unit: TimelineUnit, origin: LocalDate, from: number, to: number): { upper: Tick[]; lower: Tick[] } {
  const upper: Tick[] = [], lower: Tick[] = []
  for (let i = Math.floor(from); i <= to; i++) {
    const d = addDays(origin, i), dom = Number(d.slice(8)), month = Number(d.slice(5, 7))
    if (unit === 'hours') {
      upper.push({ at: i, label: fromIso(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) })
      for (let h = 0; h < 24; h += 1) lower.push({ at: i + h / 24, label: h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p` })
    }
    if (unit === 'day' || unit === 'week') {
      if (dom === 1 || i === Math.floor(from)) upper.push({ at: i - dom + 1, label: `${monthName(d, 'long')} ${d.slice(0, 4)}` })
      if (unit === 'day' || fromIso(d).getDay() === 1) lower.push({ at: i, label: String(dom) })
    }
    if (unit === 'month' || unit === 'quarter' || unit === 'year') {
      if ((month === 1 && dom === 1) || i === Math.floor(from)) upper.push({ at: i - daysBetween(`${d.slice(0, 4)}-01-01`, d), label: d.slice(0, 4) })
      if (dom === 1) lower.push({ at: i, label: unit === 'year' ? monthName(d)[0]! : monthName(d) })
    }
  }
  return { upper, lower }
}

const nameWidth = 200, columnWidth = 120

function TimelineScale({ db, rows, context, addRow, weekStart, cap, bars, undated, unit, today, opensOn, blockId, view, databaseId, canSet, limit, setLimit, returned, undatedOpen, setUndatedOpen, openRow, undoKey, changeView, write, addOn, startProperty, endProperty }: {
  db: Page & { database: Database }; rows: readonly Page[]; context: Parameters<typeof useMoveRow>[2]; addRow: ReturnType<typeof useAddRow>; weekStart: WeekStart; cap: number
  bars: readonly TimelineBar[]; undated: readonly Page[]; unit: TimelineUnit; today: LocalDate; opensOn: LocalDate; blockId: string; view: View; databaseId: string; canSet: boolean; limit: number; setLimit(n: number): void; returned: string | null
  undatedOpen: boolean; setUndatedOpen(open: boolean): void; openRow(id: string): void; undoKey: ReturnType<typeof useUndoKey>; changeView: ChangeView
  write(row: Page, writes: readonly BarWrite[], words: string): void; addOn(day: LocalDate): void; startProperty: Property | null; endProperty: Property | null
}) {
  const width = dayWidth[unit]
  // The table beside the scale: pinned, so it and the bars scroll as one and stay in line.
  // It takes at most 60% of the width, so the bars keep theirs; columns past that are named in its head, and Properties reaches them.
  const [full, setFull] = useState(836)
  const allColumns = viewColumns(db.database, view)
  const columns = allColumns.slice(0, Math.max(0, Math.floor((full * 0.6 - nameWidth) / columnWidth)))
  const hiddenColumns = allColumns.length - columns.length
  const paneOn = Boolean(view.timelineTable)
  const pane = paneOn ? nameWidth + columns.length * columnWidth : 0
  const groups: ViewGroups | null = viewGroups(db.database, view, withPendingMoves(rows), shownRaw, weekStart)
  const { limitOf, showMore } = useGroupLimits(`${blockId}|${view.id}`, cap)
  const { folded, toggle } = useFolds(blockId, view.id)
  const moveRow = useMoveRow(db, view, context, groups)
  // The scale runs over the rows and today, as far as a page can.
  const days = bars.flatMap(b => [day(b.start), day(b.end)])
  const span = Math.floor(widest / width / 2)
  const clamp = (d: LocalDate) => (daysBetween(today, d) < -span ? addDays(today, -span) : daysBetween(today, d) > span ? addDays(today, span) : d)
  const first = clamp(days.reduce((a, b) => (a < b ? a : b), today)), last = clamp(days.reduce((a, b) => (a > b ? a : b), today))
  const origin = addDays(first, -margin[unit]), total = daysBetween(origin, last) + margin[unit] + 1
  const scaleWidth = pane + total * width

  const scroller = useRef<HTMLDivElement>(null)
  const placeKey = `${blockId}|${view.id}`
  const [seen, setSeen] = useState({ left: 0, width: 800 })
  const centre = (d: LocalDate, behavior: ScrollBehavior = 'auto') => { const el = scroller.current; if (el) el.scrollTo({ left: (daysBetween(origin, d) + 0.5) * width - (el.clientWidth - pane) / 2, behavior }) }
  // Back where it was left, on the same day whatever the unit. Never the page's own scroll: this block's sideways scroll stays its own.
  const placed = useRef<string | null>(null)
  const shownFrom = useRef(origin)
  useLayoutEffect(() => {
    // Also when the table opens or closes, which changes how wide the scale is.
    const key = `${placeKey}|${unit}|${pane}`
    if (placed.current === key) return
    placed.current = key
    centre(places.get(placeKey) ?? savedPlace(blockId, view.id) ?? opensOn)
    shownFrom.current = origin
    const el = scroller.current
    if (el) setSeen({ left: el.scrollLeft, width: el.clientWidth - pane })
  })
  // The scale runs over the rows, so a date can move where it starts: what's on screen stays on screen.
  useLayoutEffect(() => {
    const el = scroller.current
    if (shownFrom.current === origin) return
    if (el) { el.scrollLeft += daysBetween(origin, shownFrom.current) * width; setSeen({ left: el.scrollLeft, width: el.clientWidth - pane }) }
    shownFrom.current = origin
  })
  useLayoutEffect(() => { const w = scroller.current?.clientWidth; if (w && w !== full) setFull(w) })
  const frame = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const el = scroller.current
      if (!el) return
      setSeen({ left: el.scrollLeft, width: el.clientWidth - pane })
      const at = addDays(origin, Math.floor((el.scrollLeft + (el.clientWidth - pane) / 2) / width))
      places.set(placeKey, at)
      try { localStorage.setItem(placeKeyOf(blockId, view.id), at) } catch { /* private mode: this tab only */ }
    })
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const pad = 900
  const fromDay = Math.max(0, (seen.left - pad) / width), toDay = Math.min(total, (seen.left + seen.width + pad) / width)
  const { upper, lower } = ticksFor(unit, origin, fromDay, toDay)
  // Today's line is the day's middle, or the time now at Hours.
  const now = new Date()
  const todayAt = (daysBetween(origin, today) + (unit === 'hours' ? (now.getHours() * 60 + now.getMinutes()) / 1440 : 0.5)) * width
  const goToday = () => { const el = scroller.current; if (el) el.scrollTo({ left: todayAt - (el.clientWidth - pane) / 2, behavior: 'smooth' }) }
  const showsToday = todayAt >= seen.left && todayAt <= seen.left + seen.width

  // ------------------------------------------------------------ dragging
  const [drag, setDrag] = useState<{ rowId: string; part: BarPart; minutes: number } | null>(null)
  const justDragged = useRef(false)
  const startDrag = (e: ReactPointerEvent, bar: TimelineBar, part: BarPart) => {
    if (e.button !== 0 || e.pointerType !== 'mouse') return
    const start = e.clientX, startScroll = scroller.current?.scrollLeft ?? 0
    let lifted = false, pointer = start, auto = 0
    const minutesAt = () => { const moved = pointer - start + ((scroller.current?.scrollLeft ?? 0) - startScroll); const snap = snapMinutes(unit); return Math.round(moved / (width * snap / 1440)) * snap }
    const refuse = () => toast(`${(bar.endProperty && isReadOnly(bar.endProperty) ? bar.endProperty : bar.startProperty).name} can't be changed`, { timeout: 4000 })
    const finish = () => { cancelAnimationFrame(auto); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', esc, true) }
    const edges = () => {
      const el = scroller.current
      if (el) { const r = el.getBoundingClientRect(); if (pointer < r.left + pane + 40) el.scrollLeft -= 12; else if (pointer > r.right - 40) el.scrollLeft += 12 }
      setDrag({ rowId: bar.row.id, part, minutes: minutesAt() })
      auto = requestAnimationFrame(edges)
    }
    const move = (ev: PointerEvent) => {
      pointer = ev.clientX
      if (lifted || Math.abs(pointer - start) <= 4) return
      lifted = true
      if (bar.readOnly) return
      auto = requestAnimationFrame(edges)
    }
    const up = () => {
      const minutes = minutesAt()
      finish(); setDrag(null)
      if (!lifted) return
      justDragged.current = true; setTimeout(() => { justDragged.current = false })
      if (bar.readOnly) { refuse(); return }
      if (!minutes) return
      const after = draggedBar(bar, part, minutes, p => rawValue(bar.row, p))
      write(bar.row, after.writes, part === 'move' ? `Moved to ${datesOf(after)}` : datesOf(after))
    }
    const cancel = () => { finish(); setDrag(null); if (lifted) { justDragged.current = true; setTimeout(() => { justDragged.current = false }) } }
    const esc = (ev: globalThis.KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); cancel() } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); document.addEventListener('keydown', esc, true)
  }
  useEffect(() => () => setDrag(null), [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (undoKey(e)) return
    const target = e.target as HTMLElement
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && target.tagName !== 'INPUT') { e.preventDefault(); return }
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); blockActions.get(blockId)?.select(blockId); return }
    // Up and down between rows. A date changes in its cell: arrows don't move a bar (§5).
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const all = [...(scroller.current?.querySelectorAll<HTMLElement>('.database-bar, .database-bar-off') ?? [])], at = all.indexOf(target)
    const next = all[at + (e.key === 'ArrowUp' ? -1 : 1)]
    if (at >= 0 && next) { e.preventDefault(); next.focus() }
  }

  // A day under the pointer, for `+` on the scale and for giving an undated row its dates.
  const dayAtX = (clientX: number) => { const el = scroller.current; if (!el) return today; return addDays(origin, Math.floor((clientX - el.getBoundingClientRect().left - pane + el.scrollLeft) / width)) }
  const [hover, setHover] = useState<LocalDate | null>(null)
  const pressed = useRef<LocalDate | null>(null)
  const drawn = bars.slice(0, limit)

  // The table's cells: a tap edits, as in a table. A date changes here at any time, whatever the keys do to a bar (§5).
  const cell = (row: Page, property: Property, group?: string) => {
    const value = shownValue(db.database, row, property.id)
    const open = () => { if (!isReadOnly(property)) setOpenCell({ blockId, databaseId, rowId: row.id, columnId: property.id, ...(group !== undefined ? { group } : {}) }) }
    return <button key={property.id} type="button" className="database-pane-cell" style={{ width: columnWidth }} data-cell={cellKey({ blockId, databaseId, rowId: row.id, columnId: property.id, ...(group !== undefined ? { group } : {}) })} onClick={open}>
      {!isEmptyValue(value) && <PropertyCell property={property} value={value} today={today} />}
    </button>
  }
  const paneRow = (row: Page, group?: string) => <div className="database-pane" style={{ width: pane }}>
    {!view.sort.length && !db.database.fixed && <span className="database-pane-handle" role="button" aria-label={`Drag ${row.title || 'Untitled'}`} onPointerDown={e => startReorder(e, row.id, group ?? null)}>⋮⋮</span>}
    <button type="button" className={`database-pane-name${row.title ? '' : ' is-placeholder'}`} style={{ width: nameWidth }} onClick={() => openRow(row.id)}>{row.title || 'Untitled'}</button>
    {columns.map(c => cell(row, c.property, group))}
  </div>

  // A row up or down, by its table's handle, when the view isn't sorted: the same move as a list's.
  const [reorder, setReorder] = useState<{ rowId: string; before: string | null; over: string | null } | null>(null)
  const startReorder = (e: ReactPointerEvent, rowId: string, from: string | null) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const target = (y: number) => {
      const lanes = [...(scroller.current?.querySelectorAll<HTMLElement>('.database-bar-lane[data-row], .database-group-end') ?? [])]
      const at = lanes.find(l => { const r = l.getBoundingClientRect(); return y < r.top + r.height / 2 })
      if (!at) { const last = lanes.at(-1); return { before: null, over: last?.dataset.group ?? null } }
      return { before: at.dataset.row ?? null, over: at.dataset.group ?? null }
    }
    const move = (ev: PointerEvent) => setReorder({ rowId, ...target(ev.clientY) })
    const finish = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel) }
    const up = (ev: PointerEvent) => { finish(); setReorder(null); const t = target(ev.clientY); moveRow(rowId, from, groups ? t.over : null, t.before, rows) }
    const cancel = () => { finish(); setReorder(null) }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel)
  }

  const calculations = viewCalculations(db.database, view)
  const footColumns = [propertyOf(db.database, titleId)!, ...columns.map(c => c.property)]
  const hasFoot = paneOn && footColumns.some(p => calculations[p.id])
  const readShown = (row: Page, columnId: string) => shownValue(db.database, row, columnId)
  const foot = (over: readonly Page[]) => <div className="database-bar-lane is-foot" style={{ height: rowHeight }}><div className="database-pane" style={{ width: pane }}>
    {footColumns.map((p, i) => {
      const kind = calculations[p.id]
      const text = kind ? calcText(kind, columnCalc(db.database, over, p.id, kind, readShown), p.format, today, p.prefix) : null
      return <button key={p.id} type="button" className="database-pane-cell database-calc-cell" style={{ width: i === 0 ? nameWidth : columnWidth }} aria-label={text ? `${p.name}: ${text.label} ${text.value}` : `Calculate ${p.name}`} onClick={() => openDatabaseMenu(blockId, databaseId, 'calculate')}>
        {text ? <span className="database-calc-text">{text.label && <span className="database-calc-label">{text.label}</span>}<span>{text.value}</span></span> : <span className="database-calc-empty">Calculate</span>}
      </button>
    })}
  </div></div>

  /** A line of the scale that isn't a row. With the table open it sits in the table, so the grid doesn't run under its words. */
  const lineLane = (content: ReactNode, className = '', group?: string) => <div className={`database-bar-lane is-line ${className}`} {...(group !== undefined ? { 'data-group': group } : {})}>
    {paneOn ? <div className="database-pane is-line" style={{ width: pane }}>{content}</div> : <span className="database-timeline-line">{content}</span>}
  </div>
  const barLine = (bar: TimelineBar, index: number, group?: string) => {
    const live = drag?.rowId === bar.row.id ? draggedBar(bar, drag.part, drag.minutes, p => rawValue(bar.row, p)) : null
    const at = live ?? bar
    const left = startAt(at.start, origin, unit) * width, right = endAt(at.end, origin, unit, at.start) * width
    const barWidth = Math.max(right - left, 10)
    const unsaved = [...pendingCells.values()].some(p => p.failed && p.rowId === bar.row.id)
    const off = left + barWidth < seen.left ? 'before' : left > seen.left + seen.width ? 'after' : null
    const drawnHere = left + barWidth > seen.left - pad && left < seen.left + seen.width + pad
    const title = bar.row.title || 'Untitled'
    return <div key={`${group ?? ''}:${bar.row.id}`} className={`database-bar-lane${returned === bar.row.id ? ' is-returned' : ''}${reorder?.before === bar.row.id ? ' is-drop-before' : ''}${reorder?.rowId === bar.row.id ? ' is-dragging' : ''}`} data-row={bar.row.id} {...(group !== undefined ? { 'data-group': group } : {})} style={{ height: rowHeight }}>
      {paneOn && paneRow(bar.row, group)}
      {drawnHere && <button type="button" className={`database-bar is-${at.shape}${bar.readOnly ? ' is-read-only' : ''}${live ? ' is-dragging' : ''}`} style={{ left: left + pane, width: barWidth }}
        data-nav={index === 0 ? '0:0' : undefined} data-cell={cellKey({ blockId, databaseId, rowId: bar.row.id, columnId: titleId })} aria-label={`${title}, ${datesOf(at)}`}
        onPointerDown={e => startDrag(e, bar, 'move')} onMouseDown={e => e.preventDefault()} onClick={() => { if (!justDragged.current) openRow(bar.row.id) }}>
        <span className={`database-bar-title${bar.row.title ? '' : ' is-placeholder'}`}>{title}{unsaved && <span className="database-card-unsaved"> · Not saved</span>}</span>
        {!bar.readOnly && <>
          <span className="database-bar-edge is-start" onPointerDown={e => { e.stopPropagation(); startDrag(e, bar, 'start') }} />
          <span className="database-bar-edge is-end" onPointerDown={e => { e.stopPropagation(); startDrag(e, bar, 'end') }} />
        </>}
        {live && <span className="database-bar-tip">{datesOf(at)}</span>}
      </button>}
      {/* Its bar is off this way: a jump to it, with its name, so the row isn't a blank line. */}
      {off && <button type="button" className={`database-bar-off is-${off}`} style={off === 'before' ? { left: pane + 4 } : undefined} aria-label={`Go to ${title}, ${datesOf(at)}`} onClick={() => centre(day(at.start), 'smooth')}>{off === 'before' ? '‹ ' : ''}{paneOn ? '' : title}{off === 'after' ? ' ›' : ''}</button>}
    </div>
  }
  const undatedLane = (row: Page) => {
    // A click gives it a day; a drag gives it a range.
    const set = (from: LocalDate, to: LocalDate) => {
      if (!startProperty || !canSet) return
      const [first, last] = from <= to ? [from, to] : [to, from]
      if (endProperty && first !== last) write(row, [{ id: startProperty.id, value: { start: first } as unknown as Json }, { id: endProperty.id, value: { start: last } as unknown as Json }], `Set to ${short(first)} – ${short(last)}`)
      else write(row, [{ id: startProperty.id, value: (first === last ? { start: first } : { start: first, end: last }) as unknown as Json }], first === last ? `Set to ${short(first)}` : `Set to ${short(first)} – ${short(last)}`)
    }
    return <div key={row.id} className="database-bar-lane is-undated" data-row={row.id} style={{ height: rowHeight }}
      onPointerMove={e => { if (canSet && e.pointerType === 'mouse') setHover(dayAtX(e.clientX)) }} onPointerLeave={() => setHover(null)}
      onPointerDown={e => { if (canSet && e.button === 0 && !(e.target as Element).closest('.database-bar-off, .database-pane')) pressed.current = dayAtX(e.clientX) }}
      onPointerUp={e => { if (pressed.current) { const from = pressed.current; pressed.current = null; set(from, dayAtX(e.clientX)) } }}>
      {paneOn ? paneRow(row) : <button type="button" className={`database-bar-off is-before is-name${row.title ? '' : ' is-placeholder'}`} onClick={() => openRow(row.id)}>{row.title || 'Untitled'}</button>}
      {hover && canSet && <span className="database-bar is-ghost" aria-hidden="true" style={{ left: pane + daysBetween(origin, hover) * width, width: Math.max(width, 10) }} />}
    </div>
  }

  return <>
    <div className="database-calendar-head database-timeline-head">
      <button type="button" className="database-timeline-toggle" aria-label={paneOn ? 'Hide the table' : 'Show the table'} aria-expanded={paneOn} onClick={() => changeView(() => ({ timelineTable: paneOn ? null : true as const }))}>{paneOn ? '«' : '»'}</button>
      <span className="database-calendar-month" />
      <select className="database-timeline-unit" aria-label="Unit" value={unit} onChange={e => { const timelineUnit = e.target.value as TimelineUnit; changeView(() => ({ timelineUnit })) }}>
        {timelineUnits.map(u => <option key={u} value={u}>{u[0]!.toUpperCase() + u.slice(1)}</option>)}
      </select>
      <button type="button" className="database-calendar-today" disabled={showsToday} onClick={goToday}>Today</button>
    </div>
    <div className="database-timeline" ref={scroller} onScroll={onScroll} onKeyDown={onKeyDown} role="group" aria-label="Timeline">
      <div className="database-timeline-body" style={{ width: scaleWidth }}>
        <div className="database-scale" onPointerMove={e => { if (canSet && e.pointerType === 'mouse') setHover(dayAtX(e.clientX)) }} onPointerLeave={() => setHover(null)}>
          {paneOn && <div className="database-pane database-pane-head" style={{ width: pane, height: 44 }}><span style={{ width: nameWidth }}>Name{hiddenColumns > 0 && <button type="button" className="app-link database-pane-more" onClick={() => openDatabaseMenu(blockId, databaseId, 'properties')}> · {hiddenColumns} more</button>}</span>{columns.map(c => <span key={c.property.id} style={{ width: columnWidth }}>{c.property.name}</span>)}</div>}
          <div className="database-scale-upper">{upper.map((t, i) => <span key={t.at} className="database-scale-label" style={{ left: pane + Math.max(0, t.at) * width, width: ((upper[i + 1]?.at ?? total) - Math.max(0, t.at)) * width }}><span>{t.label}</span></span>)}</div>
          <div className="database-scale-lower">{lower.map(t => <span key={t.at} className="database-scale-tick" style={{ left: pane + t.at * width }}>{t.label}</span>)}</div>
          {hover && canSet && <button type="button" className="database-scale-add" aria-label={`New on ${short(hover)}`} style={{ left: pane + daysBetween(origin, hover) * width + width / 2 }} onClick={() => addOn(hover)}>+</button>}
        </div>
        <div className="database-timeline-grid" aria-hidden="true" style={{ left: pane }}>
          {lower.map(t => <span key={t.at} className="database-grid-line" style={{ left: t.at * width }} />)}
          <span className="database-today-line" style={{ left: todayAt }} />
        </div>
        {groups ? groups.shown.map(group => {
          const isFolded = folded.has(group.key), here = bars.filter(b => group.rows.includes(b.row)), shown = here.slice(0, limitOf(group.key))
          return <Fragment key={group.key}>
            {lineLane(<button type="button" className="database-group-fold" aria-expanded={!isFolded} onClick={() => toggle(group.key)}>
              <ChevronRightIcon /><GroupName groups={groups} group={group} /><span className="database-group-count">· {group.rows.length}</span>
            </button>, 'database-timeline-group')}
            {!isFolded && <>
              {shown.map((b, i) => barLine(b, i, group.key))}
              {lineLane(<>
                {here.length > shown.length && <button type="button" className="database-more" onClick={() => showMore(group.key)}>Show 25 more</button>}
                <button type="button" className="database-new" onClick={() => addRow(group.key)}>+ New</button>
              </>, 'database-group-end', group.key)}
              {hasFoot && foot(group.rows)}
            </>}
          </Fragment>
        }) : drawn.map((b, i) => barLine(b, i))}
        {!groups && bars.length > limit && lineLane(<button type="button" className="database-more" onClick={() => setLimit(limit + 25)}>Show 25 more</button>)}
        {!groups && hasFoot && foot(rows)}
        {undated.length > 0 && lineLane(<button type="button" className="database-undated-head" aria-expanded={undatedOpen} onClick={() => setUndatedOpen(!undatedOpen)}>No date · {undated.length} ›</button>)}
        {undatedOpen && undated.map(undatedLane)}
      </div>
    </div>
  </>
}
