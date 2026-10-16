import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { TasksScreen, taskViews, type TaskView } from '../components/tasks-screen'
import { todayIso } from '../components/dates'

export const Route = createFileRoute('/tasks')({
  // Unknown views fall back to Today; switching views only changes the URL.
  validateSearch: (search: Record<string, unknown>): { view: TaskView } => ({
    view: taskViews.includes(search.view as TaskView) ? (search.view as TaskView) : 'today',
  }),
  component: Tasks,
})

function Tasks() {
  const { view } = Route.useSearch()
  const [today] = useState(todayIso)
  return <TasksScreen view={view} today={today} />
}
