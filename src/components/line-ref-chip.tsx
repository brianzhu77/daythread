import { toast } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import type { LineTarget } from '../domain/page-refs'
import { lineRefView } from './line-text'
import { jumpInPage } from './line-jump'
import { pageHref } from './page-tree'
import { useWorkspace } from './use-day'

/**
 * A11 (Jazz line-links-states §3-§5): a link to one line. It shows the line's current words and where it is now, from
 * the same resolver as the URL and Linked from. Tap: jump in place when that page is open, else open it at the line;
 * a line that's gone opens its page at the top with "Couldn't find that line"; a page that's gone does nothing.
 * `label` replaces the words and place with one text (an Events row's link back, B27).
 */
export function LineRefChip({ target, label }: { target: LineTarget; label?: string }) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const view = lineRefView(workspace, target), r = view.resolved
  const open = () => {
    const page = r && workspace?.pages.find(p => p.id === r.pageId)
    if (!r || !page) return
    if (r.state === 'line-not-found' || !r.blockId) {
      toast("Couldn't find that line", { timeout: 4000 })
      if (new URLSearchParams(window.location.search).get('page') === page.id || window.location.pathname === `/day/${page.date}`) window.scrollTo({ top: 0 })
      else void navigate({ href: pageHref(page) })
      return
    }
    // Nothing stays focused after a jump, so a phone keyboard goes down (Jazz §4).
    if (!page.trashedAt && jumpInPage(page.id, r.blockId)) { (document.activeElement as HTMLElement | null)?.blur(); return }
    void navigate({ href: pageHref(page, r.blockId), resetScroll: false })
  }
  const live = view.state !== 'page-not-found'
  return <span className={`page-ref line-ref is-${view.state}`} contentEditable={false} title={view.full} role={live ? 'link' : undefined} tabIndex={live ? -1 : undefined}
    onMouseDown={e => e.preventDefault()} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open() } }}>
    <span className="page-ref-icon">{view.icon}</span>
    {label ? <span className="line-ref-where">{label}</span> : <>
      <span className="line-ref-words">{view.words}</span>
      {view.where && <span className="line-ref-where">{`\u00a0· ${view.where}`}</span>}
    </>}
  </span>
}
