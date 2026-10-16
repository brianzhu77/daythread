import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { DayScreen } from '../components/day-screen'
import { todayIso } from '../components/dates'

export const Route = createFileRoute('/')({
  component: Today,
})

function Today() {
  const [today] = useState(todayIso)
  return <DayScreen date={today} today={today} />
}
