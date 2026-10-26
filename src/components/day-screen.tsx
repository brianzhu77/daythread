import type { LocalDate } from '../domain/types'
import { getCalendarTasks } from '../domain/workspace'
import { longLabel } from './dates'
import { ContinuousPage } from './continuous-page'
import { LinkedFrom, Subpages } from './page-tree'
import { FactsStrip } from './facts-strip'
import { StartTheDay, cardLines, hasHandoffContent, taskSuggestions, useHandoffLater } from './start-the-day'
import { useDay, useWorkspace } from './use-day'
import { DayHeader } from './day-header'
import { FutureDayState } from './future-day'
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'

/** Today (and any other date): header, facts strip, Start the day, the page. */
export function DayScreen({ date, today }: { date: LocalDate; today: LocalDate }) {
  const { run } = useWorkspace()
  const { view, workspace } = useDay(date)
  const [later, setLater] = useHandoffLater(date)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const page = view?.page ?? null

  // Opening today or a past date creates its page from the template; no model call happens on open (01 §3.1).
  // A future day is never created by looking at it (date navigation rules R7); past days wait on R10.
  const isFuture = date > today
  // B9: while today's page is being made, the screen keeps its one loading line instead of flashing "No page yet ·
  // Start this page"; that state shows only if making the page failed.
  // Decided while rendering, not in the effect, so not even one frame shows the empty state before the call starts.
  // On a connection that hangs (no reply, no error), it stops waiting after 6 s and offers Start, as before; the page still
  // appears if the reply comes later (Bumblebee).
  const [failed, setFailed] = useState<LocalDate | null>(null)
  useEffect(() => {
    if (!workspace || page || isFuture) return
    void run({ type: 'ensure-day', date }).then(made => { if (!made) setFailed(date) })
    const waited = setTimeout(() => setFailed(date), 6000)
    return () => clearTimeout(waited)
  }, [workspace, page, date, isFuture, run])

  if (!view || !workspace || (!page && !isFuture && failed !== date)) return <p className="loading">Loading your day…</p>

  if (isFuture && !page)
    return (
      <div className="day-screen">
        <DayHeader date={date} today={today} />
        <div className="day-body">
          <FutureDayState date={date} today={today} tasks={getCalendarTasks(workspace, date)} events={view.events} workspace={workspace} />
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
          handoffCount={suggestions.length + cardLines(view).length}
          cardTaskIds={showHandoff ? new Set(suggestions.map(s => s.task.id)) : undefined}
          onReopenHandoff={() => setLater(false)}
          handoffSettled={handoffSettled}
        />
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
          // A router link, not a document load (B41): offline, a full load is the browser's error page.
          <Link className="review-entry" to="/review" search={{ date }}>
            {page.reviewSaved ? 'Review saved · open again' : `Review ${isToday ? 'today' : longLabel(date)}`}
          </Link>
        )}
      </div>


    </div>
  )
}
