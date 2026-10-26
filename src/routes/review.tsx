import { createFileRoute, redirect } from '@tanstack/react-router'

interface ReviewSearch {
  date?: string
  from?: 'reminder'
}

// The review lives on today's page now (docs/design/review-on-the-page.md): the old address, still in reminder links
// and bookmarks, opens Today, where the Tomorrow block is.
export const Route = createFileRoute('/review')({
  validateSearch: (search: Record<string, unknown>): ReviewSearch => ({
    date: typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : undefined,
    from: search.from === 'reminder' ? 'reminder' : undefined,
  }),
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})
