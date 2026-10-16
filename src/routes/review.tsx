import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ReviewFlow } from '../components/review-flow'
import { addDays, todayIso } from '../components/dates'

interface ReviewSearch {
  date?: string
  from?: 'reminder'
}

export const Route = createFileRoute('/review')({
  validateSearch: (search: Record<string, unknown>): ReviewSearch => ({
    date: typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : undefined,
    from: search.from === 'reminder' ? 'reminder' : undefined,
  }),
  component: Review,
})

// Before this hour, the reminder link offers the previous day's review (01 §7.0, §10).
const NIGHT_OWL_HOUR = 4

function Review() {
  const { date, from } = Route.useSearch()
  const [today] = useState(todayIso)
  const [afterMidnight] = useState(() => new Date().getHours() < NIGHT_OWL_HOUR)
  const target = date ?? (afterMidnight ? addDays(today, -1) : today)
  return <ReviewFlow key={target} date={target} today={today} fromReminder={from === 'reminder'} />
}
