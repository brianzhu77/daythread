import { createFileRoute } from '@tanstack/react-router'
import { CalendarScreen } from '../components/calendar-screen'
import { useScreenToday } from '../components/use-screen-today'

export const Route = createFileRoute('/calendar')({
  validateSearch: (search: Record<string, unknown>): { date?: string } => ({
    date: typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : undefined,
  }),
  component: Calendar,
})

function Calendar() {
  const { date } = Route.useSearch()
  const today = useScreenToday()
  return <CalendarScreen from={date ?? today} today={today} />
}
