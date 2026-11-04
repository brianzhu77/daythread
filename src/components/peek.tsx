// A row over its view (docs/design/peek.md §3). The same head and body as its full page, with its own scroller and scope, so its editor
// neither scrolls the window nor reaches into the page behind. Closing is leaving a page: the editor sends its leaving save.
import { Navigate, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { elementScroller, EditorScrollerContext, windowScroller } from './editor-scope'
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, ExternalIcon } from './icons'
import { displayPageTitle } from './page-title'
import { noteOpenedHere, peekFloor, peekOpenedHere, peekOrder, sideFloor } from './peek-state'
import { PageMenu, PagePath } from './page-tree'
import { PageContent } from './pages-screen'
import { useWide } from './property-editors'
import { useWorkspace } from './use-day'

/** Anything that takes Esc before the peek does: one Esc per layer, innermost first (§3). */
const innerLayer = '#bn-suggestion-menu, .database-menu, .app-menu, [data-slot="popover-content"], .bn-formatting-toolbar, .paste-link-menu'
/** The same for what's picked in this peek: beside a side peek, a pick in the view is the view's own. */
const innerPick = '.is-picked, .editor-selection-bar'

function useRoomForSide() {
  const query = `(min-width: ${sideFloor}px)`
  const [room, setRoom] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query), change = () => setRoom(list.matches)
    change()
    list.addEventListener('change', change)
    return () => list.removeEventListener('change', change)
  }, [query])
  return room
}

export function PeekHost() {
  const { workspace } = useWorkspace()
  const search = useRouterState({ select: s => s.location.search as { peek?: string; page?: string; side?: 1 | '1' } })
  const wide = useWide()
  const roomForSide = useRoomForSide()
  const rowId = search.peek
  if (!rowId || !workspace) return null
  const row = workspace.pages.find(p => p.id === rowId && !p.trashedAt)
  if (!row) return <PeekGone />
  // Below the floor, a link with ?peek opens as a full page.
  if (!wide || window.innerWidth < peekFloor) return <Navigate to="/pages" search={{ page: rowId }} replace />
  // The page behind already is this row: two editors on one page would collide (§4).
  if (search.page === rowId) return <PeekGone />
  return <Peek key="peek" rowId={rowId} side={Boolean(search.side) && roomForSide} />
}

function useClosePeek() {
  const navigate = useNavigate(), router = useRouter()
  return () => {
    if (peekOpenedHere()) { noteOpenedHere(false); router.history.back(); return }
    void navigate({ to: '.', search: (({ peek: _peek, side: _side, ...rest }: Record<string, unknown>) => rest) as never, replace: true, resetScroll: false })
  }
}
function PeekGone() {
  const navigate = useNavigate()
  useEffect(() => { noteOpenedHere(false); void navigate({ to: '.', search: (({ peek: _peek, side: _side, ...rest }: Record<string, unknown>) => rest) as never, replace: true, resetScroll: false }) }, [navigate])
  return null
}

function Peek({ rowId, side }: { rowId: string; side: boolean }) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const close = useClosePeek()
  const panel = useRef<HTMLDivElement>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const scroller = useMemo(() => (scrollEl ? elementScroller(scrollEl) : windowScroller), [scrollEl])
  const row = workspace!.pages.find(p => p.id === rowId)!
  const order = peekOrder(), at = order.indexOf(rowId)
  // Moving replaces the entry, so Back closes the peek instead of walking through every row.
  const go = (id: string | undefined) => {
    if (!id) return
    void navigate({ to: '.', search: ((prev: Record<string, unknown>) => ({ ...prev, peek: id })) as never, replace: true, resetScroll: false })
    // The row it's now on, in the view beside it.
    if (side) document.querySelector(`.app-main [data-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // The page behind keeps its scroll, and doesn't move while this is up.
  useEffect(() => {
    if (side) return
    const root = document.documentElement, before = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = before }
  }, [side])
  // A side peek leaves the view beside it working, in what's left of the window.
  useLayoutEffect(() => {
    if (!side) return
    const root = document.documentElement
    root.classList.add('has-side-peek')
    return () => root.classList.remove('has-side-peek')
  }, [side])
  useEffect(() => {
    const layerOpen = () => Boolean(document.querySelector(innerLayer) || panel.current?.querySelector(innerPick))
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      if (layerOpen()) return
      // Behind a side peek, Esc leaves the field it's in first (§3).
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest('input, textarea, select, [contenteditable=true]') && !panel.current?.contains(target)) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) { selection.collapseToEnd(); return }
      close()
    }
    // The editor takes Esc to let go of the caret, and says it handled it. A caret with nothing else open isn't a layer (§3), so the peek hears it first.
    const escInEditor = (e: KeyboardEvent) => {
      const editor = e.target instanceof Element ? e.target.closest('.ProseMirror') : null
      if (e.key !== 'Escape' || !editor || !panel.current?.contains(editor) || layerOpen()) return
      if (e.isComposing || e.keyCode === 229) return
      e.preventDefault(); e.stopPropagation()
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) selection.collapseToEnd(); else close()
    }
    document.addEventListener('keydown', esc)
    document.addEventListener('keydown', escInEditor, true)
    return () => { document.removeEventListener('keydown', esc); document.removeEventListener('keydown', escInEditor, true) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Center: a tap outside closes it, and the view behind doesn't respond. Side: the view works, and only ×, Esc and Back close it (§3).
  // One tree for both, so a window resized across the floor keeps the editor and what's in it.
  return <div className={`peek-scrim${side ? ' is-side' : ''}`} onPointerDown={e => { if (!side && e.target === e.currentTarget) close() }}>
    {side && <style>{`.app-main .database-row[data-row="${CSS.escape(rowId)}"] > td, .app-main .database-list-row[data-row="${CSS.escape(rowId)}"], .app-main .database-card[data-row="${CSS.escape(rowId)}"] { background-color: color-mix(in srgb, var(--ink) 7%, var(--bg-doc)); }`}</style>}
    <div className={`peek${side ? ' is-side' : ''}`} ref={el => { panel.current = el; setScrollEl(el) }} role="dialog" aria-modal={!side} aria-label={displayPageTitle(row)} data-page-scope>
      <header className="peek-head">
        {order.length > 1 && at >= 0 && <>
          <button type="button" className="peek-row" aria-label="Previous row" disabled={at === 0} onClick={() => go(order[at - 1])}><ArrowLeftIcon /></button>
          <button type="button" className="peek-row" aria-label="Next row" disabled={at === order.length - 1} onClick={() => go(order[at + 1])}><ArrowRightIcon /></button>
        </>}
        {/* Tapping a level leaves the peek for a full page: the editor's leaving save takes what's typed, and Back mustn't count as closing it. */}
        <div className="crumbs peek-path" onClickCapture={e => { if ((e.target as Element).closest('a')) noteOpenedHere(false) }}><PagePath page={row} workspace={workspace!} /></div>
        <PageMenu page={row} inPeek={id => { if (id) go(id); else close() }} />
        <button type="button" aria-label="Open as a full page" onClick={() => { noteOpenedHere(false); void navigate({ to: '/pages', search: { page: rowId } }) }}><ExternalIcon /></button>
        <button type="button" aria-label="Close" onClick={close}><CloseIcon /></button>
      </header>
      <div className="peek-body">
        {/* A new row is a new editor: what's typed in the last one goes with its leaving save. */}
        <EditorScrollerContext.Provider key={rowId} value={scroller}><PageContent page={row} workspace={workspace!} /></EditorScrollerContext.Provider>
      </div>
    </div>
  </div>
}
