import { createFileRoute, notFound } from '@tanstack/react-router'
import { DayScreen } from '../components/day-screen'
import { useScreenToday } from '../components/use-screen-today'

export const Route = createFileRoute('/day/$date')({
  beforeLoad: ({ params }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) throw notFound()
  },
  component: Day,
})

function Day() {
  const { date } = Route.useParams()
  const today = useScreenToday()
  return <DayScreen key={date} date={date} today={today} />
}
