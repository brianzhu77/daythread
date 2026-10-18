import type { LocalDate } from '../domain/types'
import { getCalendarTasks } from '../domain/workspace'
import { longLabel } from './dates'
import { CaptureBar, CaptureReceipts } from './capture'
import { ContinuousPage } from './continuous-page'
import { FactsStrip } from './facts-strip'
import { StartTheDay, hasHandoffContent, useHandoffLater } from './start-the-day'
import { useDay, useWorkspace } from './use-day'
import { DayHeader } from './day-header'
import { FutureDayState } from './future-day'
import { useEffect } from 'react'

/** Today (and any other date): header, facts strip, Start the day, receipts, the page, capture. */
export function DayScreen({ date, today }: { date: LocalDate; today: LocalDate }) {
  const { run } = useWorkspace()
  const { view, workspace } = useDay(date)
  const [later, setLater] = useHandoffLater(date)
  const page = view?.page ?? null

  // Opening today or a past date creates its page from the template; no model call happens on open (01 §3.1).
  // A future day is never created by looking at it (date navigation rules R7); past days wait on R10.
  const isFuture = date > today
  useEffect(() => {
    if (workspace && !page && !isFuture) void run({ type: 'ensure-day', date })
  }, [workspace, page, date, isFuture, run])

  if (!view || !workspace) return <p className="loading">Loading your day…</p>

  if (isFuture && !page)
    return (
      <div className="day-screen">
        <DayHeader date={date} today={today} />
        <div className="day-body">
          <FutureDayState date={date} today={today} tasks={getCalendarTasks(workspace, date)} />
        </div>
      </div>
    )

  const isToday = date === today
  const showHandoff = isToday && page && !page.handoffDone && !later && hasHandoffContent(view)
  const handoffSettled = !showHandoff

  return (
    <div className="day-screen">
      <DayHeader date={date} today={today} />

      <div className="day-body">
        {showHandoff && <StartTheDay view={view} workspace={workspace} today={today} onLater={() => setLater(true)} />}
        <FactsStrip
          view={view}
          workspace={workspace}
          date={date}
          today={today}
          handoffCollapsed={isToday && Boolean(page && !page.handoffDone && later && hasHandoffContent(view))}
          onReopenHandoff={() => setLater(false)}
          handoffSettled={handoffSettled}
        />
        {page && <CaptureReceipts page={page} workspace={workspace} />}
        {page ? (
          <ContinuousPage key={page.id} page={page} workspace={workspace} />
        ) : (
          <div className="empty">
            <p>No page for {longLabel(date)} yet.</p>
            <button type="button" className="secondary" onClick={() => run({ type: 'ensure-day', date })}>
              Start this page
            </button>
          </div>
        )}
        {page && date <= today && (
          <a className="review-entry" href={`/review?date=${date}`}>
            {page.reviewSaved ? 'Review saved · open again' : `Review ${isToday ? 'today' : longLabel(date)}`}
          </a>
        )}
      </div>


    </div>
  )
}
