import type { LocalDate } from '../domain/types'
import { DraftLine } from './day-draft'
import { getCalendarTasks } from '../domain/workspace'
import { longLabel } from './dates'
import { ContinuousPage } from './continuous-page'
import { dayMenuGroups, LinkedFrom, Subpages } from './page-tree'
import { PageIconLine } from './icon-picker'
import { RowMenu } from './row-menu'
import { useDeletePage, useRestore, useRunFromButton } from './trash'
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
  const deletePage = useDeletePage()
  const restore = useRestore()
  const runFromButton = useRunFromButton()
  // The newest page of this date in the trash, while no live one holds the date (B16).
  const trashed = page ? undefined : workspace?.pages.filter(p => p.type === 'daily' && p.date === date && p.trashedAt).sort((a, b) => b.trashedAt!.localeCompare(a.trashedAt!))[0]

  // Opening today or a past date creates its page from the template; no model call happens on open (01 §3.1).
  // A future day is never created by looking at it (date navigation rules R7); past days wait on R10.
  const isFuture = date > today
  // B9: while today's page is being made, the screen keeps its one loading line instead of flashing "No page yet ·
  // Start this page"; that state shows only if making the page failed.
  // Decided while rendering, not in the effect, so not even one frame shows the empty state before the call starts.
  // On a connection that hangs (no reply, no error), it stops waiting after 6 s and offers Start, as before; the page still
  // appears if the reply comes later (Bumblebee).
  const [failed, setFailed] = useState<LocalDate | null>(null)
  // A page in the trash holds the date until he says otherwise: opening it makes no new page, and so doesn't end Undo.
  const inTrash = Boolean(trashed)
  useEffect(() => {
    if (!workspace || page || isFuture || inTrash) return
    void run({ type: 'ensure-day', date }).then(made => { if (!made) setFailed(date) })
    const waited = setTimeout(() => setFailed(date), 6000)
    return () => clearTimeout(waited)
  }, [workspace, page, date, isFuture, inTrash, run])

  if (!view || !workspace || (!page && !isFuture && !inTrash && failed !== date)) return <p className="loading">Loading your day…</p>

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
  const menuGroups = page && dayMenuGroups(workspace, page, () => void deletePage(page, null))

  return (
    <div className="day-screen">
      {page && <PageIconLine page={page} />}
      <DayHeader date={date} today={today} menu={menuGroups && <RowMenu label="Day actions" triggerClass="page-more" groups={menuGroups} />} />
      {page && <LinkedFrom page={page} workspace={workspace} />}
      {page && isToday && <DraftLine page={page} />}

      <div className="day-body">
        <FactsStrip view={view} workspace={workspace} date={date} today={today} />
        {page ? (
          <>
            <ContinuousPage key={page.id} page={page} workspace={workspace} />
            <Subpages page={page} workspace={workspace} />
          </>
        ) : trashed ? (
          <div className="empty">
            <p>{isToday ? "Today's page" : `The page for ${longLabel(date)}`} is in Trash.</p>
            <div className="day-in-trash-actions">
              <button type="button" className="secondary" onClick={() => void restore(trashed, { whole: true, withOpen: false })}>Restore</button>
              <button type="button" className="secondary" onClick={() => void runFromButton({ type: 'ensure-day', date }, undefined, "Couldn't start a page · try again")}>Start a new page</button>
            </div>
          </div>
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
