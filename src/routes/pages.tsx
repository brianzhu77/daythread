import { createFileRoute } from '@tanstack/react-router'
import { PagesScreen } from '../components/pages-screen'

export interface PagesSearch { page?: string; focus?: 'title'; block?: string; from?: 'tags' | 'search'; view?: 'trash' | 'templates' }

export const Route = createFileRoute('/pages')({
  // The open page lives in the URL so the browser's Back returns to where it was opened from (a `/page` card).
  validateSearch: (search: Record<string, unknown>): PagesSearch => ({
    ...(typeof search.page === 'string' && search.page ? { page: search.page } : {}),
    ...(search.focus === 'title' ? { focus: 'title' as const } : {}),
    // Tags → a block on an undated page; the editor reads it once and removes it from the URL.
    ...(typeof search.block === 'string' && search.block ? { block: search.block } : {}),
    // A11: opened from the Tags list (or a search result), so the line is looked for on this page first (Bumblebee 54096b19).
    ...(search.from === 'tags' || search.from === 'search' ? { from: search.from } : {}),
    // A4: the Trash screen (pages-trash-layout §3).
    ...(search.view === 'trash' ? { view: 'trash' as const } : {}),
    // B70: the Templates list (templates-states §1).
    ...(search.view === 'templates' ? { view: 'templates' as const } : {}),
  }),
  component: PagesScreen,
})
