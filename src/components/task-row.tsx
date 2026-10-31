import { useState } from 'react'
import type { LocalDate, Task } from '../domain/types'
import { anotherDayOptions, shortLabel, weekday } from './dates'
import { DateTag } from './date-tag'
import { RowMenu, type MenuItem } from './row-menu'
import { useTaskTick, useWorkspace } from './use-day'
import { TagText } from './tag-text'

/** The task actions shared by plan rows, the strip, Start the day and review step 1 (01 §2). */
export function useTaskActions(today: LocalDate) {
  const { run, toggleTask } = useWorkspace()

  // B72: through the shared tick, so a second tap while it saves is ignored. Show the box with `useTaskTick`.
  const markDone = (task: Task) =>
    toggleTask(task.id, (to, r) => ({ text: to === 'done' ? 'Done' : 'Reopened', undoOperationId: r.operationId }))

  /** `from`: the day page the move is made from; its row leaves it unless that day is past. */
  const planOn = (task: Task, date: LocalDate, from?: LocalDate) =>
    run({ type: 'plan-task', taskId: task.id, date, today, ...(from ? { from } : {}) }, r => ({
      text: date === today ? 'On today' : `Moved to ${shortLabel(date)}`,
      undoOperationId: r.operationId,
    }))

  const notToday = (task: Task, date: LocalDate) =>
    run({ type: 'not-today', taskId: task.id, date }, r => ({
      text: notTodayText(task, date, today),
      undoOperationId: r.operationId,
    }))

  const cancel = (task: Task) =>
    run({ type: 'task-status', taskId: task.id, status: 'cancelled' }, r => ({ text: 'Cancelled', undoOperationId: r.operationId }))

  return { markDone, planOn, notToday, cancel }
}

export function notTodayText(task: Task, date: LocalDate, today: LocalDate): string {
  const head = date === today ? 'Not today — won’t carry over' : `Not on ${shortLabel(date)}`
  return task.deadlineOn ? `${head} · due ${weekday(task.deadlineOn)} still tracked` : head
}

export function anotherDayItems(task: Task, today: LocalDate, planOn: (t: Task, d: LocalDate) => unknown): MenuItem[] {
  return [
    ...anotherDayOptions(today).map(o => ({ label: `${o.label} · ${shortLabel(o.date)}`, onSelect: () => planOn(task, o.date) })),
    {
      label: 'Pick date…',
      onSelect: () => {
        // Native date input keeps this tappable on iPhone without a custom calendar.
        const input = document.createElement('input')
        input.type = 'date'
        input.min = today
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.append(input)
        input.addEventListener('change', () => {
          if (input.value) planOn(task, input.value)
          input.remove()
        })
        input.addEventListener('blur', () => setTimeout(() => input.remove(), 500))
        input.showPicker?.()
        input.focus()
      },
    },
  ]
}

interface TaskRowProps {
  task: Task
  pageDate: LocalDate
  today: LocalDate
  /** Plan rows carry the day's plan; past pages are read-only for it. */
  variant: 'plan' | 'ref' | 'past'
  onEditTitle?: (title: string) => void
  onDeleteRow?: () => void
}

export function TaskRow({ task, pageDate, today, variant, onEditTitle, onDeleteRow }: TaskRowProps) {
  const { markDone, planOn, notToday, cancel } = useTaskActions(today)
  const [title, setTitle] = useState(task.title)
  const done = useTaskTick(task.id).status === 'done'
  const cancelled = task.status === 'cancelled'

  const groups =
    variant === 'past'
      ? [{ items: [{ label: 'Bring to today', onSelect: () => planOn(task, today) }] }]
      : [
          { title: 'Another day', items: anotherDayItems(task, today, (t, d) => planOn(t, d, pageDate)) },
          {
            items: [
              { label: pageDate === today ? 'Not today' : `Not on ${shortLabel(pageDate)}`, onSelect: () => notToday(task, pageDate) },
              { label: 'Cancel task', onSelect: () => cancel(task), danger: true },
            ],
          },
        ]

  return (
    <div className={`task-row ${variant} ${done ? 'is-done' : ''} ${cancelled ? 'is-cancelled' : ''}`} data-task-id={task.id}>
      <input
        type="checkbox"
        className="check"
        checked={done}
        disabled={cancelled}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`}
        onChange={() => markDone(task)}
      />
      {onEditTitle && variant !== 'past' && !cancelled ? (
        // A one-row textarea so long titles wrap instead of being cut off; Enter still commits.
        <textarea
          className="task-title"
          rows={1}
          value={title}
          aria-label="Task title"
          onChange={e => setTitle(e.target.value.replace(/\n/g, ' '))}
          onBlur={() => title.trim() && title !== task.title && onEditTitle(title.trim())}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            // Deleting a whole plan row (empty title + Backspace) is Not today with Undo (01 §2, C3).
            if (e.key === 'Backspace' && title === '' && onDeleteRow && variant === 'plan') {
              e.preventDefault()
              onDeleteRow()
            }
          }}
        />
      ) : (
        <span className="task-title"><TagText text={task.title} /></span>
      )}
      <DateTag task={task} today={today} pageDate={pageDate} label={cancelled ? 'Cancelled' : undefined} />
      {variant === 'past' && <span className="app-tag quiet">Shown at current status</span>}
      {!cancelled && <RowMenu label={`Actions for ${task.title}`} groups={groups} />}
    </div>
  )
}
