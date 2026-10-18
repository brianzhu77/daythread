import { useState } from 'react'
import type { DayView, LocalDate, Page, Workspace } from '../domain/types'
import { taskDateTag, weekday } from './dates'
import { useTaskActions } from './task-row'
import { useWorkspace } from './use-day'

export function previousDailyPage(workspace: Workspace, date: LocalDate): Page | undefined {
  return workspace.pages
    .filter(p => p.type === 'daily' && p.date !== null && p.date < date)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1))[0]
}

/** "Later" is screen-only (01 §3.5): it collapses the card for the rest of the day. */
export function useHandoffLater(date: LocalDate): [boolean, (v: boolean) => void] {
  const key = `daythread.handoff-later.${date}`
  const [later, setLater] = useState(() => typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key) === '1')
  return [
    later,
    v => {
      sessionStorage.setItem(key, v ? '1' : '0')
      setLater(v)
    },
  ]
}

export function hasHandoffContent(view: DayView): boolean {
  // Only tasks and suggestions; the previous page's Notes lines are no longer offered (rules doc, visible controls).
  return Boolean(view.page?.draft?.taskIds.length || view.handoffTasks.length)
}

/** Morning hand-off (01 §3.5). Skipping is normal; nothing here needs clearing. */
export function StartTheDay({ view, workspace, today, onLater }: { view: DayView; workspace: Workspace; today: LocalDate; onLater: () => void }) {
  const { run, simOutcome } = useWorkspace()
  const { planOn, notToday } = useTaskActions(today)
  const page = view.page!
  const prev = previousDailyPage(workspace, today)
  const prevDay = prev?.date ? weekday(prev.date) : 'yesterday'
  const draftTasks = (page.draft?.taskIds ?? [])
    .map(id => workspace.tasks.find(t => t.id === id))
    .filter(t => t !== undefined && t.status === 'open')
  const inTop3 = new Set(page.sections.filter(s => s.kind === 'top3').flatMap(s => s.blocks).map(b => b.taskId))
  // Suggestions start ticked; Brian unticks what he doesn't want, then adds (nothing changes until then).
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set())
  const picked = new Set(draftTasks.filter(t => !inTop3.has(t!.id) && !unpicked.has(t!.id)).map(t => t!.id))

  const addPicked = async () => {
    for (const id of picked) {
      const task = workspace.tasks.find(t => t.id === id)
      if (task) await planOn(task, today, 'top3')
    }
  }

  return (
    <section className="app-card start-the-day" aria-labelledby="std-title">
      <header className="card-head">
        <h2 id="std-title">Start the day</h2>
        {page.draft?.simulated && <span className="sim">Simulated suggestions</span>}
      </header>

      {prev && !prev.reviewSaved && prev.date && (
        <p className="line">
          {weekday(prev.date)}’s review wasn’t finished · <a href={`/review?date=${prev.date}`}>Finish (1 min)</a>
        </p>
      )}

      <div className="std-group">
        <h3>Suggested last night</h3>
        {draftTasks.length ? (
          <>
            <ul className="plain">
              {draftTasks.map(t => (
                <li key={t!.id}>
                  <label className="pick">
                    <input
                      type="checkbox"
                      checked={inTop3.has(t!.id) || picked.has(t!.id)}
                      disabled={inTop3.has(t!.id)}
                      onChange={e => {
                        const next = new Set(unpicked)
                        if (e.target.checked) next.delete(t!.id)
                        else next.add(t!.id)
                        setUnpicked(next)
                      }}
                    />
                    <span>{t!.title}</span>
                    <span className="app-tag">{inTop3.has(t!.id) ? 'In Top 3' : taskDateTag(t!, today)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" className="secondary" disabled={!picked.size} onClick={addPicked}>
              Add to Top 3
            </button>
          </>
        ) : (
          <p className="line">
            {page.draftError ? 'Suggestions couldn’t be prepared' : 'No suggestions from last night'} ·{' '}
            <button type="button" className="app-link" onClick={() => run({ type: 'generate-draft', date: today, outcome: simOutcome }, null)}>
              {page.draftError ? 'Retry' : 'Draft my day'}
            </button>
          </p>
        )}
      </div>

      {view.handoffTasks.length > 0 && (
        <div className="std-group">
          <h3>
            Still open from {prevDay} <span className="quiet">({view.handoffTasks.length})</span>
          </h3>
          <ul className="plain">
            {view.handoffTasks.map(t => (
              <li key={t.id} className="std-row">
                <span className="grow">{t.title}</span>
                <span className="app-tag">{taskDateTag(t, today)}</span>
                <span className="actions">
                  <button type="button" className="secondary" onClick={() => planOn(t, today, 'other')}>Keep</button>
                  <button type="button" className="ghost" onClick={() => notToday(t, today)}>Not today</button>
                </span>
              </li>
            ))}
          </ul>
          {/* With one task, Keep all would repeat Keep. */}
          {view.handoffTasks.length > 1 && (
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                for (const t of view.handoffTasks) await planOn(t, today, 'other')
              }}
            >
              Keep all
            </button>
          )}
        </div>
      )}

      <footer className="card-foot">
        <button type="button" className="primary" onClick={() => run({ type: 'handoff-done', date: today }, { text: 'Day started' })}>
          Done
        </button>
        <button type="button" className="ghost" onClick={onLater}>
          Later
        </button>
      </footer>
    </section>
  )
}
