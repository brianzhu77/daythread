import { useEffect, useState } from 'react'
import type { LocalDate, Material, Task, Workspace } from '../domain/types'
import { addDays, longLabel, shortLabel, taskDateTag, weekday } from './dates'
import { CaptureBar, CaptureReceipts } from './capture'
import { RowMenu } from './row-menu'
import { anotherDayItems, useTaskActions } from './task-row'
import { ParentLine, treeIndent, useTaskTree } from './task-tree'
import { useDay, useWorkspace } from './use-day'
import { displayTitle } from './day-page'
import { Link, useNavigate } from '@tanstack/react-router'
import { linkPageOf } from '../domain/workspace'
import { displayPageTitle } from './page-title'
import { ExternalIcon } from './icons'

type StepId = 'plan' | 'saved' | 'capture' | 'reflect' | 'tomorrow'

const stepNumber: Record<StepId, number> = { plan: 1, saved: 2, capture: 3, reflect: 4, tomorrow: 5 }
const stepById = (n: number | undefined): StepId => (Object.keys(stepNumber) as StepId[]).find(k => stepNumber[k] === n) ?? 'plan'

/** Screen-only details. The step, source, skip and saved state live on the page (domain). */
interface Progress {
  reflection: string | null
  acted: Record<string, string>
  removedSuggestions: string[]
  tomorrowSaved: boolean
  /** What Brian saw when a save hit a conflict. Anything else in the latest draft is new to him. */
  kept?: string[]
}

const blank: Progress = { reflection: null, acted: {}, removedSuggestions: [], tomorrowSaved: false }

function useProgress(date: LocalDate): [Progress | null, (patch: Partial<Progress>) => void] {
  const key = `daythread.review.${date}`
  // null until read from storage, so a resumed review never flashes its blank state.
  const [p, setP] = useState<Progress | null>(null)
  useEffect(() => {
    const raw = localStorage.getItem(key)
    setP(raw ? { ...blank, ...JSON.parse(raw) } : blank)
  }, [key])
  return [
    p,
    patch =>
      setP(prev => {
        const next = { ...(prev ?? blank), ...patch }
        localStorage.setItem(key, JSON.stringify(next))
        return next
      }),
  ]
}

/** Guided evening review, phone first (01 §7 + Good Stuffs addendum G-2). Each step fits one screen. */
export function ReviewFlow({ date, today, fromReminder }: { date: LocalDate; today: LocalDate; fromReminder: boolean }) {
  const { run } = useWorkspace()
  const { view, workspace } = useDay(date)
  const [progress, update] = useProgress(date)
  const page = view?.page ?? null
  // The set of saved items is fixed when the step opens, so a decision doesn't pull in a fourth card.
  const [sortIds, setSortIds] = useState<string[] | null>(null)

  // Record where the review was opened from (04 counts "opened from the reminder").
  const recorded = page?.reviewSource !== undefined
  useEffect(() => {
    if (page && !recorded) void run({ type: 'review-progress', date, step: 1, source: fromReminder ? 'reminder' : 'direct' }, null)
  }, [page, recorded, fromReminder, date, run])

  if (!view || !workspace || !progress) return <p className="loading">Loading…</p>
  const p = progress
  if (!page) return <p className="empty">There’s no page for {longLabel(date)} to review.</p>

  const current = stepById(page.reviewStep)
  const hasSaved = view.materialReview.length > 0 || (current === 'saved' && (sortIds?.length ?? 0) > 0)
  const steps: StepId[] = ['plan', ...(hasSaved ? (['saved'] as const) : []), 'capture', 'reflect', 'tomorrow']
  const index = Math.max(0, steps.indexOf(current))
  const setStep = (s: StepId) => {
    if (s === 'saved' && sortIds === null) setSortIds(view.materialReview.map(m => m.id))
    void run({ type: 'review-progress', date, step: stepNumber[s] }, null)
  }
  const go = (delta: number) => setStep(steps[Math.min(steps.length - 1, Math.max(0, index + delta))])
  const reflection = p.reflection ?? page.reviewText
  const sortCards = (sortIds ?? view.materialReview.map(m => m.id))
    .map(id => workspace.materials.find(m => m.id === id))
    .filter((m): m is Material => m !== undefined)
  const undecided = sortCards.filter(m => m.reviewState === 'pending' || (m.reviewState === 'watching' && m.lastDecisionOn !== date))

  const saveReview = (finish: boolean) => run({ type: 'save-review', date, text: reflection, finish }, { text: 'Review saved' })

  if (page.reviewSkipped)
    return (
      <div className="review">
        <p className="quiet">Skipped tonight</p>
        <button type="button" className="secondary" onClick={() => run({ type: 'review-progress', date, step: 1, skip: false }, null)}>
          Review anyway
        </button>
      </div>
    )

  const placedToday = workspace.tasks.filter(t => t.plannedOn === date && t.status !== 'cancelled')
  // Cards stay in place after an action so the list doesn't jump; they show what was done.
  const planCards = workspace.tasks.filter(t => (t.plannedOn === date && t.status !== 'cancelled') || p.acted[t.id])
  const openCount = placedToday.filter(t => t.status === 'open').length

  return (
    <div className="review">
      <header className="review-head">
        <p className="eyebrow">
          Review · {date === today ? 'today' : longLabel(date)}
          {fromReminder && <span className="quiet"> · from your reminder</span>}
        </p>
        <ol className="steps" aria-label="Review steps">
          {steps.map((s, i) => (
            <li key={s} aria-current={i === index ? 'step' : undefined} className={i < index ? 'past' : ''}>
              <button type="button" onClick={() => setStep(s)} aria-label={`Go to step ${i + 1}`}>{i + 1}</button>
            </li>
          ))}
        </ol>
        {!page.reviewSaved && (
          <button type="button" className="app-link" onClick={() => saveReview(true)}>
            Finish
          </button>
        )}
        {page.reviewSaved && <span className="ok">Review saved</span>}
      </header>

      {current === 'plan' && (
        <section className="review-step" aria-labelledby="rs-plan">
          {/* A day without tasks reads "nothing planned", not "0 open of 0" (empty-start-states §2). */}
          <h2 id="rs-plan">
            {planCards.length === 0 ? `${weekday(date)} · nothing planned` : `${weekday(date)} · ${openCount} open of ${placedToday.length}`}
          </h2>
          <TaskTree tasks={planCards}>
            {(t, depth, parentId) => (
              <PlanCard
                key={t.id}
                task={t}
                date={date}
                today={today}
                depth={depth}
                parentId={parentId}
                acted={p.acted[t.id] ?? (t.status === 'done' ? 'Done' : undefined)}
                onActed={label => update({ acted: { ...p.acted, [t.id]: label } })}
              />
            )}
          </TaskTree>
          <StepFoot onNext={() => go(1)} extra={<button type="button" className="ghost" onClick={() => run({ type: 'review-progress', date, step: 1, skip: true }, null)}>Skip tonight</button>} />
        </section>
      )}

      {current === 'saved' && (
        <section className="review-step" aria-labelledby="rs-saved">
          <h2 id="rs-saved">Saved items</h2>
          <p className="quiet">What should happen with these?</p>
          {sortCards.map(m => (
            <SortCard key={m.id} material={m} workspace={workspace} date={date} today={today} />
          ))}
          <StepFoot
            onBack={() => go(-1)}
            onNext={async () => {
              // Skipping delays only the cards shown tonight, by three days (addendum G-2).
              if (undecided.length) await run({ type: 'skip-material-review', materialIds: undecided.map(m => m.id), date }, null)
              go(1)
            }}
            nextLabel={undecided.length ? 'Skip for now' : 'Next'}
          />
        </section>
      )}

      {current === 'capture' && (
        <section className="review-step" aria-labelledby="rs-capture">
          <h2 id="rs-capture">Anything new?</h2>
          <p className="quiet">Tasks, changes or links. Dictation works well here.</p>
          <CaptureBar page={page} placeholder="e.g. “Call the bank tomorrow”, “Tax return is done”" />
          <CaptureReceipts page={page} workspace={workspace} />
          <StepFoot onBack={() => go(-1)} onNext={() => go(1)} />
        </section>
      )}

      {current === 'reflect' && (
        <section className="review-step" aria-labelledby="rs-reflect">
          <h2 id="rs-reflect">One line about today</h2>
          <label className="quiet" htmlFor="reflection">What changed today? (optional, never turned into tasks)</label>
          <textarea id="reflection" rows={3} value={reflection} onChange={e => update({ reflection: e.target.value })} />
          <StepFoot
            onBack={() => go(-1)}
            onNext={async () => {
              await saveReview(true)
              go(1)
            }}
            nextLabel="Save and continue"
          />
        </section>
      )}

      {current === 'tomorrow' && <TomorrowStep date={date} workspace={workspace} p={p} update={update} />}
    </div>
  )
}

function StepFoot({ onBack, onNext, nextLabel = 'Next', extra }: { onBack?: () => void; onNext: () => void; nextLabel?: string; extra?: React.ReactNode }) {
  return (
    <footer className="step-foot">
      {onBack ? <button type="button" className="ghost" onClick={onBack}>Back</button> : <span />}
      {extra}
      <button type="button" className="primary" onClick={onNext}>{nextLabel}</button>
    </footer>
  )
}

/** B28: the review's task lists in outline order (a sub-task under its parent, or "↳ parent" when it's elsewhere). */
function TaskTree({ tasks, children }: { tasks: readonly Task[]; children: (task: Task, depth: number, parentId: string | null) => React.ReactNode }) {
  const rows = useTaskTree(tasks, reviewTaskId)
  return <>{rows.map(({ item, depth, outsideParent }) => children(item, depth, outsideParent))}</>
}
const reviewTaskId = (t: Task) => t.id

function PlanCard({ task, date, today, depth = 0, parentId = null, acted, onActed }: { task: Task; date: LocalDate; today: LocalDate; depth?: number; parentId?: string | null; acted?: string; onActed: (label: string) => void }) {
  const { markDone, planOn, notToday } = useTaskActions(today)
  const act = async (label: string, fn: () => Promise<unknown>) => {
    if (await fn()) onActed(label)
  }
  return (
    <div className={`app-card plan-card ${acted ? 'acted' : ''}`} {...treeIndent(depth)}>
      <ParentLine parentId={parentId} />
      <p className="plan-title">
        {task.title} <span className="app-tag">{taskDateTag(task, today, date)}</span>
      </p>
      {acted ? (
        <p className="ok">{acted}</p>
      ) : (
        <div className="plan-actions">
          <button type="button" className="secondary" onClick={() => act('Done', () => markDone(task))}>Done</button>
          <button type="button" className="secondary" onClick={() => act(`Moved to ${shortLabel(addDays(date, 1))}`, () => planOn(task, addDays(date, 1), undefined, date))}>Tomorrow</button>
          <button type="button" className="ghost" onClick={() => act('Not today', () => notToday(task, date))}>Not today</button>
          <RowMenu label={`Another day for ${task.title}`} groups={[{ title: 'Another day', items: anotherDayItems(task, today, (t, d) => act(`Moved to ${shortLabel(d)}`, () => planOn(t, d, undefined, date))) }]} />
        </div>
      )}
    </div>
  )
}

/** Addendum G-2: three one-tap choices; Make it a task and Pick a date sit in ⋯ to fit one phone screen. */
function SortCard({ material, workspace, date, today }: { material: Material; workspace: Workspace; date: LocalDate; today: LocalDate }) {
  const { run } = useWorkspace()
  const navigate = useNavigate()
  const linkPage = linkPageOf(workspace, material)
  const source = material.sources[0]
  const sourceDay = source ? workspace.pages.find(p => p.id === source.pageId)?.date : undefined
  const decide = (decision: 'watching' | 'lower' | 'done' | 'task', text: string, nextReviewOn?: LocalDate) =>
    run({ type: 'review-material', materialId: material.id, decision, date, nextReviewOn }, r => ({ text, undoOperationId: r.operationId }))

  return (
    <div className="app-card sort-card">
      <p className="sort-title">
        {linkPage ? <>
          {/* A2 §6: a link page's title, and tapping it opens the page; ↗ opens the site. */}
          <a href={`/pages?page=${encodeURIComponent(linkPage.id)}`} onClick={e => { e.preventDefault(); void run({ type: 'open-material', materialId: material.id, date }, null); void navigate({ to: '/pages', search: { page: linkPage.id } }) }}>
            {displayPageTitle(linkPage)}
          </a>
          <a className="sort-open-site" href={material.url} target="_blank" rel="noreferrer" aria-label="Open website" title={material.url}><ExternalIcon /></a>
        </> : <a href={material.url} target="_blank" rel="noreferrer" onClick={() => void run({ type: 'open-material', materialId: material.id, date }, null)}>
          {displayTitle(material.title, material.url)}
        </a>}
      </p>
      <p className="quiet">
        Saved {sourceDay ? weekday(sourceDay) : shortLabel(material.savedOn)} in Good Stuffs
        {source?.note && <> · “{source.note}”</>}
      </p>
      {material.lastDecisionOn === date ? (
        <p className="ok">{decisionLabel(material)}</p>
      ) : (
      <div className="plan-actions">
        <button type="button" className="secondary" onClick={() => decide('watching', `Keep watching · back ${shortLabel(addDays(today, 7))}`)}>Keep watching</button>
        <button type="button" className="secondary" onClick={() => decide('lower', 'Lower priority')}>Lower priority</button>
        <button type="button" className="secondary" onClick={() => decide('done', 'Done with it')}>Done with it</button>
        <RowMenu
          label={`More for ${material.title}`}
          groups={[
            {
              items: [
                { label: 'Make it a task', onSelect: () => decide('task', 'Task created · Unscheduled') },
                {
                  label: 'Keep watching until…',
                  onSelect: () => {
                    const d = window.prompt('Bring it back on (YYYY-MM-DD)', addDays(today, 14))
                    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) void decide('watching', `Keep watching · back ${shortLabel(d)}`, d)
                  },
                },
              ],
            },
          ]}
        />
      </div>
      )}
    </div>
  )
}

function decisionLabel(m: Material): string {
  switch (m.reviewState) {
    case 'watching':
      return `Keep watching · back ${m.nextReviewOn ? shortLabel(m.nextReviewOn) : 'later'}`
    case 'lower':
      return 'Lower priority'
    case 'done':
      return 'Done with it'
    case 'task':
      return 'Task created · Unscheduled'
    default:
      return ''
  }
}

function TomorrowStep({ date, workspace, p, update }: { date: LocalDate; workspace: Workspace; p: Progress; update: (patch: Partial<Progress>) => void }) {
  const { run, simOutcome } = useWorkspace()
  const tomorrow = addDays(date, 1)
  const page = workspace.pages.find(x => x.type === 'daily' && x.date === tomorrow)
  const draft = page?.draft
  const reviewSaved = workspace.pages.find(x => x.type === 'daily' && x.date === date)?.reviewSaved
  // After a conflict: the latest draft with Brian's removals applied; new items are flagged and
  // removable, vanished ones are reported. The next Save stores exactly what is on screen.
  const allowed = (id: string) => !p.removedSuggestions.includes(id)
  const isNew = (id: string) => Boolean(p.kept && !p.kept.includes(id))
  const dropped = p.kept ? p.kept.filter(id => !draft?.taskIds.includes(id) && !draft?.materialIds.includes(id)).length : 0
  const suggestions = (draft?.taskIds ?? []).filter(allowed).map(id => workspace.tasks.find(t => t.id === id)).filter(t => t !== undefined)
  // Removed tasks and Related items share one list of ids; both are saved together (save-draft).
  const related = (draft?.materialIds ?? [])
    .filter(allowed)
    .map(id => workspace.materials.find(m => m.id === id))
    .filter(m => m !== undefined)
    .slice(0, 2)
  const plannedTomorrow = workspace.tasks.filter(t => t.plannedOn === tomorrow && t.status === 'open').length

  const draftFailed = Boolean(page?.draftError)
  const prepare = () => run({ type: 'generate-draft', date: tomorrow, outcome: simOutcome }, null)
  const [saveFailed, setSaveFailed] = useState(false)
  const save = async () => {
    const taskIds = suggestions.map(t => t!.id)
    const materialIds = related.map(m => m!.id)
    const receipt = await run({ type: 'save-draft', date: tomorrow, taskIds, materialIds }, null)
    setSaveFailed(!receipt)
    // On failure the workspace reloads; keep these choices and let Brian save again by hand.
    update(receipt ? { tomorrowSaved: true, kept: undefined } : { kept: [...taskIds, ...materialIds] })
  }

  return (
    <section className="review-step" aria-labelledby="rs-tomorrow">
      <h2 id="rs-tomorrow">Tomorrow · {longLabel(tomorrow)}</h2>
      {draftFailed && (
        <p className="warn-line" role="alert">
          {reviewSaved ? 'Review saved · ' : ''}Tomorrow’s suggestions couldn’t be prepared ·{' '}
          <button type="button" className="app-link" onClick={prepare}>Retry</button>
        </p>
      )}
      {!draft && !draftFailed && (
        <button type="button" className="primary wide" onClick={prepare}>
          Prepare tomorrow
        </button>
      )}
      {draft && !p.tomorrowSaved && (
        <>
          {draft.simulated && <p className="sim">Simulated suggestions · no model was called</p>}
          <p className="quiet">Suggestions for Top 3. Remove any you don’t want.</p>
          <TaskTree tasks={suggestions}>
            {(t, depth, parentId) => (
            <div key={t.id} className="app-card suggestion" {...treeIndent(depth)}>
              <span className="grow">
                <ParentLine parentId={parentId} />
                {t.title}
                {isNew(t.id) && <span className="app-tag quiet"> Updated on another device</span>}
              </span>
              <button type="button" className="ghost" aria-label={`Remove ${t.title}`} onClick={() => update({ removedSuggestions: [...p.removedSuggestions, t.id] })}>
                Remove
              </button>
            </div>
            )}
          </TaskTree>
          {related.length > 0 && <p className="quiet">Related for tomorrow</p>}
          {related.map(m => (
            <div key={m!.id} className="app-card suggestion">
              <span className="grow">
                {displayTitle(m!.title, m!.url)}
                {isNew(m!.id) && <span className="app-tag quiet"> Updated on another device</span>}
              </span>
              <button type="button" className="ghost" aria-label={`Remove ${m!.title}`} onClick={() => update({ removedSuggestions: [...p.removedSuggestions, m!.id] })}>
                Remove
              </button>
            </div>
          ))}
          {saveFailed && (
            <p className="warn-line" role="alert">
              Not saved — your choices are still here
              {dropped > 0 && ` · ${dropped} suggestion${dropped === 1 ? ' is' : 's are'} no longer offered and ${dropped === 1 ? 'was' : 'were'} left out`}
              . Check the list, then save again.
            </p>
          )}
          <button type="button" className="primary wide" onClick={save}>
            {saveFailed ? 'Retry' : 'Save for tomorrow'}
          </button>
        </>
      )}
      {p.tomorrowSaved && (
        <div className="done-state">
          <p className="ok">
            Tomorrow: {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'} saved
            {plannedTomorrow > 0 && ` · ${plannedTomorrow} planned`}
          </p>
          <Link className="app-button secondary" to="/">Back to today</Link>
        </div>
      )}
    </section>
  )
}
