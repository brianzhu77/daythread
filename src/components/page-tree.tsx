import { Modal, SearchField } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cardTo, childPages, linkedFrom, moveRefusal, moveTargets, pageAncestors, pagesInDays, parentOf, sidebarDays, subtreeIds } from '../domain/page-tree'
import type { LocalDate, Page, Workspace } from '../domain/types'
import { fromIso, longLabel, todayIso } from './dates'
import { ChevronRightIcon, PageKindIcon, PagesIcon } from './icons'
import { NewPageMenu } from './new-page-menu'
import { displayPageTitle } from './page-title'
import { RowMenu } from './row-menu'
import { useTreeDrag, type Drop } from './tree-drag'
import { useDeletePage } from './trash'
import { useWorkspace } from './use-day'

// pages-delta N-2 / N-5 / N-9 step B, laid out per Jazz docs/design/pages-tree-layout.md (cfc7b92): breadcrumb,
// Linked from, Subpages, Move to… and the sidebar tree.

/** "Today" (decided when shown, never stored), "Sun, Oct 18" for other days; the title or "Untitled" otherwise. */
export function pageLabel(p: Page, today: LocalDate = todayIso()): string {
  if (p.type === 'daily' && p.date) return p.date === today ? 'Today' : longLabel(p.date)
  return displayPageTitle(p)
}

export function pageHref(p: Page, cardId?: string): string {
  const block = cardId ? `${p.type === 'daily' ? '?' : '&'}block=${encodeURIComponent(cardId)}` : ''
  return (p.type === 'daily' && p.date ? `/day/${p.date}` : `/pages?page=${encodeURIComponent(p.id)}`) + block
}

/** Today's date, re-read every minute so "Today" becomes a date after midnight without a reload. */
export function useToday(): LocalDate {
  const [today, setToday] = useState(todayIso)
  useEffect(() => {
    const timer = setInterval(() => setToday(todayIso()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
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

function useOpen() {
  const navigate = useNavigate()
  return (href: string, resetScroll = true) => void navigate({ href, resetScroll })
}

/** An in-app link: a real href for new tabs, client navigation on a plain click. */
export function PageLink({ href, className, children, title, current }: { href: string; className?: string; children: ReactNode; title?: string; current?: boolean }) {
  const open = useOpen()
  return <a href={href} className={className} title={title} aria-current={current ? 'page' : undefined}
    onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); open(href, !href.includes('block=')) }}>{children}</a>
}

const LinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </svg>
)

// ---------------------------------------------------------------- page header

/**
 * Layout §2: the breadcrumb (root down to the parent) with ⋯ on the same row. It replaces "‹ Parent". The parent
 * crumb lands on this page's card when the parent has one. Crumbs that don't fit fold into "…" between the first and
 * the last.
 */
export function PageHeaderRow({ page, workspace }: { page: Page; workspace: Workspace }) {
  const today = useToday()
  const chain = pageAncestors(workspace, page.id)
  const pathRef = useRef<HTMLDivElement>(null)
  const [folded, setFolded] = useState(false)
  // Bumped on every width change: unfolding alone is a no-op when the path is already unfolded, and then nothing would
  // re-render to measure the narrower row.
  const [, remeasure] = useState(0)
  const key = chain.map(p => `${p.id}:${p.title}`).join('/')
  useLayoutEffect(() => setFolded(false), [key])
  useLayoutEffect(() => {
    const el = pathRef.current
    if (el && !folded && el.scrollWidth > el.clientWidth + 1) setFolded(true)
  })
  useEffect(() => {
    const el = pathRef.current
    if (!el) return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; setFolded(false); remeasure(n => n + 1) } })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const parent = chain.at(-1)
  const card = (parent ? cardTo(parent, page.id) : undefined)
  // "Pages" heads a chain rooted in a document page; a day heads its own chain.
  const items: (Page | 'pages')[] = [...(chain[0]?.type === 'daily' ? [] : ['pages' as const]), ...chain]
  const crumb = (item: Page | 'pages', last: boolean) => item === 'pages'
    ? <PageLink key="pages" className="crumb" href="/pages">Pages</PageLink>
    : <PageLink key={item.id} className={`crumb ${last ? 'crumb-last' : ''}`} href={pageHref(item, last ? card?.id : undefined)} title={pageLabel(item, today)}>{pageLabel(item, today)}</PageLink>
  const crumbs = folded && items.length > 2
    ? [crumb(items[0]!, false), <HiddenCrumbs key="more" pages={items.slice(1, -1) as Page[]} today={today} />, crumb(items.at(-1)!, true)]
    : items.map((item, i) => crumb(item, i === items.length - 1))
  return (
    <div className="crumbs">
      {/* Crumbs don't shrink until folding is decided, so an overflow can be measured. */}
      <nav className={`crumbs-path ${folded ? 'folded' : 'measuring'}`} aria-label="Page location" ref={pathRef}>
        {crumbs.map((c, i) => <Fragment key={i}>{i > 0 && <span className="crumb-sep" aria-hidden="true"><ChevronRightIcon /></span>}{c}</Fragment>)}
      </nav>
      <PageMenu page={page} />
    </div>
  )
}

function HiddenCrumbs({ pages, today }: { pages: Page[]; today: LocalDate }) {
  const open = useOpen()
  return <RowMenu label="Hidden ancestors" trigger="…" triggerClass="crumb crumb-more"
    groups={[{ items: [...pages].reverse().map(p => ({ label: pageLabel(p, today), onSelect: () => open(pageHref(p)) })) }]} />
}

/** ⋯ on a document page: Move to…, then Delete after a divider (A4 layout §1). Day pages have none this round. */
export function PageMenu({ page }: { page: Page }) {
  const [moving, setMoving] = useState(false)
  const deletePage = useDeletePage()
  if (page.type === 'daily') return null
  return (
    <>
      <RowMenu label="Page actions" triggerClass="page-more" groups={[{ items: [{ label: 'Move to…', onSelect: () => setMoving(true) }] }, { items: [{ label: 'Delete', danger: true, onSelect: () => void deletePage(page, page.id) }] }]} />
      {moving && <MovePageDialog page={page} onClose={() => setMoving(false)} />}
    </>
  )
}

/** Layout §3 / N-5: real references only, newest first; the breadcrumb parent is never repeated (Lead 81ce1b0a). */
export function LinkedFrom({ page, workspace }: { page: Page; workspace: Workspace }) {
  const [all, setAll] = useState(false)
  const today = useToday()
  const entries = linkedFrom(workspace, page.id).filter(e => !e.isParent)
  if (entries.length === 0) return null
  const shown = all ? entries : entries.slice(0, 3)
  return (
    <p className="linked-from">
      <span className="linked-from-label"><LinkIcon />Linked from</span>
      {/* A4: a source page in the trash reads "(removed)" and doesn't open (layout §2, N-5). */}
      {shown.map(({ page: p, removed }) => removed
        ? <span key={p.id} className="linked-from-removed">{pageLabel(p, today)} (removed)</span>
        : <PageLink key={p.id} href={pageHref(p)}>{pageLabel(p, today)}</PageLink>)}
      {entries.length > shown.length && <button type="button" className="linked-from-more" onClick={() => setAll(true)}>{entries.length - shown.length} more</button>}
    </p>
  )
}

/** Layout §4 / N-2: every child closes the page, card or no card, so a child is never invisible. */
export function Subpages({ page, workspace }: { page: Page; workspace: Workspace }) {
  const today = useToday()
  const children = childPages(workspace, page.id)
  if (children.length === 0) return null
  return (
    <section className="subpages" aria-label="Subpages">
      <h2 className="subpages-title">Subpages <span>{children.length}</span></h2>
      <ul className="plain">
        {children.map(c => {
          const n = childPages(workspace, c.id).length
          return (
            <li key={c.id}>
              <PageLink className="subpage-row" href={pageHref(c)} title={pageLabel(c, today)}>
                <PageKindIcon url={c.url} database={Boolean(c.database)} />
                <span className={`subpage-title ${c.title ? '' : 'untitled'}`}>{pageLabel(c, today)}</span>
                {n > 0 && <span className="subpage-count">{n}</span>}
                <ChevronRightIcon />
              </PageLink>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------- Move to…

const recentKey = 'daythread.recentPages'
/** Recently opened pages and days, newest first, for Move to…'s empty search. View state only. */
export function rememberOpened(pageId: string) {
  try {
    const list = [pageId, ...(JSON.parse(localStorage.getItem(recentKey) ?? '[]') as string[]).filter(id => id !== pageId)].slice(0, 12)
    localStorage.setItem(recentKey, JSON.stringify(list))
  } catch { /* storage unavailable: no Recent group */ }
}
/** The ids `rememberOpened` kept, newest first; the search's empty state lists them too. */
export function recentIds(): string[] {
  try { return JSON.parse(localStorage.getItem(recentKey) ?? '[]') } catch { return [] }
}

/** "Pages › Work · 2026 planning", or the day for a day's subpage. */
function pathText(ws: Workspace, p: Page): string {
  if (p.type === 'daily') return ''
  const chain = pageAncestors(ws, p.id)
  return [...(chain[0]?.type === 'daily' ? [] : ['Pages']), ...chain.map(x => pageLabel(x))].join(' › ')
}

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (at < 0) return <>{text}</>
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>
}

const moveRefusals = /Page not found|Can't move a page into itself or its subpages|Already there|Day pages stay in Days/
const moveOrStale = new RegExp(`${moveRefusals.source}|Saved elsewhere`)
// A drop is checked on the pages on screen; one the server refuses anyway (changed meanwhile) needs no red bar.
const dropRefusals = new RegExp(`${moveRefusals.source}|Page is in trash`)
const dropOrStale = new RegExp(`${dropRefusals.source}|Saved elsewhere`)
const refusalCopy = (m: string) => m === 'Page not found' ? 'That page is gone' : m.startsWith("Can't move") ? "Can't move into its own subpage" : m === 'Already there' ? 'Already here' : m

type Option = { key: string; parentId: string | null; label: string; path: string; current: boolean; icon: 'page' | 'day' | 'top' }

/**
 * Layout §5: a dialog on desktop, a sheet on the phone. Search is focused; the page and its subpages aren't listed;
 * the current parent stays, greyed, as "Current". Tap or Enter moves at once with "Moved to … · Undo". A refusal
 * (target gone, or moved under this page meanwhile) stays in the dialog on its row.
 */
export function MovePageDialog({ page, onClose }: { page: Page; onClose: () => void }) {
  const { workspace, run } = useWorkspace()
  const phone = usePhone()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [refused, setRefused] = useState<{ key: string; label: string; text: string } | null>(null)
  const [today] = useState(todayIso)
  if (!workspace) return null
  const current = parentOf(workspace, page)
  const excluded = subtreeIds(workspace, page.id).size - 1
  const option = (p: Page | null, current: boolean): Option => p
    ? { key: p.id, parentId: p.id, label: pageLabel(p, today), path: pathText(workspace, p), current, icon: p.type === 'daily' ? 'day' : 'page' }
    : { key: 'top', parentId: null, label: 'Top level', path: 'Shows in Pages', current, icon: 'top' }
  const candidates = [...moveTargets(workspace, page.id), ...(current ? [current] : [])]
  const q = query.trim().toLowerCase()
  let groups: { title?: string; options: Option[] }[]
  if (!q) {
    const todayPage = workspace.pages.find(p => p.type === 'daily' && p.date === today)
    const recent = recentIds().map(id => candidates.find(p => p.id === id)).filter((p): p is Page => Boolean(p) && p !== todayPage && p !== current).slice(0, 6)
    const first = [null, todayPage, current].filter((p, i, list) => p !== undefined && list.indexOf(p) === i && (p === null || candidates.includes(p)))
    groups = [
      { options: first.map(p => p ? option(p, current?.id === p.id) : option(null, !current)) },
      ...(recent.length ? [{ title: 'Recent', options: recent.map(p => option(p, current?.id === p.id)) }] : []),
    ]
  } else {
    const matches = candidates
      .filter(p => pageLabel(p, today).toLowerCase().includes(q))
      .sort((a, b) => Number(b.type === 'daily') - Number(a.type === 'daily') || (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 50)
    groups = [{ options: [...('top level'.includes(q) ? [option(null, !current)] : []), ...matches.map(p => option(p, current?.id === p.id))] }]
  }
  const pickable = groups.flatMap(g => g.options).filter(o => !o.current)
  const move = async (o: Option, retried = false): Promise<void> => {
    if (o.current) return
    setRefused(null)
    let stale = false
    const receipt = await run({ type: 'move-page', pageId: page.id, parentId: o.parentId },
      r => ({ text: o.parentId ? `Moved to ${o.label}` : 'Moved to top level', undoOperationId: r.operationId }), undefined,
      { inlineRefusal: retried ? moveRefusals : moveOrStale, onRefused: m => { if (m === 'Saved elsewhere') stale = true; else setRefused({ key: o.key, label: o.label, text: refusalCopy(m) }) } })
    // Something else was saved since the dialog opened. The move is checked again on the latest pages, once: it
    // either applies or is refused on its row.
    if (stale) return move(o, true)
    if (receipt) onClose()
  }
  // react-aria stops a key at this handler unless told otherwise; Escape must still reach the field and the dialog.
  const onKeyDown = (e: React.KeyboardEvent & { continuePropagation: () => void }) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, Math.min(pickable.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
    else if (e.key === 'Enter' && pickable[active]) { e.preventDefault(); void move(pickable[active]!) }
    else e.continuePropagation()
  }
  const activeKey = pickable[Math.min(active, pickable.length - 1)]?.key
  return (
    <Modal.Backdrop isOpen isDismissable onOpenChange={o => { if (!o) onClose() }}>
      <Modal.Container placement={phone ? 'bottom' : 'top'} scroll="inside" className={`move-dialog ${phone ? 'is-sheet' : ''}`}>
        <Modal.Dialog aria-label={`Move “${pageLabel(page)}”`}>
          {phone && <div className="sheet-handle" aria-hidden="true" />}
          <header className="move-head">
            <h2>Move “{pageLabel(page)}”</h2>
            <button type="button" className="app-link" onClick={onClose}>Cancel</button>
          </header>
          <SearchField aria-label="Search pages and days" value={query} onChange={v => { setQuery(v); setActive(0) }} autoFocus fullWidth onKeyDown={onKeyDown}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search pages and days" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <div className="move-list" role="listbox" aria-label="Destinations">
            {groups.map((g, gi) => (
              <Fragment key={gi}>
                {g.title && <p className="move-group">{g.title}</p>}
                {g.options.map(o => (
                  <button key={o.key} type="button" role="option" aria-selected={o.key === activeKey} aria-disabled={o.current || undefined}
                    className={`move-row ${o.current ? 'current' : ''} ${o.key === activeKey ? 'active' : ''}`} onClick={() => void move(o)}>
                    <span className="move-row-icon">{o.icon === 'page' ? <PagesIcon /> : o.icon === 'day' ? <DayIcon /> : <TopIcon />}</span>
                    <span className="move-row-text">
                      <span><Highlight text={o.label} query={query.trim()} /></span>
                      {(refused?.key === o.key || o.path) && <small className={refused?.key === o.key ? 'refused' : undefined}>{refused?.key === o.key ? refused.text : o.path}</small>}
                    </span>
                    {o.current && <span className="move-row-tag">Current</span>}
                  </button>
                ))}
              </Fragment>
            ))}
            {/* The refused row may have left the list once the latest pages arrived; its reason still shows. */}
            {refused && !groups.some(g => g.options.some(o => o.key === refused.key)) && <p className="move-refused" role="status">“{refused.label}” · {refused.text}</p>}
            {q && groups.every(g => g.options.length === 0) && <p className="move-empty">No page or day called “{query.trim()}”</p>}
            {excluded > 0 ? <p className="move-note">This page and its {excluded} subpage{excluded === 1 ? '' : 's'} aren’t listed.</p> : <p className="move-note">This page isn’t listed.</p>}
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

const DayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" />
  </svg>
)
const TopIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
)

// ---------------------------------------------------------------- sidebar

const expandedKey = 'daythread.sidebar.expanded'
/** Expanded rows are view state in localStorage; the open page's ancestors are always added (layout §1). */
function useExpanded(activeChain: string[]) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    try { setExpanded(s => new Set([...s, ...JSON.parse(localStorage.getItem(expandedKey) ?? '[]')])) } catch { /* starts collapsed */ }
  }, [])
  const key = activeChain.join('/')
  useEffect(() => {
    if (activeChain.length) setExpanded(s => activeChain.every(id => s.has(id)) ? s : new Set([...s, ...activeChain]))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setExpanded(s => {
    const next = new Set(s)
    if (!next.delete(id)) next.add(id)
    try { localStorage.setItem(expandedKey, JSON.stringify([...next])) } catch { /* view state only */ }
    return next
  })
  const expand = (id: string) => { if (!expanded.has(id)) toggle(id) }
  return { expanded, toggle, expand }
}

const monthName = (ym: string, today: LocalDate) => {
  const d = new Date(`${ym}-01T12:00:00`)
  return ym.slice(0, 4) === today.slice(0, 4) ? d.toLocaleDateString('en-US', { month: 'long' }) : `${ym.slice(0, 4)} · ${d.toLocaleDateString('en-US', { month: 'long' })}`
}

/**
 * Layout §1: Days (Today, this month's days with content, earlier months collapsed), then the Pages tree under a "Pages"
 * label with its own + (Notion's section +, always shown: Brian never found the old "＋ New page" row at the bottom).
 * Chevron opens and closes; the title opens the page. A row's `+` and `⋯` show on hover or keyboard focus.
 */
export function SidebarTree({ workspace, activeId, today, footer }: { workspace: Workspace; activeId: string | null; today: LocalDate; footer: ReactNode }) {
  const activeChain = activeId ? [...pageAncestors(workspace, activeId).map(p => p.id)] : []
  const activeMonth = workspace.pages.find(p => p.id === activeId)?.date?.slice(0, 7)
  const { expanded, toggle, expand } = useExpanded(activeMonth ? [...activeChain, `month:${activeMonth}`] : activeChain)
  const [moving, setMoving] = useState<Page | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { run, latest } = useWorkspace()
  const open = useOpen()
  const deletePage = useDeletePage()
  useEffect(() => {
    listRef.current?.querySelector('.tree-row[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeId, expanded])

  // Both +s make an untitled page and open it with the caret in its title (Notion's way), at the top level or inside one.
  const newDatabase = async () => {
    const pageId = crypto.randomUUID()
    const receipt = await run({ type: 'create-database', pageId, homeBlockId: null, title: '' })
    if (receipt) open(`/pages?page=${encodeURIComponent(pageId)}&focus=title`)
  }
  const newPage = async (parent: Page | null) => {
    const pageId = crypto.randomUUID()
    const receipt = await run({ type: 'create-document', title: '', body: '', pageId, ...(parent ? { parentId: parent.id } : {}) })
    if (receipt) open(`/pages?page=${encodeURIComponent(pageId)}&focus=title`)
  }

  // B14: every drop says where the page went, with Undo, as Move to… does. A drop refused on the latest pages (the
  // target went meanwhile) changes nothing and the tree shows where things are now.
  const dropPage = async (pageId: string, drop: Drop, retried = false): Promise<void> => {
    const ws = latest() ?? workspace
    const page = ws.pages.find(p => p.id === pageId), parent = drop.parentId ? ws.pages.find(p => p.id === drop.parentId) : null
    if (!page) return
    const reorder = (parentOf(ws, page)?.id ?? null) === drop.parentId
    const text = reorder ? 'Moved' : parent ? `Moved to ${pageLabel(parent, today)}` : 'Moved to top level'
    let stale = false
    const receipt = await run({ type: 'move-page', pageId, parentId: drop.parentId, beforeId: drop.beforeId }, r => ({ text, undoOperationId: r.operationId }), undefined,
      { inlineRefusal: retried ? dropRefusals : dropOrStale, onRefused: m => { stale = m === 'Saved elsewhere' } })
    if (stale) return dropPage(pageId, drop, true)
    if (receipt && drop.zone === 'inside' && drop.parentId) expand(drop.parentId)
  }
  const drag = useTreeDrag({
    refuse: (pageId, parentId, beforeId) => moveRefusal(latest() ?? workspace, pageId, parentId, beforeId) !== null,
    onDrop: (pageId, drop) => void dropPage(pageId, drop),
    scroller: () => listRef.current?.closest<HTMLElement>('.sidebar') ?? null,
  })

  const row = (p: Page, depth: number, nextId = ''): ReactNode => {
    const children = childPages(workspace, p.id)
    const isOpen = expanded.has(p.id)
    const day = p.type === 'daily'
    // Today's nav row is already selected when today is open; no second highlight here.
    const current = p.id === activeId && !(day && p.date === today)
    const dropHere = drag.drop?.rowKey === p.id ? drag.drop : null
    const dragged = drag.dragging?.pageId === p.id ? (drag.dragging.touch ? 'touch' : 'mouse') : undefined
    return (
      <li key={p.id} role="treeitem" aria-expanded={children.length ? isOpen : undefined} aria-selected={current}>
        <div className="tree-row" aria-current={current ? 'page' : undefined}
          style={{ '--depth': Math.min(depth, 6), ...(dropHere ? { '--drop-depth': Math.min(dropHere.depth, 6) } : {}) } as React.CSSProperties}
          data-page={p.id} data-kind={day ? 'day' : 'page'} data-depth={depth} data-parent={parentOf(workspace, p)?.id ?? ''} data-next={nextId}
          data-first-child={isOpen ? children[0]?.id ?? '' : ''} data-drop-zone={dropHere?.zone} data-dragging={dragged}
          onPointerDown={day ? undefined : e => drag.onPointerDown(e, pageLabel(p, today))} onDragStart={e => e.preventDefault()}>
          {children.length > 0
            ? <button type="button" className="disclose" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${pageLabel(p, today)}`} onClick={() => toggle(p.id)}><ChevronRightIcon /></button>
            : <span className="disclose none" aria-hidden="true" />}
          <PageLink className="tree-title" href={pageHref(p)} title={pageLabel(p, today)}>{!day && <PageKindIcon url={p.url} database={Boolean(p.database)} />}<span>{pageLabel(p, today)}</span></PageLink>
          <span className="tree-acts">
            <button type="button" aria-label={`New subpage in ${pageLabel(p, today)}`} onClick={() => void newPage(p)}>+</button>
            {!day && <RowMenu label={`Actions for ${pageLabel(p, today)}`} triggerClass="tree-more"
              groups={[{ items: [{ label: 'Move to…', onSelect: () => setMoving(p) }] }, { items: [{ label: 'Delete', danger: true, onSelect: () => void deletePage(p, activeId) }] }]} />}
          </span>
        </div>
        {isOpen && children.length > 0 && <ul className="plain" role="group">{children.map((c, i) => row(c, depth + 1, children[i + 1]?.id))}</ul>}
      </li>
    )
  }

  const { recent: thisMonth, earlier } = sidebarDays(workspace, today, activeId)
  const roots = childPages(workspace, null)
  return (
    <div className="side-group" ref={listRef}>
      <p className="side-label">Days</p>
      <ul className="plain tree" role="tree" aria-label="Days">
        {thisMonth.map(p => row(p, 0))}
        {[...earlier].map(([ym, list]) => {
          const id = `month:${ym}`, isOpen = expanded.has(id)
          return (
            <li key={ym} role="treeitem" aria-expanded={isOpen}>
              <button type="button" className="tree-row month" onClick={() => toggle(id)} aria-expanded={isOpen}>
                <span className="disclose" aria-hidden="true"><ChevronRightIcon /></span><span className="tree-title">{monthName(ym, today)}</span>
              </button>
              {isOpen && <ul className="plain" role="group">{list.map(p => row(p, 0))}</ul>}
            </li>
          )
        })}
      </ul>
      <div className="side-label-row" data-drop-top data-first={roots[0]?.id ?? ''} data-drop-zone={drag.drop?.rowKey === 'top' ? 'after' : undefined}>
        <p className="side-label">Pages</p>
        {/* Page or Database, as Pages' + offers (design §3.1). */}
        <NewPageMenu className="side-label-add" onPage={() => void newPage(null)} onDatabase={() => void newDatabase()}>+</NewPageMenu>
      </div>
      {/* Only top-level pages (Brian 992f14f8, Notion's model): pages made in a day stay under that day above. */}
      {roots.length > 0 ? <ul className="plain tree" role="tree" aria-label="Pages">{roots.map((p, i) => row(p, 0, roots[i + 1]?.id))}</ul> : <p className="side-row small side-hint">No pages yet</p>}
      {footer}
      {moving && <MovePageDialog page={moving} onClose={() => setMoving(null)} />}
    </div>
  )
}

