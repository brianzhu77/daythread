import { Link } from '@tanstack/react-router'
import type { LocalDate, Task } from '../domain/types'
import { getUpcomingByDate, type UpcomingKind, type UpcomingTaskDate } from '../domain/upcoming'
import { DateTag } from './date-tag'
import { addDays, daysBetween, longLabel } from './dates'
import { RowMenu } from './row-menu'
import { anotherDayItems, useTaskActions } from './task-row'
import { useDay, useWorkspace } from './use-day'
import { plannedOn } from '../domain/workspace'
import { TagText } from './tag-text'
import { ParentLine, treeIndent, useTaskTree } from './task-tree'

export const taskViews = ['today', 'upcoming', 'open', 'paused'] as const
export type TaskView = (typeof taskViews)[number]

const viewLabels: Record<TaskView, string> = { today: 'Today', upcoming: 'Upcoming', open: 'Open', paused: 'Not today' }

const kindLabels: Record<UpcomingKind, string> = { do: 'Do', start: 'Start', due: 'Due' }

/** 01 §76 order: Do, then Start · Due, except Due leads once the deadline is within 2 days. */
function upcomingLabel(task: Readonly<Task>, kinds: readonly UpcomingKind[], today: LocalDate): string {
  const dueFirst = task.deadlineOn !== null && daysBetween(today, task.deadlineOn) <= 2
  const order: UpcomingKind[] = dueFirst ? ['do', 'due', 'start'] : ['do', 'start', 'due']
  return order.filter(k => kinds.includes(k)).map(k => kindLabels[k]).join(' · ')
}

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
      {view === 'upcoming' && <UpcomingList today={today} />}
    </div>
  )
}

/** Upcoming per 01 §76: every date fact after today, one row per task per date, labelled by what falls due. */
function UpcomingList({ today }: { today: LocalDate }) {
  const { workspace } = useWorkspace()
  if (!workspace) return null
  const days = getUpcomingByDate(workspace, addDays(today, 1))
  if (!days.length) return <Empty text="Nothing planned, starting or due after today." />
  return days.map(d => <UpcomingDay key={d.date} date={d.date} tasks={d.tasks} today={today} />)
}

const upcomingId = (x: UpcomingTaskDate) => x.task.id

function UpcomingDay({ date, tasks, today }: { date: LocalDate; tasks: readonly UpcomingTaskDate[]; today: LocalDate }) {
  const rows = useTaskTree(tasks, upcomingId)
  return (
    <section className="list-section">
      <h2 className="list-header">{longLabel(date)}</h2>
      <ul className="plain task-list">
        {rows.map(({ item: { task, kinds }, depth, outsideParent }) => (
          <li key={task.id} {...treeIndent(depth)}>
            <ListTaskRow task={task} today={today} paused={task.paused} label={upcomingLabel(task, kinds, today)} parentId={outsideParent} />
          </li>
        ))}
      </ul>
    </section>
  )
}

const taskId = (t: Task) => t.id

function TaskList({ tasks, today, paused = false, empty }: { tasks: Task[]; today: LocalDate; paused?: boolean; empty?: string }) {
  const rows = useTaskTree(tasks, taskId)
  if (!tasks.length) return empty ? <Empty text={empty} /> : null
  return (
    <ul className="plain task-list">
      {rows.map(({ item: t, depth, outsideParent }) => (
        <li key={t.id} {...treeIndent(depth)}>
          <ListTaskRow task={t} today={today} paused={paused} parentId={outsideParent} />
        </li>
      ))}
    </ul>
  )
}

function ListTaskRow({ task, today, paused, label, parentId = null }: { task: Task; today: LocalDate; paused: boolean; label?: string; parentId?: string | null }) {
  const { markDone, planOn, notToday } = useTaskActions(today)
  const { workspace } = useWorkspace()
  const plannedToday = Boolean(workspace) && plannedOn(workspace!, task.id) === today
  return (
    <div className={`task-row list ${paused ? 'is-paused' : ''}`} data-task-id={task.id}>
      <input type="checkbox" className="check" checked={task.status === 'done'} aria-label={`Mark ${task.title} done`} onChange={() => markDone(task)} />
      <span className="task-title"><ParentLine parentId={parentId} /><TagText text={task.title} /></span>
      <DateTag task={task} today={today} label={label} />
      {/* Upcoming keeps set-aside rows' dates (02 Not today) but they must not read as commitments; the Not today tab needs no marker. */}
      {paused && label !== undefined && <span className="app-tag paused">Not today</span>}
      <RowMenu
        label={`Actions for ${task.title}`}
        groups={[
          {
            items: [
              ...(plannedToday ? [] : [{ label: paused ? 'Bring back to today' : 'Plan today', onSelect: () => planOn(task, today) }]),
              ...(plannedToday ? [{ label: 'Not today', onSelect: () => notToday(task, today) }] : []),
            ],
          },
          { title: 'Another day', items: anotherDayItems(task, today, (t, d) => planOn(t, d)) },
        ]}
      />
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="empty-box">{text}</p>
}
