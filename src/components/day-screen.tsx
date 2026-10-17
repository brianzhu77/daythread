import type { LocalDate } from '../domain/types'
import { addDays, fromIso, longLabel } from './dates'
import { CaptureBar, CaptureReceipts } from './capture'
import { DayPage } from './day-page'
import { FactsStrip } from './facts-strip'
import { StartTheDay, hasHandoffContent, useHandoffLater } from './start-the-day'
import { SaveIndicator } from './app-shell'
import { useDay, useWorkspace } from './use-day'
import { useEffect } from 'react'

/** Today (and any other date): header, facts strip, Start the day, receipts, the page, capture. */
export function DayScreen({ date, today }: { date: LocalDate; today: LocalDate }) {
  const { run } = useWorkspace()
  const { view, workspace } = useDay(date)
  const [later, setLater] = useHandoffLater(date)
  const page = view?.page ?? null

  // Opening a date creates its page from the template; no model call happens on open (01 §3.1).
  useEffect(() => {
    if (workspace && !page) void run({ type: 'ensure-day', date })
  }, [workspace, page, date, run])

  if (!view || !workspace) return <p className="loading">Loading your day…</p>

  const isToday = date === today
  const showHandoff = isToday && page && !page.handoffDone && !later && hasHandoffContent(view)
  const handoffSettled = !showHandoff

  return (
    <div className="day-screen">
      <header className="day-head">
        <div className="day-title">
          {/* Craft's daily-note title: "Tomorrow, Fri, Nov 28" (craft-v1 §5.1). */}
          <h1>
            {relativeDay(date, today) && <span className="relative-day">{relativeDay(date, today)}, </span>}
            {longLabel(date)}
          </h1>
          <label className="date-pill">
            <span>{fromIso(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span aria-hidden="true">⌄</span>
            <input
              type="date"
              value={date}
              aria-label="Go to date"
              onChange={e => e.target.value && (window.location.href = `/day/${e.target.value}`)}
            />
          </label>
        </div>
        <nav className="day-nav" aria-label="Change day">
          <a className="button icon" href={`/day/${addDays(date, -1)}`} aria-label="Previous day">←</a>
          {!isToday && <a className="button secondary chip-link" href="/">Back to today</a>}
          <a className="button icon" href={`/day/${addDays(date, 1)}`} aria-label="Next day">→</a>
        </nav>
        <SaveIndicator />
      </header>

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
          <DayPage key={page.id} page={page} workspace={workspace} today={today} />
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

      {page && <CaptureBar page={page} />}
    </div>
  )
}

function relativeDay(date: LocalDate, today: LocalDate): string | null {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  return null
}
