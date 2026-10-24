import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { LocalDate, Page, Task } from '../domain/types'
import { carrySection, getDayView } from '../domain/workspace'
import { addDays, longLabel, shortLabel, weekday } from './dates'
import { RowMenu } from './row-menu'
import { anotherDayItems, useTaskActions } from './task-row'
import { ParentLine, treeIndent, useTaskTree } from './task-tree'
import { newOperationId, useDay, useWorkspace } from './use-day'
import { cardLines, previousDailyPage } from './start-the-day'
import { TagText } from './tag-text'

/**
 * B31 (docs/design/review-one-screen.md): the evening review is one screen about the next day. Today's open tasks come
 * along unless he ticks or moves them; lines he types go on the next day's page as to-dos; Done is the morning card's
 * hand-off done the night before, so there is one place to plan the next day.
 */

/** A line typed for the next day that isn't on its page yet. Kept in storage so a reload or a lost connection keeps it. */
interface PendingLine {
  key: string
  title: string
  /** One operation id per line: a retry after a lost response replays the same add, never a second task. */
  operationId: string
  failed: boolean
}

function useStored<T>(key: string, blank: T): [T | null, (next: T | ((prev: T) => T)) => void] {
  // null until read from storage, so a resumed review never flashes its blank state.
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    const raw = localStorage.getItem(key)
    setValue(raw ? (JSON.parse(raw) as T) : blank)
    // `blank` is a constant per call site.
  }, [key])
  const update = useCallback(
    (next: T | ((prev: T) => T)) =>
      setValue(prev => {
        const value = typeof next === 'function' ? (next as (p: T) => T)(prev ?? blank) : next
        localStorage.setItem(key, JSON.stringify(value))
        return value
      }),
    [key],
  )
  return [value, update]
}

const noLines: PendingLine[] = []
const noActs: Record<string, string> = {}

/** "Today", "Tomorrow" or the weekday, said from the clock, not from the reviewed day (after midnight it's today). */
function dayWord(day: LocalDate, today: LocalDate): string {
  if (day === today) return 'Today'
  if (day === addDays(today, 1)) return 'Tomorrow'
  return weekday(day)
}

const dayName = (day: LocalDate) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })

export function ReviewFlow({ date, today, fromReminder }: { date: LocalDate; today: LocalDate; fromReminder: boolean }) {
  const { run, latest } = useWorkspace()
  const navigate = useNavigate()
  const next = addDays(date, 1)
  const { view, workspace } = useDay(date)
  const { view: nextView } = useDay(next)
  const [lines, setLines] = useStored<PendingLine[]>(`daythread.review-lines.${date}`, noLines)
  const [acted, setActed] = useStored<Record<string, string>>(`daythread.review-acted.${date}`, noActs)
  // The rows that come along are fixed when the screen opens, so a ticked or moved row stays in place and says so.
  const [comingIds, setComingIds] = useState<string[] | null>(null)
  const [draft, setDraft] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const composing = useRef(false)
  const page = view?.page ?? null
  const nextPage = nextView?.page ?? null
  const planAhead = next >= today
  const handedOff = Boolean(nextPage?.handoffDone)

  // Where the review was opened from (04 counts "opened from the reminder").
  const recorded = page?.reviewSource !== undefined
  useEffect(() => {
    if (page && !recorded) void run({ type: 'review-progress', date, step: 1, source: fromReminder ? 'reminder' : 'direct' }, null)
  }, [page, recorded, fromReminder, date, run])

  useEffect(() => {
    if (comingIds === null && nextView && workspace) {
      // In the order he sees them on the reviewed page: Top 3 first, then Other, top to bottom.
      const onPage = (page?.sections ?? []).filter(s => s.kind === 'top3' || s.kind === 'other').flatMap(s => s.blocks.map(b => b.taskId))
      const at = (id: string) => (onPage.indexOf(id) + 1 || Infinity)
      setComingIds(handedOff || !planAhead ? [] : nextView.handoffTasks.map(t => t.id).sort((a, b) => at(a) - at(b)))
    }
  }, [comingIds, nextView, workspace, handedOff, planAhead, page])

  /** The next day's page, made from the template the first time a line needs it. */
  const ensureNextPage = useCallback(async (): Promise<Page | null> => {
    const find = () => latest()?.pages.find(p => p.type === 'daily' && p.date === next) ?? null
    if (find()) return find()
    const receipt = await run({ type: 'ensure-day', date: next }, null, undefined, { quiet: true })
    return receipt ? find() : null
  }, [latest, next, run])

  const saveLine = useCallback(
    async (line: PendingLine): Promise<boolean> => {
      setLines(all => all.map(l => (l.key === line.key ? { ...l, failed: false } : l)))
      const target = await ensureNextPage()
      const section = target?.sections.find(s => s.kind === 'other') ?? target?.sections.find(s => s.kind === 'top3')
      const receipt =
        target && section
          ? await run({ type: 'add-task', pageId: target.id, sectionId: section.id, title: line.title, plannedOn: next }, null, line.operationId, { quiet: true })
          : null
      setLines(all => (receipt ? all.filter(l => l.key !== line.key) : all.map(l => (l.key === line.key ? { ...l, failed: true } : l))))
      return Boolean(receipt)
    },
    [ensureNextPage, next, run, setLines],
  )

  // B35's way: a line that didn't save is tried again when the connection comes back or the screen is shown again,
  // and once when the review opens (a line left from a reload). The same operation id makes a repeat harmless.
  const linesRef = useRef(lines)
  linesRef.current = lines
  const retryAll = useCallback(() => {
    for (const line of linesRef.current ?? []) void saveLine(line)
  }, [saveLine])
  const retriedOnOpen = useRef(false)
  useEffect(() => {
    if (!workspace || lines === null || retriedOnOpen.current) return
    retriedOnOpen.current = true
    retryAll()
  }, [workspace, lines, retryAll])
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && retryAll()
    window.addEventListener('online', retryAll)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', retryAll)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [retryAll])

  if (!view || !nextView || !workspace || lines === null || acted === null || comingIds === null) return <p className="loading">Loading…</p>
  if (!page) return <p className="empty">There’s no page for {longLabel(date)} to review.</p>

  const addLine = (title: string) => {
    const line: PendingLine = { key: newOperationId(), title, operationId: newOperationId(), failed: false }
    setLines(all => [...all, line])
    void saveLine(line)
  }

  const reviewed = workspace.tasks.filter(t => t.plannedOn === date && t.status !== 'cancelled')
  const doneCount = reviewed.filter(t => t.status === 'done').length
  const openCount = reviewed.length - doneCount
  const prevPage = previousDailyPage(workspace, next)
  const coming = comingIds.map(id => workspace.tasks.find(t => t.id === id)).filter((t): t is Task => t !== undefined)
  const stillComing = (t: Task) => nextView.handoffTasks.some(h => h.id === t.id)
  const shown = new Set(comingIds)
  const onNext = nextPage
    ? nextPage.sections
        .filter(s => s.kind === 'top3' || s.kind === 'other')
        .flatMap(s => s.blocks.filter(b => b.taskId && !shown.has(b.taskId)).map(b => ({ block: b, top3: s.kind === 'top3' })))
        .map(r => ({ ...r, task: workspace.tasks.find(t => t.id === r.block.taskId) }))
        .filter((r): r is typeof r & { task: Task } => Boolean(r.task) && r.task!.status !== 'cancelled' && r.task!.title.trim() !== '')
    : []

  const finish = async () => {
    if (finishing) return
    setFinishing(true)
    setFinishError(null)
    try {
      // Done never drops a line: the one still in the box is added first, and every line must be on the page.
      const typed = draft.trim()
      if (typed) {
        setDraft('')
        addLine(typed)
      }
      await new Promise(r => setTimeout(r, 0))
      const pending = linesRef.current ?? []
      const saved = await Promise.all(pending.map(saveLine))
      const unsaved = saved.filter(ok => !ok).length
      if (unsaved) {
        setFinishError(`${unsaved} line${unsaved === 1 ? '' : 's'} not saved yet`)
        return
      }
      if (planAhead && !handedOff) {
        // The morning card's Add all: each row to the section it had, in outline order, so nesting and Top 3 hold.
        const ws = latest()!
        const handoff = new Set(getDayView(ws, next).handoffTasks.map(t => t.id))
        const items = comingIds
          .map(id => ws.tasks.find(t => t.id === id))
          .filter((t): t is Task => t !== undefined && t.status === 'open')
          .filter(t => handoff.has(t.id))
          .map(t => ({ taskId: t.id, section: carrySection(previousDailyPage(ws, next), t.id) }))
        if (items.length) {
          if (!(await ensureNextPage()) || !(await run({ type: 'plan-tasks', date: next, items }, null))) {
            setFinishError('Couldn’t set up the day')
            return
          }
        }
        // Lines from the day's Notes are still offered by the morning card; Done closes it only when nothing is left.
        const after = latest()!
        if (!cardLines(getDayView(after, next), after).length && !(await run({ type: 'handoff-done', date: next }, null))) {
          setFinishError('Couldn’t set up the day')
          return
        }
      }
      const total = (latest()?.tasks ?? []).filter(t => t.plannedOn === next && t.status === 'open' && t.title.trim()).length
      const set = planAhead ? `${dayName(next)} is set · ${total} to-do${total === 1 ? '' : 's'}` : 'Review saved'
      if (!(await run({ type: 'save-review', date, text: page.reviewText ?? '', finish: true }, { text: set }))) {
        setFinishError('Review not saved')
        return
      }
      localStorage.removeItem(`daythread.review-acted.${date}`)
      void navigate({ to: '/' })
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="review review-one">
      <header className="review-one-head">
        <h1>
          {dayWord(next, today)} · {longLabel(next)}
        </h1>
        <button type="button" className="app-link review-done" onClick={() => void finish()} disabled={finishing}>
          Done
        </button>
        <p className="quiet review-one-sub">
          {/* A day without tasks reads "nothing planned", not "0 done · 0 still open" (empty-start-states §2). */}
          {reviewed.length === 0
            ? `${dayName(date)}: nothing planned`
            : `${dayName(date)}: ${doneCount} done · ${openCount} still open`}
          {page.reviewSaved && ' · review saved'}
        </p>
        {finishError && (
          <p className="warn-line" role="alert">
            {finishError} ·{' '}
            <button type="button" className="app-link" onClick={() => void finish()}>
              Retry
            </button>
          </p>
        )}
      </header>

      {!planAhead ? (
        <p className="quiet">{dayName(next)} has passed, so nothing carries from here. Done saves the review.</p>
      ) : handedOff ? (
        <p className="quiet">{dayName(next)} is already set up. New lines still go on its page.</p>
      ) : (
        <section className="review-group" aria-labelledby="ro-coming">
          <h2 id="ro-coming">Comes along {dayWord(next, today).toLowerCase()}</h2>
          {coming.length === 0 ? (
            <p className="quiet review-empty">Nothing comes along from {dayName(date)}.</p>
          ) : (
            <>
              <div className="review-list">
                <ComingTree tasks={coming}>
                  {(t, depth, parentId) => (
                    <ComingRow
                      key={t.id}
                      task={t}
                      date={date}
                      next={next}
                      today={today}
                      depth={depth}
                      parentId={parentId}
                      top3={carrySection(prevPage, t.id) === 'top3'}
                      label={t.status === 'done' ? undefined : stillComing(t) ? undefined : acted[t.id] ?? 'Not coming along'}
                      onActed={label => setActed(a => ({ ...a, [t.id]: label }))}
                    />
                  )}
                </ComingTree>
              </div>
              <p className="quiet review-hint">Tick what you finished. ⋯ moves a task to another day.</p>
            </>
          )}
        </section>
      )}

      {planAhead && (
        <section className="review-group" aria-labelledby="ro-add">
          <h2 id="ro-add">{handedOff ? `On ${dayName(next)}` : `Add for ${dayWord(next, today).toLowerCase()}`}</h2>
          <div className="review-list">
            {onNext.map(({ task, block, top3 }) => (
              <NextRow key={block.id} task={task} blockId={block.id} pageId={nextPage!.id} next={next} today={today} top3={top3} />
            ))}
            {lines.map(line => (
              <div key={line.key} className="task-row plan review-pending">
                <input type="checkbox" className="check" disabled aria-label={`${line.title} is not saved yet`} />
                <span className="task-title">{line.title}</span>
                {line.failed ? (
                  <span className="review-line-state warn">
                    Not added ·{' '}
                    <button type="button" className="app-link" onClick={() => void saveLine(line)}>
                      Retry
                    </button>
                  </span>
                ) : (
                  <span className="review-line-state quiet">Adding…</span>
                )}
              </div>
            ))}
            <div className="task-row plan review-new">
              <span className="check review-new-box" aria-hidden="true" />
              {/* A plain input, not the page editor: Return while a pinyin candidate is open confirms it (B49). */}
              <input
                className="task-title review-new-input"
                value={draft}
                placeholder="New line"
                aria-label={`Add a to-do for ${dayName(next)}`}
                enterKeyHint="enter"
                onChange={e => setDraft(e.target.value)}
                onCompositionStart={() => (composing.current = true)}
                onCompositionEnd={() => {
                  // WebKit sends the Return that confirms a candidate after compositionend; let that one pass.
                  setTimeout(() => (composing.current = false), 0)
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) return
                  e.preventDefault()
                  const title = draft.trim()
                  if (!title) return
                  setDraft('')
                  addLine(title)
                }}
              />
            </div>
          </div>
          <p className="quiet review-hint">Each line goes on {dayName(next)}’s page as a to-do. Return adds the next one.</p>
        </section>
      )}
    </div>
  )
}

function ComingTree({ tasks, children }: { tasks: readonly Task[]; children: (task: Task, depth: number, parentId: string | null) => React.ReactNode }) {
  const rows = useTaskTree(tasks, taskId)
  return <>{rows.map(({ item, depth, outsideParent }) => children(item, depth, outsideParent))}</>
}
const taskId = (t: Task) => t.id

function ComingRow({ task, date, next, today, depth, parentId, top3, label, onActed }: { task: Task; date: LocalDate; next: LocalDate; today: LocalDate; depth: number; parentId: string | null; top3: boolean; label?: string; onActed: (label: string) => void }) {
  const { markDone, planOn, notToday } = useTaskActions(today)
  const done = task.status === 'done'
  const act = async (text: string, fn: () => Promise<unknown>) => {
    if (await fn()) onActed(text)
  }
  return (
    <div className={`task-row plan ${done ? 'is-done' : ''} ${label ? 'is-moved' : ''}`} data-task-id={task.id} {...treeIndent(depth)}>
      <input type="checkbox" className="check" checked={done} disabled={Boolean(label)} aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`} onChange={() => void markDone(task)} />
      <span className="task-title">
        <ParentLine parentId={parentId} />
        <TagText text={task.title} />
      </span>
      {label ? <span className="app-tag quiet">{label}</span> : top3 && !done ? <span className="app-tag section-tag">Top 3</span> : null}
      {!done && !label && (
        <RowMenu
          label={`Actions for ${task.title}`}
          groups={[
            { title: 'Another day', items: anotherDayItems(task, today, (t, d) => act(`Moved to ${shortLabel(d)}`, () => planOn(t, d, undefined, date))).filter(i => !i.label.endsWith(shortLabel(next))) },
            { items: [{ label: `Not ${dayWord(next, today).toLowerCase()}`, onSelect: () => act('Not coming along', () => notToday(task, date)) }] },
          ]}
        />
      )}
    </div>
  )
}

function NextRow({ task, blockId, pageId, next, today, top3 }: { task: Task; blockId: string; pageId: string; next: LocalDate; today: LocalDate; top3: boolean }) {
  const { run } = useWorkspace()
  const { markDone, planOn } = useTaskActions(today)
  const done = task.status === 'done'
  return (
    <div className={`task-row plan ${done ? 'is-done' : ''}`} data-task-id={task.id}>
      <input type="checkbox" className="check" checked={done} aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`} onChange={() => void markDone(task)} />
      <span className="task-title">
        <TagText text={task.title} />
      </span>
      {top3 && !done && <span className="app-tag section-tag">Top 3</span>}
      <RowMenu
        label={`Actions for ${task.title}`}
        groups={[
          {
            items: [
              top3 ? { label: 'Move to Other', onSelect: () => planOn(task, next, 'other') } : { label: 'Make it Top 3', onSelect: () => planOn(task, next, 'top3') },
              // B33: removing the line deletes a task born there (with Undo), and a task with history leaves the day.
              { label: `Remove from ${dayName(next)}`, danger: true, onSelect: () => run({ type: 'remove-blocks', pageId, blockIds: [blockId], bulk: false, today }, r => ({ text: 'Removed', undoOperationId: r.operationId })) },
            ],
          },
        ]}
      />
    </div>
  )
}
