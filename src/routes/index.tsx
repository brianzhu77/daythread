import { createFileRoute } from '@tanstack/react-router'
import { DayScreen } from '../components/day-screen'
import { useScreenToday } from '../components/use-screen-today'

export const Route = createFileRoute('/')({
  component: Today,
})

function Today() {
  const today = useScreenToday()
  // Keyed by the day, so coming back on a new day opens that day's screen afresh.
  return <DayScreen key={today} date={today} today={today} />
}
