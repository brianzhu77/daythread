import type { DayView, LocalDate, Task, Workspace } from '../domain/types'
import { daysBetween, shortLabel, taskDateTag } from './dates'
import { Disclosure, RowMenu } from './row-menu'
import { anotherDayItems, useTaskActions } from './task-row'
import { useWorkspace } from './use-day'
import { displayTitle } from './day-page'

interface Props {
  view: DayView
  workspace: Workspace
  date: LocalDate
  today: LocalDate
  /** Shown as a collapsed line when Start the day was set aside with Later. */
  handoffCollapsed: boolean
  onReopenHandoff: () => void
  handoffSettled: boolean
}

/** Computed facts above the page, never page text (01 §3.2, §3.3, §3.4). No counts to clear. */
export function FactsStrip({ view, workspace, date, today, handoffCollapsed, onReopenHandoff, handoffSettled }: Props) {
  const isToday = date === today
  const pageTaskIds = new Set(view.page?.sections.flatMap(s => s.blocks).map(b => b.taskId).filter(Boolean))
  const dueSoon = view.attention.filter(t => !pageTaskIds.has(t.id))
  const notInNote = view.planned.filter(t => !pageTaskIds.has(t.id))
  // Tasks already placed on this day are on the page; the pool lists the rest.
  const stillOpen = view.openPool.filter(t => t.plannedOn !== date)
  const waiting = workspace.captures.filter(c => c.status === 'needs_confirmation')

  return (
    <div className="facts" aria-label="Facts for this day">
      {isToday && handoffCollapsed && (
        <button type="button" className="fact-line link-line" onClick={onReopenHandoff}>
          Start the day ▸
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
              <span className={`tag ${t.paused ? 'quiet' : ''}`}>{t.paused ? `Not today · ${taskDateTag(t, today, date)}` : taskDateTag(t, today, date)}</span>
            </div>
          ))}
        </div>
      )}

      {notInNote.length > 0 && <NotInNote tasks={notInNote} date={date} today={today} />}

      {isToday && <RelatedLine view={view} workspace={workspace} date={date} />}

      {isToday && (
        <div className="fact-pair">
          <Disclosure summary={stillOpen.length ? `Still open · ${stillOpen.length} · oldest ${oldestDays(stillOpen, today)} ${oldestDays(stillOpen, today) === 1 ? 'day' : 'days'}` : 'Nothing else open'}>
            {stillOpen.map(t => (
              <PoolRow key={t.id} task={t} today={today} />
            ))}
          </Disclosure>
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

function oldestDays(tasks: Task[], today: LocalDate): number {
  return Math.max(0, ...tasks.map(t => daysBetween(t.lastPlannedOn ?? t.createdOn, today)))
}

function PoolRow({ task, today, paused = false }: { task: Task; today: LocalDate; paused?: boolean }) {
  const { planOn, notToday } = useTaskActions(today)
  return (
    <div className="fact-row">
      <span className="grow">{task.title}</span>
      <span className="tag">{taskDateTag(task, today)}</span>
      <span className="actions">
        <button type="button" className="secondary" onClick={() => planOn(task, today, 'other')}>
          {paused ? 'Bring back' : 'Today'}
        </button>
        {!paused && (
          <button type="button" className="ghost" onClick={() => notToday(task, today)}>
            Not today
          </button>
        )}
        <RowMenu label={`More for ${task.title}`} groups={[{ title: 'Another day', items: anotherDayItems(task, today, planOn) }]} />
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
        <button type="button" className="link" onClick={async () => { for (const t of tasks) await planOn(t, date, 'other') }}>
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
    const items = (view.page?.draft?.materialIds ?? [])
    .map(id => workspace.materials.find(m => m.id === id))
    .filter(m => m !== undefined && m.resurface && !m.dismissedOn?.includes(date) && m.reviewState !== 'done' && m.reviewState !== 'task')
    .slice(0, 2)
  if (!items.length) return null
  return (
    <div className="fact-block related">
      <p className="fact-label">
        Related {view.page?.draft?.simulated && <span className="sim">Simulated</span>}
      </p>
      {items.map(m => (
        <div key={m!.id} className="fact-row">
          <span className="grow">
            {displayTitle(m!.title, m!.url)} <span className="quiet">— might be useful</span>
          </span>
          <span className="actions">
            <a className="button secondary" href={m!.url} target="_blank" rel="noreferrer" onClick={() => void run({ type: 'open-material', materialId: m!.id, date }, null)}>
              Open
            </a>
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
      ))}
    </div>
  )
}
