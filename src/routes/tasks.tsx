import { createFileRoute } from '@tanstack/react-router'
import { TasksScreen, taskViews, type TaskView } from '../components/tasks-screen'
import { useScreenToday } from '../components/use-screen-today'

export const Route = createFileRoute('/tasks')({
  // Unknown views fall back to Today; switching views only changes the URL.
  validateSearch: (search: Record<string, unknown>): { view: TaskView } => ({
    view: taskViews.includes(search.view as TaskView) ? (search.view as TaskView) : 'today',
  }),
  component: Tasks,
})

function Tasks() {
  const { view } = Route.useSearch()
  const today = useScreenToday()
  return <TasksScreen view={view} today={today} />
}
