import type { LocalDate } from '../domain/types'
import { getCalendarTasks } from '../domain/workspace'
import { longLabel } from './dates'
import { CaptureBar, CaptureReceipts } from './capture'
import { ContinuousPage } from './continuous-page'
import { LinkedFrom, Subpages } from './page-tree'
import { FactsStrip } from './facts-strip'
import { StartTheDay, hasHandoffContent, taskSuggestions, useHandoffLater } from './start-the-day'
import { useDay, useWorkspace } from './use-day'
import { DayHeader } from './day-header'
import { FutureDayState } from './future-day'
import { useEffect, useState } from 'react'

/** Today (and any other date): header, facts strip, Start the day, receipts, the page, capture. */
export function DayScreen({ date, today }: { date: LocalDate; today: LocalDate }) {
  const { run } = useWorkspace()
  const { view, workspace } = useDay(date)
  const [later, setLater] = useHandoffLater(date)
  const [handoffBusy, setHandoffBusy] = useState(false)
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
  // The card stays while an Undo strip shows, even after its last row was added (morning card §6).
  const showHandoff = isToday && page && !page.handoffDone && !later && (hasHandoffContent(view, workspace, today) || handoffBusy)
  const handoffSettled = !showHandoff
  const suggestions = taskSuggestions(view, workspace, today)

  return (
    <div className="day-screen">
      <DayHeader date={date} today={today} />
      {page && <LinkedFrom page={page} workspace={workspace} />}

      <div className="day-body">
        {showHandoff && <StartTheDay view={view} workspace={workspace} today={today} onLater={() => setLater(true)} onBusy={setHandoffBusy} />}
        <FactsStrip
          view={view}
          workspace={workspace}
          date={date}
          today={today}
          handoffCollapsed={isToday && Boolean(page && !page.handoffDone && later && hasHandoffContent(view, workspace, today))}
          handoffCount={suggestions.length + view.handoffBlocks.length}
          cardTaskIds={showHandoff ? new Set(suggestions.map(s => s.task.id)) : undefined}
          onReopenHandoff={() => setLater(false)}
          handoffSettled={handoffSettled}
        />
        {page && <CaptureReceipts page={page} workspace={workspace} />}
        {page ? (
          <>
            <ContinuousPage key={page.id} page={page} workspace={workspace} />
            <Subpages page={page} workspace={workspace} />
          </>
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
