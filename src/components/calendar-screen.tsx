import { buttonVariants } from '@heroui/react'
import { Link } from '@tanstack/react-router'
import type { LocalDate, Page, Task } from '../domain/types'
import { getCalendarTasks } from '../domain/workspace'
import { DateTag } from './date-tag'
import { ArrowLeftIcon, ArrowRightIcon } from './icons'
import { FutureDayPrompt } from './future-day'
import { addDays, fromIso, weekday } from './dates'
import { useWorkspace } from './use-day'

// Days shown per screen; "Later" extends the list through the URL.
const DAYS_SHOWN = 10
const secondary = buttonVariants({ variant: 'secondary' })

/**
 * Calendar tab (craft-v1 §5.4, feature map C2): one header per day, that day's page as a card,
 * then its planned tasks. Browsing never creates a page; opening a day goes through /day/$date.
 * A future day without a page is greyed and asks before creating it (date navigation rules R4).
 */
export function CalendarScreen({ from, today }: { from: LocalDate; today: LocalDate }) {
  const { workspace } = useWorkspace()
  if (!workspace) return <p className="loading">Loading calendar…</p>
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(from, i))

  return (
    <div className="list-screen">
      <h1 className="large-title">Calendar</h1>
      {/* Earlier and Later never move; Today sits last, away from the aligned edge, and is hidden (keeping its space) when already there. */}
      <nav className="calendar-nav" aria-label="Move through days">
        <Link to="/calendar" search={{ date: addDays(from, -DAYS_SHOWN) }} className={secondary} data-slot="button">
          <ArrowLeftIcon />
          Earlier
        </Link>
        <Link to="/calendar" search={{ date: addDays(from, DAYS_SHOWN) }} className={secondary} data-slot="button">
          Later
          <ArrowRightIcon />
        </Link>
        <Link to="/calendar" search={{}} className={`${secondary} ${from === today ? 'invisible' : ''}`} data-slot="button">
          Today
        </Link>
      </nav>
      {days.map(d => {
        const page = workspace.pages.find(p => p.type === 'daily' && p.date === d) ?? null
        // Past days need the placements as they were that day (feature map K3); that query isn't in the domain yet.
        const tasks = d >= today ? getCalendarTasks(workspace, d) : null
        return <CalendarDay key={d} date={d} today={today} page={page} tasks={tasks} />
      })}
    </div>
  )
}

function CalendarDay({ date, today, page, tasks }: { date: LocalDate; today: LocalDate; page: Page | null; tasks: Task[] | null }) {
  const relative = date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : date === addDays(today, -1) ? 'Yesterday' : null
  const monthDay = fromIso(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const fullWeekday = fromIso(date).toLocaleDateString('en-US', { weekday: 'long' })
  const unopened = date > today && !page
  const title = (
    <>
      {monthDay}
      {relative && <span className={`relative ${date === today ? 'is-today' : ''}`}> · {relative}</span>}
      <span className="weekday"> · {fullWeekday}</span>
    </>
  )
  return (
    <section className={`calendar-day ${unopened ? 'is-future' : ''}`} aria-label={`${monthDay}, ${fullWeekday}`}>
      <h2 className="day-header">
        {unopened ? (
          <FutureDayPrompt date={date}>{title}</FutureDayPrompt>
        ) : (
          <Link to="/day/$date" params={{ date }}>
            {title}
          </Link>
        )}
      </h2>
      {/* A page with nothing written gets no card: the date links to it and its tasks are listed below. */}
      {page && preview(page) && (
        <Link to="/day/$date" params={{ date }} className="note-card">
          <strong>{relative ?? weekday(date)}</strong>
          <span className="note-preview">{preview(page)}</span>
        </Link>
      )}
      {tasks === null ? (
        // Without the history query an empty past day would read as "nothing was planned".
        <p className="quiet day-empty">{page ? 'Task history not shown yet.' : 'No page for this day · task history not shown yet.'}</p>
      ) : tasks.length ? (
        <ul className="plain task-list">
          {tasks.map(t => (
            <li key={t.id} className="calendar-task">
              <span className="check-mark" aria-hidden="true" />
              <span className="task-title">{t.title}</span>
              <DateTag task={t} today={today} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** First written lines of the page, for the card (task rows are listed below it). */
function preview(page: Page): string {
  return page.sections
    .flatMap(s => s.blocks)
    .filter(b => b.kind !== 'task' && b.text.trim())
    .slice(0, 2)
    .map(b => b.text.trim())
    .join(' · ')
}
