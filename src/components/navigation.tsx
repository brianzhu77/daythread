import { Link, useRouterState } from '@tanstack/react-router'
import { rememberOpened, SidebarTree, useToday } from './page-tree'
import { useEffect } from 'react'
import { CalendarIcon, PagesIcon, TagsIcon, TasksIcon, TodayIcon } from './icons'
import { Mark } from './mark'
import type { LocalDate } from '../domain/types'
import { useWorkspace } from './use-day'
import { SidebarTrashRow } from './trash'
import { AccountRow } from './account-row'
import { useKeptDrafts } from './kept-drafts'
import { useKeyboardTop } from './keyboard'
import { openSearch, SidebarSearchRow } from './search-dialog'
import { SearchIcon } from './icons'

// Highlight only where you are: Today is today's page, not any day (another day highlights its Days row, or nothing).
const destinations = [
  { to: '/', label: 'Today', Icon: TodayIcon, match: (path: string, today: LocalDate) => path === '/' || path === `/day/${today}` },
  { to: '/tasks', label: 'Tasks', Icon: TasksIcon, match: (path: string) => path.startsWith('/tasks') },
  { to: '/calendar', label: 'Calendar', Icon: CalendarIcon, match: (path: string) => path.startsWith('/calendar') },
  { to: '/pages', label: 'Pages', Icon: PagesIcon, match: (path: string) => path.startsWith('/pages') },
  // Tags is its own module beside Pages on laptop and phone (Brian 77423ea0, bc661669).
  { to: '/tags', label: 'Tags', Icon: TagsIcon, match: (path: string) => path.startsWith('/tags') },
] as const

/** Sidebar on laptop, floating tab capsule + capture button on phone (craft-v1 §3). CSS picks one. */
export function Navigation() {
  const path = useRouterState({ select: s => s.location.pathname })
  const keyboardUp = useKeyboardTop() !== null
  const openPageId = useRouterState({ select: s => (s.location.search as { page?: string }).page })
  const trashView = useRouterState({ select: s => (s.location.search as { view?: string }).view === 'trash' })
  const today = useToday()
  // B40: the tab where he'd find a page whose text isn't saved yet carries a dot (Today, Calendar for an earlier day, Pages).
  const unsavedTabs = new Set(useKeptDrafts().pages.map(p => p.tab))

  return (
    <>
      <aside className="sidebar" aria-label="Navigation">
        <Link to="/" className="brand">
          <Mark size={18} />
          Daythread
        </Link>
        <nav className="sidebar-nav" aria-label="Main">
          {/* Search heads the sidebar (craft-v1 §3.2; docs/design/search-states.md): one row, the shortcut as a hint. */}
          <SidebarSearchRow />
          {destinations.map(({ to, label, Icon, match }) => (
            // An open page is highlighted in the tree, so the sidebar's Pages row is only current on the list itself;
            // the Link's own active state has to compare the search too, or it marks the row current anyway.
            <Link key={to} to={to} className="side-row" activeOptions={to === '/pages' ? { exact: true, includeSearch: true } : undefined}
              aria-current={match(path, today) && !(to === '/pages' && (openPageId || trashView)) ? 'page' : undefined}>
              <Icon />
              {label}
            </Link>
          ))}
        </nav>
        <PageGroups path={path} openPageId={openPageId} trashView={trashView} today={today} />
      </aside>

      {/* B54: hidden while a keyboard is up (B48's detection), so it never sits between the keyboard and the toolbar. */}
      <nav className={`tab-bar${keyboardUp ? ' is-keyboard-up' : ''}`} aria-label="Main">
        <div className="tab-capsule">
          {destinations.map(({ to, label, Icon, match }) => (
            <Link key={to} to={to} className={`tab${unsavedTabs.has(to as never) ? ' has-unsaved' : ''}`} aria-label={unsavedTabs.has(to as never) ? `${label} · not saved yet` : label} aria-current={match(path, today) ? 'page' : undefined}>
              <Icon />
            </Link>
          ))}
        </div>
        {/* The round button beside the capsule (where Craft keeps +, craft-v1 §3.1): search from any screen, one tap. */}
        <button type="button" className="tab-search" aria-label="Search" onClick={openSearch}><SearchIcon size={22} /></button>
      </nav>
    </>
  )
}

/** The page on screen: a day page by its date (`/` is today), or the page opened in Pages. */
function PageGroups({ path, openPageId, trashView, today }: { path: string; openPageId?: string; trashView: boolean; today: LocalDate }) {
  const { workspace } = useWorkspace()
  const date = path === '/' ? today : path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/)?.[1]
  const activeId = (date ? workspace?.pages.find(p => p.type === 'daily' && p.date === date)?.id : path.startsWith('/pages') ? openPageId : undefined) ?? null
  useEffect(() => { if (activeId) rememberOpened(activeId) }, [activeId])
  if (!workspace) return null
  // The Trash row is current on the Trash screen and on a trashed page, which has no row in the tree (layout T3/T4).
  const trashOpen = path.startsWith('/pages') && (trashView || Boolean(openPageId && workspace.pages.find(p => p.id === openPageId)?.trashedAt))
  return <SidebarTree workspace={workspace} activeId={activeId} today={today} footer={<><SidebarTrashRow current={trashOpen} /><AccountRow className="account-row-sidebar" /></>} />
}

