import { useCallback, useEffect, useRef, useState } from 'react'
import type { DayView, LocalDate, Page, Task, Workspace } from '../domain/types'
import { getDayView } from '../domain/workspace'
import { addDays, longLabel } from './dates'
import { RowMenu } from './row-menu'
import { TagText } from './tag-text'
import { newOperationId, useWorkspace } from './use-day'

/**
 * The review on the page (docs/design/review-on-the-page.md): a Tomorrow block at the bottom of today's page. Lines he
 * types become to-dos on tomorrow's page at once; what is left open comes along in the morning, as the morning card
 * does. No screen, no Done. The line-saving rules are B31's: a plain input (Return while a pinyin candidate is open
 * confirms it, B49), one operation id per line, an unsaved line stays with Retry and survives a reload.
 */

interface PendingLine {
  key: string
  title: string
  /** One operation id per line: a retry after a lost response replays the same add, never a second task. */
  operationId: string
  failed: boolean
}

function useStored<T>(key: string, blank: T): [T | null, (next: T | ((prev: T) => T)) => void] {
  // null until read from storage, so a resumed block never flashes its blank state.
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

export function TomorrowBlock({ today, view, workspace }: { today: LocalDate; view: DayView; workspace: Workspace }) {
  const { run, latest } = useWorkspace()
  const next = addDays(today, 1)
  const nextView = getDayView(workspace, next)
  const nextPage = nextView.page ?? null
  // The same key B31's review used for this day, so a line left unsaved there is still here.
  const [lines, setLines] = useStored<PendingLine[]>(`daythread.review-lines.${today}`, noLines)
  const [draft, setDraft] = useState('')
  const composing = useRef(false)

  /** Tomorrow's page, made from the template the first time a line needs it; lines typed together share one call. */
  const creating = useRef<Promise<Page | null> | null>(null)
  const ensureNextPage = useCallback((): Promise<Page | null> => {
    const find = () => latest()?.pages.find(p => p.type === 'daily' && p.date === next) ?? null
    if (find()) return Promise.resolve(find())
    creating.current ??= run({ type: 'ensure-day', date: next }, null, undefined, { quiet: true })
      .then(receipt => (receipt ? find() : null))
      .finally(() => (creating.current = null))
    return creating.current
  }, [latest, next, run])

  // One save per line at a time: Return and a retry on reconnect wait on the save already running.
  const saving = useRef(new Map<string, Promise<boolean>>())
  const saveLine = useCallback(
    (line: PendingLine): Promise<boolean> => {
      const running = saving.current.get(line.key)
      if (running) return running
      const job = (async () => {
        setLines(all => all.map(l => (l.key === line.key ? { ...l, failed: false } : l)))
        const target = await ensureNextPage()
        const receipt = target ? await run({ type: 'add-task', pageId: target.id, title: line.title, plannedOn: next }, null, line.operationId, { quiet: true }) : null
        setLines(all => (receipt ? all.filter(l => l.key !== line.key) : all.map(l => (l.key === line.key ? { ...l, failed: true } : l))))
        // The day's record says he planned the next day from this page; nothing else reads the flag.
        const todayPage = latest()?.pages.find(p => p.type === 'daily' && p.date === today)
        if (receipt && todayPage && !todayPage.reviewSaved) void run({ type: 'save-review', date: today }, null, undefined, { quiet: true })
        return Boolean(receipt)
      })().finally(() => saving.current.delete(line.key))
      saving.current.set(line.key, job)
      return job
    },
    [ensureNextPage, latest, next, run, setLines, today],
  )

  // B35's way: a line that didn't save is tried again when the connection comes back or the page is shown again,
  // and once when the block mounts (a line left from a reload). The same operation id makes a repeat harmless.
  const linesRef = useRef(lines)
  linesRef.current = lines
  const retryAll = useCallback(() => {
    for (const line of linesRef.current ?? []) void saveLine(line)
  }, [saveLine])
  const retriedOnOpen = useRef(false)
  useEffect(() => {
    if (lines === null || retriedOnOpen.current) return
    retriedOnOpen.current = true
    retryAll()
  }, [lines, retryAll])
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && retryAll()
    window.addEventListener('online', retryAll)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', retryAll)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [retryAll])

  if (lines === null) return null

  const addLine = (title: string) => {
    const line: PendingLine = { key: newOperationId(), title, operationId: newOperationId(), failed: false }
    setLines(all => [...all, line])
    void saveLine(line)
  }

  const onNext = nextPage ? nextView.dayTasks.filter(t => t.status !== 'cancelled' && t.title.trim() !== '') : []
  const openToday = view.dayTasks.filter(t => t.status === 'open' && t.title.trim() !== '' && !t.paused).length

  return (
    <section className="tomorrow" aria-labelledby="tomorrow-title">
      <h2 id="tomorrow-title" className="tomorrow-title">
        Tomorrow <span>· {longLabel(next)}</span>
      </h2>
      <div className="tomorrow-list">
        {onNext.map(task => (
          <TomorrowRow key={task.id} task={task} pageId={nextPage!.id} today={today} />
        ))}
        {lines.map(line => (
          <div key={line.key} className="task-row plan tomorrow-pending">
            <span className="check tomorrow-box" aria-hidden="true" />
            <span className="task-title">{line.title}</span>
            {line.failed ? (
              <span className="tomorrow-line-state warn">
                Not added ·{' '}
                <button type="button" className="app-link" onClick={() => void saveLine(line)}>
                  Retry
                </button>
              </span>
            ) : (
              <span className="tomorrow-line-state quiet">Adding…</span>
            )}
          </div>
        ))}
        <div className="task-row plan tomorrow-new">
          <span className="check tomorrow-box tomorrow-new-box" aria-hidden="true" />
          {/* A plain input, not the page editor: Return while a pinyin candidate is open confirms it (B49). */}
          <input
            className="task-title tomorrow-new-input"
            value={draft}
            placeholder="Add for tomorrow"
            aria-label="Add a to-do for tomorrow"
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
      {openToday > 0 && (
        <p className="tomorrow-hint">
          {openToday} unfinished to-do{openToday === 1 ? '' : 's'} come{openToday === 1 ? 's' : ''} along in the morning.
        </p>
      )}
    </section>
  )
}

function TomorrowRow({ task, pageId, today }: { task: Task; pageId: string; today: LocalDate }) {
  const { run } = useWorkspace()
  return (
    <div className={`task-row plan tomorrow-row ${task.status === 'done' ? 'is-done' : ''}`} data-task-id={task.id}>
      <span className="check tomorrow-box" aria-hidden="true" />
      <span className="task-title">
        <TagText text={task.title} />
      </span>
      <RowMenu
        label={`Actions for ${task.title}`}
        groups={[
          {
            items: [
              // Removing the row deletes a task born there (with Undo); a task with history leaves the day.
              { label: 'Remove from tomorrow', danger: true, onSelect: () => run({ type: 'remove-task-row', pageId, taskId: task.id, today }, r => ({ text: 'Removed', undoOperationId: r.operationId })) },
            ],
          },
        ]}
      />
    </div>
  )
}
