// A row over its view (docs/design/peek.md §3). The same head and body as its full page, with its own scroller and scope, so its editor
// neither scrolls the window nor reaches into the page behind. Closing is leaving a page: the editor sends its leaving save.
import { Navigate, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { elementScroller, EditorScrollerContext, windowScroller } from './editor-scope'
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, ExternalIcon } from './icons'
import { displayPageTitle } from './page-title'
import { noteOpenedHere, peekFloor, peekOpenedHere, peekOrder } from './peek-state'
import { PageContent } from './pages-screen'
import { useWide } from './property-editors'
import { useWorkspace } from './use-day'

/** Anything that takes Esc before the peek does: one Esc per layer, innermost first (§3). */
const innerLayer = '#bn-suggestion-menu, .database-menu, .app-menu, [data-slot="popover-content"], .bn-formatting-toolbar, .is-picked, .editor-selection-bar, .paste-link-menu'

export function PeekHost() {
  const { workspace } = useWorkspace()
  const search = useRouterState({ select: s => s.location.search as { peek?: string; page?: string } })
  const wide = useWide()
  const rowId = search.peek
  if (!rowId || !workspace) return null
  const row = workspace.pages.find(p => p.id === rowId && !p.trashedAt)
  if (!row) return <PeekGone />
  // Below the floor, a link with ?peek opens as a full page.
  if (!wide || window.innerWidth < peekFloor) return <Navigate to="/pages" search={{ page: rowId }} replace />
  // The page behind already is this row: two editors on one page would collide (§4).
  if (search.page === rowId) return <PeekGone />
  return <Peek key="peek" rowId={rowId} />
}

function useClosePeek() {
  const navigate = useNavigate(), router = useRouter()
  return () => {
    if (peekOpenedHere()) { noteOpenedHere(false); router.history.back(); return }
    void navigate({ to: '.', search: (({ peek: _peek, ...rest }: Record<string, unknown>) => rest) as never, replace: true })
  }
}
function PeekGone() {
  const navigate = useNavigate()
  useEffect(() => { noteOpenedHere(false); void navigate({ to: '.', search: (({ peek: _peek, ...rest }: Record<string, unknown>) => rest) as never, replace: true }) }, [navigate])
  return null
}

function Peek({ rowId }: { rowId: string }) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const close = useClosePeek()
  const panel = useRef<HTMLDivElement>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const scroller = useMemo(() => (scrollEl ? elementScroller(scrollEl) : windowScroller), [scrollEl])
  const row = workspace!.pages.find(p => p.id === rowId)!
  const order = peekOrder(), at = order.indexOf(rowId)
  // Moving replaces the entry, so Back closes the peek instead of walking through every row.
  const go = (id: string | undefined) => { if (id) void navigate({ to: '.', search: ((prev: Record<string, unknown>) => ({ ...prev, peek: id })) as never, replace: true }) }

  // The page behind keeps its scroll, and doesn't move while this is up.
  useEffect(() => {
    const root = document.documentElement, before = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = before }
  }, [])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      if (document.querySelector(innerLayer)) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) { selection.collapseToEnd(); return }
      close()
    }
    // The editor takes Esc to let go of the caret, and says it handled it. A caret with nothing else open isn't a layer (§3), so the peek hears it first.
    const escInEditor = (e: KeyboardEvent) => {
      const editor = e.target instanceof Element ? e.target.closest('.ProseMirror') : null
      if (e.key !== 'Escape' || !editor || !panel.current?.contains(editor) || document.querySelector(innerLayer)) return
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
  // A tap outside closes it; the view behind doesn't respond (§3).
  return <div className="peek-scrim" onPointerDown={e => { if (e.target === e.currentTarget) close() }}>
    <div className="peek" ref={el => { panel.current = el; setScrollEl(el) }} role="dialog" aria-modal="true" aria-label={displayPageTitle(row)} data-page-scope>
      <header className="peek-head">
        {order.length > 1 && at >= 0 && <>
          <button type="button" className="peek-row" aria-label="Previous row" disabled={at === 0} onClick={() => go(order[at - 1])}><ArrowLeftIcon /></button>
          <button type="button" className="peek-row" aria-label="Next row" disabled={at === order.length - 1} onClick={() => go(order[at + 1])}><ArrowRightIcon /></button>
        </>}
        <span className="peek-gap" />
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
