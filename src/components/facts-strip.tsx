import type { DayView, LocalDate, Task, Workspace } from '../domain/types'
import { dayFacts, type FactRow } from './day-facts'
import { Disclosure, RowMenu } from './row-menu'
import { anotherDayItems, useTaskActions } from './task-row'
import { CalendarIcon } from './icons'
import { jumpToBlock } from './line-jump'

interface Props {
  view: DayView
  workspace: Workspace
  date: LocalDate
  today: LocalDate
}

/** Computed facts above the page, never page text. No counts to clear. */
export function FactsStrip({ view, workspace, date, today }: Props) {
  const facts = dayFacts(view, workspace, date, today)
  if (!facts) return null
  const paused = new Map(view.paused.map(t => [t.id, t]))

  return (
    <div className="facts" aria-label="Facts for this day">
      {facts.events && <TodayEvents text={facts.events.text} more={facts.events.more} headingId={facts.events.headingId} />}

      {facts.dueSoon.length > 0 && (
        <div className="fact-block">
          <p className="fact-label">Due soon</p>
          {facts.dueSoon.map(row => (
            <div key={row.taskId} className="fact-row">
              <span className="grow">{row.words}</span>
              <span className={`app-tag ${row.setAside ? 'quiet' : ''}`}>{row.tag}</span>
            </div>
          ))}
        </div>
      )}

      {/* B76 (Lead e1158869, Bumblebee efb90b83): no "N other open tasks" line. This morning's open to-dos are in the
          day's draft (bands or "N more open"); the rest is the Tasks tab. Shown only when there is something to open. */}
      {facts.notToday && (
        <div className="fact-pair">
          <Disclosure summary={facts.notToday.title}>
            {facts.notToday.rows.map(row => (
              <PoolRow key={row.taskId} task={paused.get(row.taskId)!} row={row} today={today} />
            ))}
          </Disclosure>
        </div>
      )}
    </div>
  )
}

function PoolRow({ task, row, today }: { task: Task; row: FactRow; today: LocalDate }) {
  const { planOn, notToday } = useTaskActions(today)
  const paused = row.setAside
  return (
    <div className="fact-row">
      <span className="grow">{row.words}</span>
      <span className="app-tag">{row.tag}</span>
      <span className="actions">
        <button type="button" className="secondary" onClick={() => planOn(task, today)}>
          {paused ? 'Bring back' : 'Today'}
        </button>
        {!paused && (
          <button type="button" className="ghost" onClick={() => notToday(task, today)}>
            Not today
          </button>
        )}
        <RowMenu label={`More for ${task.title}`} groups={[{ title: 'Another day', items: anotherDayItems(task, today, (t, d) => planOn(t, d)) }]} />
      </span>
    </div>
  )
}

/**
 * Today's events as one fact line, first in the strip, so he sees them above the fold on the phone. The same list as
 * the rows under Events; a tap jumps to those rows.
 */
function TodayEvents({ text, more, headingId }: { text: string; more: string | null; headingId: string | null }) {
  const jump = () => { const at = document.querySelector<HTMLElement>('.event-rows') ?? (headingId ? document.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(headingId)}"]`) : null); if (at) jumpToBlock(at) }
  return (
    <button type="button" className="fact-line link-line today-events" onClick={jump}>
      <span className="page-ref-icon" aria-hidden="true"><CalendarIcon /></span>
      <span className="today-events-text">{text}</span>
      {more && <span className="today-events-more">{more}</span>}
      <span className="today-events-go">▸</span>
    </button>
  )
}
