import type { DayEvent, DayView, LocalDate, Task, Workspace } from '../domain/types'
import { flatNodes, pageNodes, rowTaskId } from '../domain/editor-document'
import { plannedOn } from '../domain/workspace'
import { shortLabel, taskDateTag } from './dates'
import { Disclosure, RowMenu } from './row-menu'
import { anotherDayItems, useTaskActions } from './task-row'
import { useWorkspace } from './use-day'
import { eventsHeading, shortTime } from './event-rows'
import { CalendarIcon } from './icons'
import { jumpToBlock } from './line-jump'

interface Props {
  view: DayView
  workspace: Workspace
  date: LocalDate
  today: LocalDate
  /** Shown as a collapsed line when Start the day was set aside with Later. */
  handoffCollapsed: boolean
  /** Rows waiting in the collapsed morning card. */
  handoffCount: number
  onReopenHandoff: () => void
  handoffSettled: boolean
  /** Tasks that are rows in the open morning card; "N other open tasks" leaves them out. */
  cardTaskIds?: ReadonlySet<string>
}

/** Computed facts above the page, never page text. No counts to clear. */
export function FactsStrip({ view, workspace, date, today, handoffCollapsed, handoffCount, onReopenHandoff, handoffSettled, cardTaskIds }: Props) {
  const isToday = date === today
  const pageTaskIds = new Set(view.page ? flatNodes(pageNodes(view.page)).map(rowTaskId).filter(Boolean) : [])
  const dueSoon = view.attention.filter(t => !pageTaskIds.has(t.id))
  // Tasks already placed on this day are on the page, and rows of the open morning card are on the card; the pool lists
  // the rest. Done, Later or hiding the card counts its tasks again.
  const stillOpen = view.openPool.filter(t => plannedOn(workspace, t.id) !== date && !cardTaskIds?.has(t.id))

  return (
    <div className="facts" aria-label="Facts for this day">
      {isToday && view.events.length > 0 && <TodayEvents events={view.events} headingId={view.page ? eventsHeading(pageNodes(view.page))?.id : undefined} />}
      {isToday && handoffCollapsed && (
        <button type="button" className="fact-line link-line" onClick={onReopenHandoff}>
          Suggestions · {handoffCount} ▸
        </button>
      )}

      {isToday && handoffSettled && view.carry.length > 0 && (
        <div className="fact-block">
          <p className="fact-label">Continue?</p>
          {view.carry.slice(0, 3).map(t => (
            <PoolRow key={t.id} task={t} today={today} />
          ))}
        </div>
      )}

      {dueSoon.length > 0 && (
        <div className="fact-block">
          <p className="fact-label">Due soon</p>
          {dueSoon.map(t => (
            <div key={t.id} className="fact-row">
              <span className="grow">{t.title}</span>
              <span className={`app-tag ${t.paused ? 'quiet' : ''}`}>{t.paused ? `Not today · ${taskDateTag(t, today, date, plannedOn(workspace, t.id))}` : taskDateTag(t, today, date, plannedOn(workspace, t.id))}</span>
            </div>
          ))}
        </div>
      )}

      {/* Shown only when there is something to open: a link announcing nothing is noise. */}
      {isToday && (stillOpen.length > 0 || view.paused.length > 0) && (
        <div className="fact-pair">
          {stillOpen.length > 0 && (
            <Disclosure summary={`${stillOpen.length} other open task${stillOpen.length === 1 ? '' : 's'}`}>
              {stillOpen.map(t => (
                <PoolRow key={t.id} task={t} today={today} />
              ))}
            </Disclosure>
          )}
          {view.paused.length > 0 && (
            <Disclosure summary={`Not today · ${view.paused.length}`}>
              {view.paused.map(t => (
                <PoolRow key={t.id} task={t} today={today} paused />
              ))}
            </Disclosure>
          )}
        </div>
      )}
    </div>
  )
}

function PoolRow({ task, today, paused = false }: { task: Task; today: LocalDate; paused?: boolean }) {
  const { planOn, notToday } = useTaskActions(today)
  const { workspace } = useWorkspace()
  return (
    <div className="fact-row">
      <span className="grow">{task.title}</span>
      <span className="app-tag">{taskDateTag(task, today, today, workspace ? plannedOn(workspace, task.id) : null)}</span>
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
function TodayEvents({ events, headingId }: { events: DayEvent[]; headingId?: string }) {
  const named = events.slice(0, 2).map(e => `${e.time ? `${shortTime(e.time)} ` : ''}${e.title || 'Untitled event'}`)
  const parts = [...named, ...(events.length === 1 && !events[0]!.time ? ['All day'] : [])]
  const more = events.length > 2 ? `+${events.length - 2} more` : ''
  const jump = () => { const at = document.querySelector<HTMLElement>('.event-rows') ?? (headingId ? document.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(headingId)}"]`) : null); if (at) jumpToBlock(at) }
  return (
    <button type="button" className="fact-line link-line today-events" onClick={jump}>
      <span className="page-ref-icon" aria-hidden="true"><CalendarIcon /></span>
      <span className="today-events-text">{parts.join(' · ')}</span>
      {more && <span className="today-events-more">{more}</span>}
      <span className="today-events-go">▸</span>
    </button>
  )
}
