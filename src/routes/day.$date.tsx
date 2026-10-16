import { createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { DayScreen } from '../components/day-screen'
import { todayIso } from '../components/dates'

export const Route = createFileRoute('/day/$date')({
  beforeLoad: ({ params }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) throw notFound()
  },
  component: Day,
})

function Day() {
  const { date } = Route.useParams()
  const [today] = useState(todayIso)
  return <DayScreen key={date} date={date} today={today} />
}
