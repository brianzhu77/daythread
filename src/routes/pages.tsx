import { createFileRoute } from '@tanstack/react-router'
import { PagesScreen } from '../components/pages-screen'

export interface PagesSearch { peek?: string; side?: 1; page?: string; focus?: 'title'; block?: string; from?: 'tags' | 'search' | 'bookmarks'; view?: 'trash' | 'templates' | 'bookmarks' }

export const Route = createFileRoute('/pages')({
  // The open page lives in the URL so the browser's Back returns to where it was opened from (a `/page` card).
  validateSearch: (search: Record<string, unknown>): PagesSearch => ({
    ...(typeof search.page === 'string' && search.page ? { page: search.page } : {}),
    // A row opened over this page, not instead of it (R4-11).
    ...(typeof search.peek === 'string' && search.peek ? { peek: search.peek } : {}),
    ...(search.side === 1 || search.side === '1' ? { side: 1 as const } : {}),
    ...(search.focus === 'title' ? { focus: 'title' as const } : {}),
    // Tags → a block on an undated page; the editor reads it once and removes it from the URL.
    ...(typeof search.block === 'string' && search.block ? { block: search.block } : {}),
    // A11: opened from the Tags list (or a search result), so the line is looked for on this page first (Bumblebee 54096b19).
    ...(search.from === 'tags' || search.from === 'search' || search.from === 'bookmarks' ? { from: search.from } : {}),
    // A4: the Trash screen (pages-trash-layout §3).
    ...(search.view === 'trash' ? { view: 'trash' as const } : {}),
    // B70: the Templates list (templates-states §1).
    ...(search.view === 'templates' ? { view: 'templates' as const } : {}),
    // B83: the list of every bookmark page.
    ...(search.view === 'bookmarks' ? { view: 'bookmarks' as const } : {}),
  }),
  component: PagesScreen,
})
