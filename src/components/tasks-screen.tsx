import { Link } from '@tanstack/react-router'
import type { LocalDate, Task } from '../domain/types'
import { getDayView } from '../domain/workspace'
import { DateTag } from './date-tag'
import { addDays, longLabel } from './dates'
import { RowMenu } from './row-menu'
import { anotherDayItems, useTaskActions } from './task-row'
import { useDay, useWorkspace } from './use-day'

export const taskViews = ['today', 'upcoming', 'open', 'paused'] as const
export type TaskView = (typeof taskViews)[number]

const viewLabels: Record<TaskView, string> = { today: 'Today', upcoming: 'Upcoming', open: 'Open', paused: 'Not today' }

// How far Upcoming looks ahead until the domain offers a dated query of its own.
const UPCOMING_DAYS = 14

/**
 * Tasks tab (craft-v1 §5.2, feature map C2). Lists only; every list is read from the
 * domain's day view, so the hand-off, Placement and Not today rules stay where they are.
 */
export function TasksScreen({ view, today }: { view: TaskView; today: LocalDate }) {
  const { workspace } = useWorkspace()
  const { view: day } = useDay(today)
  if (!workspace || !day) return <p className="loading">Loading tasks…</p>

  return (
    <div className="list-screen">
      <h1 className="large-title">Tasks</h1>
      <nav className="pills" aria-label="Task lists">
        {taskViews.map(v => (
          <Link key={v} to="/tasks" search={{ view: v }} className="pill" aria-current={v === view ? 'page' : undefined}>
            {viewLabels[v]}
          </Link>
        ))}
      </nav>

      {view === 'today' && <TaskList tasks={day.planned} today={today} empty="Nothing planned for today." />}
      {/* Open per 02 §94: open, not paused, not planned after today (later days belong to Upcoming). */}
      {view === 'open' && <TaskList tasks={day.openPool} today={today} empty="No open tasks." />}
      {view === 'paused' && <TaskList tasks={day.paused} today={today} paused empty="Nothing set aside." />}
      {view === 'upcoming' &&
        (() => {
          const days = Array.from({ length: UPCOMING_DAYS }, (_, i) => addDays(today, i + 1))
            .map(d => ({ date: d, tasks: getDayView(workspace, d).planned }))
            .filter(d => d.tasks.length)
          if (!days.length) return <Empty text="Nothing planned for the next two weeks." />
          return days.map(d => (
            <section key={d.date} className="list-section">
              <h2 className="list-header">{longLabel(d.date)}</h2>
              <TaskList tasks={d.tasks} today={today} />
            </section>
          ))
        })()}
    </div>
  )
}

function TaskList({ tasks, today, paused = false, empty }: { tasks: Task[]; today: LocalDate; paused?: boolean; empty?: string }) {
  if (!tasks.length) return empty ? <Empty text={empty} /> : null
  return (
    <ul className="plain task-list">
      {tasks.map(t => (
        <li key={t.id}>
          <ListTaskRow task={t} today={today} paused={paused} />
        </li>
      ))}
    </ul>
  )
}

function ListTaskRow({ task, today, paused }: { task: Task; today: LocalDate; paused: boolean }) {
  const { markDone, planOn, notToday } = useTaskActions(today)
  const plannedToday = task.plannedOn === today
  return (
    <div className="task-row list" data-task-id={task.id}>
      <input type="checkbox" className="check" checked={task.status === 'done'} aria-label={`Mark ${task.title} done`} onChange={() => markDone(task)} />
      <span className="task-title">{task.title}</span>
      <DateTag task={task} today={today} />
      <RowMenu
        label={`Actions for ${task.title}`}
        groups={[
          {
            items: [
              ...(plannedToday ? [] : [{ label: paused ? 'Bring back to today' : 'Plan today', onSelect: () => planOn(task, today, 'other') }]),
              ...(plannedToday ? [{ label: 'Not today', onSelect: () => notToday(task, today) }] : []),
            ],
          },
          { title: 'Another day', items: anotherDayItems(task, today, planOn) },
        ]}
      />
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="empty-box">{text}</p>
}
