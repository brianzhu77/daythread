import type { DayEvent, DayView, LocalDate, Task, Workspace } from '../domain/types'
import { shortLabel, taskDateTag } from './dates'
import { Disclosure, RowMenu } from './row-menu'
import { anotherDayItems, useTaskActions } from './task-row'
import { useWorkspace } from './use-day'
import { displayTitle } from './day-page'
import { useNavigate } from '@tanstack/react-router'
import { eveningPicks, isCardDraft, linkPageOf } from '../domain/workspace'
import { displayPageTitle } from './page-title'
import { shortTime } from './event-rows'
import { CalendarIcon } from './icons'
import { jumpToBlock } from './line-jump'

interface Props {
  view: DayView
  workspace: Workspace
  date: LocalDate
  today: LocalDate
  /** Shown as a collapsed line when Start the day was set aside with Later. */
  handoffCollapsed: boolean
  /** Rows waiting in the collapsed morning card (morning card §8, Later). */
  handoffCount: number
  /** Draft my day is running: the strip reads "Suggestions · drafting…" (morning-model-states §2). */
  handoffDrafting?: boolean
  onReopenHandoff: () => void
  handoffSettled: boolean
  /** Tasks that are rows in the open morning card; "N other open tasks" leaves them out (Lead 23a43f85, card §3). */
  cardTaskIds?: ReadonlySet<string>
}

/** Computed facts above the page, never page text (01 §3.2, §3.3, §3.4). No counts to clear. */
export function FactsStrip({ view, workspace, date, today, handoffCollapsed, handoffCount, handoffDrafting, onReopenHandoff, handoffSettled, cardTaskIds }: Props) {
  const isToday = date === today
  const pageTaskIds = new Set(view.page?.sections.flatMap(s => s.blocks).map(b => b.taskId).filter(Boolean))
  const dueSoon = view.attention.filter(t => !pageTaskIds.has(t.id))
  const notInNote = view.planned.filter(t => !pageTaskIds.has(t.id))
  // Tasks already placed on this day are on the page, and rows of the open morning card are on the card; the pool lists
  // the rest. Done, Later or hiding the card counts its tasks again.
  const stillOpen = view.openPool.filter(t => t.plannedOn !== date && !cardTaskIds?.has(t.id))
  const waiting = workspace.captures.filter(c => c.status === 'needs_confirmation')

  return (
    <div className="facts" aria-label="Facts for this day">
      {isToday && view.events.length > 0 && <TodayEvents events={view.events} headingId={view.page?.sections.find(s => s.kind === 'events')?.id} />}
      {isToday && handoffCollapsed && (
        <button type="button" className="fact-line link-line" onClick={onReopenHandoff}>
          Suggestions · {handoffDrafting ? 'drafting…' : handoffCount} ▸
        </button>
      )}

      {waiting.length > 0 && (
        <a className="fact-line attention" href="#captures">
          {waiting.length} capture{waiting.length > 1 ? 's' : ''} waiting · Review
        </a>
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
              <span className={`app-tag ${t.paused ? 'quiet' : ''}`}>{t.paused ? `Not today · ${taskDateTag(t, today, date)}` : taskDateTag(t, today, date)}</span>
            </div>
          ))}
        </div>
      )}

      {notInNote.length > 0 && <NotInNote tasks={notInNote} date={date} today={today} />}

      {isToday && <RelatedLine view={view} workspace={workspace} date={date} />}

      {/* Shown only when there is something to open: a link announcing nothing is noise (date navigation rules, controls). */}
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
  return (
    <div className="fact-row">
      <span className="grow">{task.title}</span>
      <span className="app-tag">{taskDateTag(task, today)}</span>
      <span className="actions">
        <button type="button" className="secondary" onClick={() => planOn(task, today, 'other')}>
          {paused ? 'Bring back' : 'Today'}
        </button>
        {!paused && (
          <button type="button" className="ghost" onClick={() => notToday(task, today)}>
            Not today
          </button>
        )}
        <RowMenu label={`More for ${task.title}`} groups={[{ title: 'Another day', items: anotherDayItems(task, today, (t, d) => planOn(t, d, undefined, today)) }]} />
      </span>
    </div>
  )
}

function NotInNote({ tasks, date, today }: { tasks: Task[]; date: LocalDate; today: LocalDate }) {
  const { planOn, notToday } = useTaskActions(today)
  return (
    <div className="fact-block">
      <p className="fact-label">
        Planned · not in note ({tasks.length}) ·{' '}
        <button type="button" className="app-link" onClick={async () => { for (const t of tasks) await planOn(t, date, 'other') }}>
          Put back
        </button>
      </p>
      {tasks.map(t => (
        <div key={t.id} className="fact-row">
          <span className="grow">{t.title}</span>
          <button type="button" className="ghost" onClick={() => notToday(t, date)}>
            {date === today ? 'Not today' : `Not on ${shortLabel(date)}`}
          </button>
        </div>
      ))}
    </div>
  )
}

/** 0–2 items from today's draft (01 §6.6). Opens and dismissals are logged for the kill rule. */
function RelatedLine({ view, workspace, date }: { view: DayView; workspace: Workspace; date: LocalDate }) {
  const { run } = useWorkspace()
  const navigate = useNavigate()
  // B47: his evening links first, then a Draft my day run's, each once.
  const draft = view.page?.draft ?? null, card = Boolean(draft && isCardDraft(draft))
  const items = [...new Set([...eveningPicks(draft).materialIds, ...(card ? draft!.materialIds : [])])]
    .map(id => workspace.materials.find(m => m.id === id))
    .filter(m => m !== undefined && m.resurface && !m.dismissedOn?.includes(date) && m.reviewState !== 'done' && m.reviewState !== 'task')
    .slice(0, 2)
  if (!items.length) return null
  return (
    <div className="fact-block related">
      <p className="fact-label">
        Related {draft?.simulated && card && <span className="sim">Simulated</span>}
      </p>
      {items.map(m => {
        // A2 §6: a saved link that is a link page shows the page's title, and Open opens the page.
        const linkPage = linkPageOf(workspace, m!)
        return (
        <div key={m!.id} className="fact-row">
          <span className="grow">
            {linkPage ? displayPageTitle(linkPage) : displayTitle(m!.title, m!.url)} <span className="quiet">— might be useful</span>
          </span>
          <span className="actions">
            {linkPage
              ? <a className="app-button secondary" href={`/pages?page=${encodeURIComponent(linkPage.id)}`} onClick={e => { e.preventDefault(); void run({ type: 'open-material', materialId: m!.id, date }, null); void navigate({ to: '/pages', search: { page: linkPage.id } }) }}>Open</a>
              : <a className="app-button secondary" href={m!.url} target="_blank" rel="noreferrer" onClick={() => void run({ type: 'open-material', materialId: m!.id, date }, null)}>
              Open
            </a>}
            <button type="button" className="ghost" onClick={() => run({ type: 'dismiss-material', materialId: m!.id, date }, { text: 'Won’t show this today' })}>
              Not useful
            </button>
            <RowMenu
              label={`More for ${m!.title}`}
              groups={[
                {
                  items: [
                    {
                      label: 'Don’t resurface',
                      onSelect: () =>
                        run({ type: 'material-resurface', materialId: m!.id, enabled: false }, r => ({
                          text: 'Won’t suggest this again',
                          undoOperationId: r.operationId,
                        })),
                    },
                  ],
                },
              ]}
            />
          </span>
        </div>
        )
      })}
    </div>
  )
}

/**
 * B27 (Jazz b27-at-date-states §3d): today's events as one fact line, first in the strip, so he sees them above the
 * fold on the phone. The same list as the rows under Events; a tap jumps to those rows.
 */
function TodayEvents({ events, headingId }: { events: DayEvent[]; headingId?: string }) {
  // Time first for timed events, all-day ones bare; a single all-day event says so (Jazz 2cf1591a).
  const named = events.slice(0, 2).map(e => `${e.time ? `${shortTime(e.time)} ` : ''}${e.title || 'Untitled event'}`)
  const parts = [...named, ...(events.length === 1 && !events[0]!.time ? ['All day'] : [])]
  // Titles truncate; "+N more" stays readable at 390 (Jazz §3d).
  const more = events.length > 2 ? `+${events.length - 2} more` : ''
  // Every event may be a line under Events itself (no rows drawn): then the heading is where they are.
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
