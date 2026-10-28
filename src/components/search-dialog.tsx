import { Modal, SearchField } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildSearchIndex, linesByPage, matchRanges, search, snippet, type LineHit, type PageHit, type TagHit } from '../domain/search'
import type { LocalDate, Page, Workspace } from '../domain/types'
import { addDays, fromIso, longLabel } from './dates'
import { CalendarIcon, PageKindIcon, SearchIcon, TagsIcon } from './icons'
import { pageHref, pageLabel, recentIds, useToday } from './page-tree'
import { useWorkspace } from './use-day'

// Search (docs/design/search-states.md): one field over everything written, in the dialog Move to… uses (a dialog
// near the top on a laptop, a sheet on the phone). Results come as you type, grouped Pages · Tags · Lines; ↑↓ and
// Enter open one; the empty field lists Today and the pages opened recently.

const openEvent = 'daythread:search'
/** Opens the search from anywhere (the sidebar row, the phone's button, ⌘K). */
export function openSearch() {
  window.dispatchEvent(new Event(openEvent))
}

/** A field, textarea or the editor has the keys: ⌘K there is theirs (BlockNote's link shortcut), not the search's. */
function typing(): boolean {
  const el = document.activeElement
  return Boolean(el && (el.closest('.bn-editor, input, textarea, select, [contenteditable="true"]')))
}

/** Mounted once in the app frame: listens for `openSearch()` and ⌘K / Ctrl+K, and shows the dialog. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = () => setOpen(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && !e.isComposing && !typing()) { e.preventDefault(); setOpen(true) }
    }
    window.addEventListener(openEvent, show)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener(openEvent, show); window.removeEventListener('keydown', onKey) }
  }, [])
  if (!open) return null
  return <SearchDialog onClose={() => setOpen(false)} />
}

function usePhone() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 599px)')
    const update = () => setPhone(media.matches)
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return phone
}

/** Typed words in bold where they occur, the rest as it is. Nothing else changes colour (system-v2: grey, bolder). */
function Marked({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query)
  if (ranges.length === 0) return <>{text}</>
  const parts: ReactNode[] = []
  let at = 0
  for (const r of ranges) { parts.push(text.slice(at, r.start), <mark key={r.start}>{text.slice(r.start, r.end)}</mark>); at = r.end }
  parts.push(text.slice(at))
  return <>{parts}</>
}

/** "Today", "Yesterday", "Sun, Oct 18": where a line was written, when it was on a day. */
function dayWord(date: LocalDate, today: LocalDate): string {
  return date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : longLabel(date)
}
/** "Oct 18", for a path or a detail where the weekday would be noise. */
const shortDay = (date: LocalDate, today: LocalDate) => date === today ? 'Today' : fromIso(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

type Row = { key: string; href: string; render: (active: boolean) => ReactNode }

function lineHref(hit: LineHit): string {
  return hit.page.type === 'daily' && hit.date
    ? `/day/${hit.date}?block=${encodeURIComponent(hit.blockId)}`
    : `/pages?page=${encodeURIComponent(hit.page.id)}&block=${encodeURIComponent(hit.blockId)}&from=search`
}

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const phone = usePhone()
  const today = useToday()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const index = useMemo(() => workspace ? buildSearchIndex(workspace, d => shortDay(d, today)) : null, [workspace, today])
  const trimmed = query.trim()
  const results = useMemo(() => index && trimmed ? search(index, trimmed, today, addDays(today, -1)) : null, [index, trimmed, today])

  const go = (href: string) => { onClose(); void navigate({ href, resetScroll: !href.includes('block=') }) }

  const groups = useMemo(() => build(workspace, results, trimmed, today), [workspace, results, trimmed, today])
  const rows = groups.flatMap(g => g.rows)
  const activeKey = rows[Math.min(active, rows.length - 1)]?.key
  useEffect(() => {
    listRef.current?.querySelector('.search-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [activeKey])

  // react-aria stops a key at this handler unless told otherwise; Escape must still reach the field and the dialog.
  const onKeyDown = (e: React.KeyboardEvent & { continuePropagation: () => void }) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing && rows[active]) { e.preventDefault(); go(rows[active]!.href) }
    else e.continuePropagation()
  }

  const total = results ? results.pages.length + results.tags.length + results.lines.length : 0
  return (
    <Modal.Backdrop isOpen isDismissable onOpenChange={o => { if (!o) onClose() }}>
      <Modal.Container placement={phone ? 'bottom' : 'top'} scroll="inside" className={`search-dialog ${phone ? 'is-sheet' : ''}`}>
        <Modal.Dialog aria-label="Search">
          {phone && <div className="sheet-handle" aria-hidden="true" />}
          <div className="search-head">
            <SearchField aria-label="Search" value={query} onChange={v => { setQuery(v); setActive(0) }} autoFocus fullWidth onKeyDown={onKeyDown}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search pages, days, lines and tags" autoCapitalize="off" autoCorrect="off" enterKeyHint="go" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            {phone && <button type="button" className="app-link search-cancel" onClick={onClose}>Cancel</button>}
          </div>
          <div className="search-list" role="listbox" aria-label={trimmed ? 'Results' : 'Recent'} ref={listRef}>
            {!workspace && <p className="search-note">Loading…</p>}
            {groups.map(g => (
              <Fragment key={g.page ? `page:${g.page.id}` : g.title ?? 'first'}>
                {g.title && <p className="search-group">{g.title}{g.count !== undefined && <span className="search-group-count">{g.count}</span>}</p>}
                {g.page && <PageHeading page={g.page} workspace={workspace!} today={today} />}
                {g.rows.map(r => (
                  <button key={r.key} type="button" role="option" aria-selected={r.key === activeKey} className={`search-row ${r.key === activeKey ? 'active' : ''}`}
                    onClick={() => go(r.href)} onMouseMove={() => { const i = rows.findIndex(x => x.key === r.key); if (i >= 0 && i !== active) setActive(i) }}>
                    {r.render(r.key === activeKey)}
                  </button>
                ))}
              </Fragment>
            ))}
            {results && results.moreLines > 0 && <p className="search-note">{results.moreLines} more line{results.moreLines === 1 ? '' : 's'} match · keep typing to narrow it down</p>}
            {results && total === 0 && (
              <div className="search-empty">
                <p>Nothing matches “{trimmed}”</p>
                <small>Search looks at page titles, days, every line and every #tag. Each word typed has to be on the line.</small>
              </div>
            )}
            {workspace && !trimmed && <p className="search-note search-hint">Type to search everything you’ve written{phone ? '' : ' · ↑↓ to move · Enter to open · Esc to close'}</p>}
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

/** A group label ("Pages", "Lines"), or the page a run of matched lines was written on; either may carry rows. */
interface Group { title?: string; count?: number; page?: Page; rows: Row[] }

/** The groups shown: Today and Recent for an empty field; Pages, Tags and Lines for a query. */
function build(workspace: Workspace | null, results: ReturnType<typeof search> | null, query: string, today: LocalDate): Group[] {
  if (!workspace) return []
  if (!results) {
    // Today first, whether or not its page exists yet (opening it makes the page); then the pages opened lately.
    const todayPage = workspace.pages.find(p => p.type === 'daily' && p.date === today)
    const recent = recentIds().map(id => workspace.pages.find(p => p.id === id)).filter((p): p is Page => Boolean(p) && !p!.trashedAt && p !== todayPage).slice(0, 8)
    const rowOf = (p: Page): Row => ({ key: p.id, href: pageHref(p), render: () => <PageRow page={p} today={today} path={pathOf(workspace, p, today)} query="" /> })
    const todayRow: Row = { key: 'today', href: '/', render: () => <><span className="search-row-icon"><CalendarIcon /></span><span className="search-row-text"><span className="search-row-title">Today</span></span></> }
    return [
      { rows: [todayRow] },
      ...(recent.length ? [{ title: 'Recent', rows: recent.map(rowOf) }] : []),
    ]
  }
  const groups: Group[] = []
  if (results.pages.length) groups.push({ title: 'Pages', rows: results.pages.map((h: PageHit) => ({ key: `p:${h.page.id}`, href: pageHref(h.page), render: () => <PageRow page={h.page} today={today} path={h.path} query={query} /> })) })
  if (results.tags.length) groups.push({ title: 'Tags', rows: results.tags.map((t: TagHit) => ({ key: `t:${t.key}`, href: `/tags/${encodeURIComponent(t.key)}`, render: () => <TagRow hit={t} query={query} /> })) })
  // Lines sit under the page they were written on (Brian: grouped by page, a day page being a page), newest day first.
  if (results.lines.length) {
    groups.push({ title: 'Lines', count: results.lines.length + results.moreLines, rows: [] })
    for (const g of linesByPage(results.lines))
      groups.push({ page: g.page, rows: g.lines.map((l: LineHit) => ({ key: `l:${l.page.id}:${l.blockId}`, href: lineHref(l), render: () => <LineRow hit={l} query={query} workspace={workspace} /> })) })
  }
  return groups
}

/** The path under a page row: the day of a day's subpage, or "Pages › Parent"; a day page has none. */
function pathOf(workspace: Workspace, p: Page, today: LocalDate): string {
  if (p.type === 'daily' || !p.parentId) return ''
  const parent = workspace.pages.find(x => x.id === p.parentId)
  return parent ? (parent.type === 'daily' && parent.date ? shortDay(parent.date, today) : `Pages › ${pageLabel(parent, today)}`) : ''
}

function PageRow({ page, today, path, query }: { page: Page; today: LocalDate; path: string; query: string }) {
  return (
    <>
      <span className="search-row-icon">{page.type === 'daily' ? <CalendarIcon /> : <PageKindIcon url={page.url} />}</span>
      <span className="search-row-text">
        <span className={`search-row-title ${page.type === 'document' && !page.title ? 'untitled' : ''}`}><Marked text={pageLabel(page, today)} query={page.type === 'daily' ? '' : query} /></span>
        {path && <small>{path}</small>}
      </span>
    </>
  )
}

function TagRow({ hit, query }: { hit: TagHit; query: string }) {
  return (
    <>
      <span className="search-row-icon"><TagsIcon /></span>
      <span className="search-row-text">
        <span className="search-row-title"><span className="tag-plain-mark">#</span><Marked text={hit.tag} query={query.replace(/(^|\s)[#＃]/gu, '$1')} /></span>
        <small>{hit.count} block{hit.count === 1 ? '' : 's'}</small>
      </span>
    </>
  )
}

/** The page a run of lines was written on: its icon and label, its path quietly after. Not a row: the lines open it. */
function PageHeading({ page, workspace, today }: { page: Page; workspace: Workspace; today: LocalDate }) {
  const path = pathOf(workspace, page, today)
  return (
    <p className="search-page">
      <span className="search-row-icon">{page.type === 'daily' ? <CalendarIcon /> : <PageKindIcon url={page.url} />}</span>
      <span className={`search-page-title ${page.type === 'document' && !page.title ? 'untitled' : ''}`}>{page.type === 'daily' && page.date ? dayWord(page.date, today) : pageLabel(page, today)}</span>
      {path && <small>{path}</small>}
    </p>
  )
}

function LineRow({ hit, query, workspace }: { hit: LineHit; query: string; workspace: Workspace }) {
  const task = hit.taskId ? workspace.tasks.find(t => t.id === hit.taskId) : undefined
  return (
    <>
      <span className="search-row-icon">
        {task
          ? <input type="checkbox" className="check" checked={task.status === 'done'} readOnly disabled tabIndex={-1} aria-label={task.status === 'done' ? 'Done' : 'Open'} />
          : <span className="search-row-dot" aria-hidden="true" />}
      </span>
      <span className="search-row-text">
        <span className={`search-row-line ${task?.status === 'done' ? 'is-done' : ''}`}><Marked text={snippet(hit.text, query)} query={query} /></span>
        {hit.sectionTitle && <small>{hit.sectionTitle}</small>}
      </span>
    </>
  )
}

/** The sidebar's Search row: the icon, the word, and the shortcut as a quiet hint. */
export function SidebarSearchRow() {
  const [mac, setMac] = useState(true)
  useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent)) }, [])
  return (
    <button type="button" className="side-row search-side-row" onClick={openSearch}>
      <SearchIcon size={19} />
      Search
      <kbd className="side-kbd" aria-hidden="true">{mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  )
}
