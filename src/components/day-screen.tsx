import type { LocalDate } from '../domain/types'
import { getCalendarTasks } from '../domain/workspace'
import { longLabel } from './dates'
import { ContinuousPage } from './continuous-page'
import { LinkedFrom, Subpages } from './page-tree'
import { FactsStrip } from './facts-strip'
import { useDay, useWorkspace } from './use-day'
import { DayHeader } from './day-header'
import { FutureDayState } from './future-day'
import { useEffect, useState } from 'react'
import { PendingTomorrowLines } from './pending-tomorrow-lines'

/** Today (and any other date): header, facts strip, the page. Today's draft shows on the page itself (B76). */
export function DayScreen({ date, today }: { date: LocalDate; today: LocalDate }) {
  const { run } = useWorkspace()
  const { view, workspace } = useDay(date)
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

  return (
    <div className="day-screen">
      <DayHeader date={date} today={today} />
      {page && <LinkedFrom page={page} workspace={workspace} />}

      <div className="day-body">
        <FactsStrip view={view} workspace={workspace} date={date} today={today} />
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
        {/* B68: lines left unsaved in the old Tomorrow block are saved once as to-dos; nothing is shown. */}
        {isToday && <PendingTomorrowLines today={today} />}
      </div>


    </div>
  )
}
