// Bookmarks (docs/design/bookmarks.md): one list of every page with a `url`. Nothing's stored and nothing moves: each stays under its day, with its card.
import { useEffect } from 'react'
import { bookmarkPages, pagePreview, parentOf } from '../domain/page-tree'
import type { Page, Workspace } from '../domain/types'
import { defaultLinkTitle } from '../domain/url-key'
import { BookmarkIcon, ChevronRightIcon, ExternalIcon } from './icons'
import { displayPageTitle } from './page-title'
import { PageLink, pageLabel, useToday } from './page-tree'

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
export const bookmarksHref = '/pages?view=bookmarks'
const opened = (p: Page) => `/pages?page=${encodeURIComponent(p.id)}&from=bookmarks`
/** The row just opened: the crumb back is a new navigation, which starts at the top, and the Home Screen app has no other way back. */
let leftFrom: string | null = null

function BookmarkRow({ page, workspace, today }: { page: Page; workspace: Workspace; today: string }) {
  const words = pagePreview(page, 1)
  const parent = parentOf(workspace, page)
  // The card's rule: a title still at its default already reads as the address.
  const host = page.url && page.title !== defaultLinkTitle(page.url) ? hostOf(page.url) : ''
  const where = [host, parent ? pageLabel(parent, today) : ''].filter(Boolean).join(' · ')
  return <li className="bookmark-row" data-bookmark={page.id} onClickCapture={() => { leftFrom = page.id }}>
    <PageLink className="bookmark-main" href={opened(page)}>
      <span className="bookmark-title">{displayPageTitle(page)}</span>
      {words && <span className="bookmark-words">{words}</span>}
      {where && <span className="bookmark-where">{where}</span>}
    </PageLink>
    <a className="bookmark-open" href={page.url ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open ${displayPageTitle(page)} in a new tab`}><ExternalIcon /></a>
  </li>
}

export function BookmarksScreen({ workspace }: { workspace: Workspace }) {
  const today = useToday()
  const pages = bookmarkPages(workspace)
  useEffect(() => {
    const id = leftFrom
    leftFrom = null
    if (!id) return
    // After the router's own move to the top.
    const frame = requestAnimationFrame(() => document.querySelector(`[data-bookmark="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [])
  return <div className="list-screen">
    <div className="title-row"><h1 className="large-title">Bookmarks</h1></div>
    {pages.length === 0 && <p className="quiet">No bookmarks yet</p>}
    {pages.length > 0 && <ul className="plain bookmark-list">{pages.map(p => <BookmarkRow key={p.id} page={p} workspace={workspace} today={today} />)}</ul>}
  </div>
}

/** On the phone there's no sidebar: at the top of Pages, once there's a bookmark. */
export function PagesBookmarksRow({ workspace }: { workspace: Workspace }) {
  const n = bookmarkPages(workspace).length
  if (!n) return null
  return <PageLink className="pages-trash-row pages-bookmarks-row" href={bookmarksHref}><BookmarkIcon /><span>Bookmarks · {n}</span><ChevronRightIcon /></PageLink>
}
