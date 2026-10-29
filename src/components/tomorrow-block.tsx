import { useCallback, useEffect, useRef, useState } from 'react'
import type { DayView, LocalDate, Page, Task, Workspace } from '../domain/types'
import { getDayView } from '../domain/workspace'
import { addDays, longLabel, weekday } from './dates'
import { RowMenu } from './row-menu'
import { TagText } from './tag-text'
import { newOperationId, useWorkspace } from './use-day'

/**
 * The review on the page (docs/design/review-on-the-page.md): a Tomorrow block at the bottom of today's page. Lines he
 * types become to-dos on tomorrow's page at once; what is left open comes along in the morning, as the morning card
 * does. No screen, no Done. The line-saving rules are B31's: a plain input (Return while a pinyin candidate is open
 * confirms it, B49), one operation id per line, an unsaved line stays with Retry and survives a reload.
 *
 * B68 (task #227): nothing typed here vanishes. Unsaved lines are kept under one key for every day, each with the date
 * it was meant for, so a line still unsaved at midnight shows in the next day's block and saves to the later of its
 * date and today. The input itself is kept as he types and becomes a line when he leaves it, never mid-pinyin.
 */

interface PendingLine {
  key: string
  title: string
  /** One operation id per line: a retry after a lost response replays the same add, never a second task. */
  operationId: string
  failed: boolean
  /** The day the line is for, and the day it was typed on. */
  date: LocalDate
  typedOn: LocalDate
}

const linesKey = 'daythread.tomorrow-lines'
const draftKey = 'daythread.tomorrow-draft'
/** Before B68 a day's unsaved lines lived under its own key and were never read again after midnight. */
const legacyPrefix = 'daythread.review-lines.'

function readLines(): PendingLine[] {
  try {
    const raw = localStorage.getItem(linesKey)
    return raw ? (JSON.parse(raw) as PendingLine[]) : []
  } catch {
    return []
  }
}

/** Moves lines left under the old per-day keys into the shared list, once per device. */
function adoptLegacyLines(): void {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(legacyPrefix))
  if (!keys.length) return
  const lines = readLines()
  const known = new Set(lines.map(l => l.operationId))
  for (const key of keys) {
    const day = key.slice(legacyPrefix.length)
    let old: unknown
    try {
      old = JSON.parse(localStorage.getItem(key) ?? '[]')
    } catch {
      old = []
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Array.isArray(old)) {
      for (const l of old as Partial<PendingLine>[]) {
        if (typeof l?.title !== 'string' || !l.title.trim() || typeof l.operationId !== 'string' || known.has(l.operationId)) continue
        known.add(l.operationId)
        lines.push({ key: l.key ?? newOperationId(), title: l.title, operationId: l.operationId, failed: true, date: addDays(day, 1), typedOn: day })
      }
    }
  }
  localStorage.setItem(linesKey, JSON.stringify(lines))
  for (const key of keys) localStorage.removeItem(key)
}

/**
 * The unsaved lines, written to storage synchronously on every change: a line added as the page is hidden is kept
 * even if the page is frozen before React renders again. Each change starts from what storage holds, so two tabs
 * don't drop each other's lines.
 */
function usePendingLines(): [PendingLine[] | null, (change: (all: PendingLine[]) => PendingLine[]) => void, () => PendingLine[]] {
  // null until read from storage, so a resumed block never flashes its blank state.
  const [value, setValue] = useState<PendingLine[] | null>(null)
  useEffect(() => {
    adoptLegacyLines()
    setValue(readLines())
    const onStorage = (e: StorageEvent) => e.key === linesKey && setValue(readLines())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const update = useCallback((change: (all: PendingLine[]) => PendingLine[]) => {
    const next = change(readLines())
    localStorage.setItem(linesKey, JSON.stringify(next))
    setValue(next)
  }, [])
  return [value, update, readLines]
}

/** "From last night" for a line typed yesterday, else the weekday it was typed. */
function carriedLabel(typedOn: LocalDate, today: LocalDate): string {
  return typedOn === addDays(today, -1) ? 'From last night' : `From ${weekday(typedOn)}`
}

/** A replay the server refuses because the add already happened under this operation id (its date moved since). */
const alreadyAdded = /Operation identity reused with different input|already applied/

export function TomorrowBlock({ today, view, workspace }: { today: LocalDate; view: DayView; workspace: Workspace }) {
  const { run, latest } = useWorkspace()
  const next = addDays(today, 1)
  const nextView = getDayView(workspace, next)
  const nextPage = nextView.page ?? null
  const [lines, setLines, currentLines] = usePendingLines()
  const [draft, setDraftState] = useState('')
  const draftRef = useRef('')
  const setDraft = useCallback((text: string) => {
    draftRef.current = text
    if (text) localStorage.setItem(draftKey, text)
    else localStorage.removeItem(draftKey)
    setDraftState(text)
  }, [])
  // A draft left by a reload or a closed app goes back in the input, not into the list: he never confirmed it.
  useEffect(() => {
    const kept = localStorage.getItem(draftKey)
    if (kept) setDraft(kept)
  }, [setDraft])
  const composing = useRef(false)

  /** A day's page, made from the template the first time a line needs it; lines saved together share one call. */
  const creating = useRef(new Map<LocalDate, Promise<Page | null>>())
  const ensurePage = useCallback(
    (date: LocalDate): Promise<Page | null> => {
      const find = () => latest()?.pages.find(p => p.type === 'daily' && p.date === date) ?? null
      if (find()) return Promise.resolve(find())
      let job = creating.current.get(date)
      if (!job) {
        job = run({ type: 'ensure-day', date }, null, undefined, { quiet: true })
          .then(receipt => (receipt ? find() : null))
          .finally(() => creating.current.delete(date))
        creating.current.set(date, job)
      }
      return job
    },
    [latest, run],
  )

  // One save per line at a time: Return and a retry on reconnect wait on the save already running.
  const saving = useRef(new Map<string, Promise<boolean>>())
  const saveLine = useCallback(
    (line: PendingLine): Promise<boolean> => {
      const running = saving.current.get(line.key)
      if (running) return running
      const job = (async () => {
        setLines(all => all.map(l => (l.key === line.key ? { ...l, failed: false } : l)))
        // Never onto a past page: a line still unsaved after its day goes to today's.
        const date = line.date > today ? line.date : today
        let landedBefore = false
        const target = await ensurePage(date)
        const receipt = target
          ? await run({ type: 'add-task', pageId: target.id, title: line.title, plannedOn: date }, null, line.operationId, {
              quiet: true,
              inlineRefusal: alreadyAdded,
              onRefused: () => (landedBefore = true),
            })
          : null
        const saved = Boolean(receipt) || landedBefore
        setLines(all => (saved ? all.filter(l => l.key !== line.key) : all.map(l => (l.key === line.key ? { ...l, failed: true } : l))))
        // The day's record says he planned the next day from this page; nothing else reads the flag.
        const typedPage = latest()?.pages.find(p => p.type === 'daily' && p.date === line.typedOn)
        if (receipt && typedPage && !typedPage.reviewSaved) void run({ type: 'save-review', date: line.typedOn }, null, undefined, { quiet: true })
        return saved
      })().finally(() => saving.current.delete(line.key))
      saving.current.set(line.key, job)
      return job
    },
    [ensurePage, latest, run, setLines, today],
  )

  // B35's way: a line that didn't save is tried again when the connection comes back or the page is shown again,
  // and once when the block mounts (a line left from a reload or an earlier day). The same operation id makes a
  // repeat harmless.
  const retryAll = useCallback(() => {
    for (const line of currentLines()) void saveLine(line)
  }, [currentLines, saveLine])
  const retriedOnOpen = useRef(false)
  useEffect(() => {
    if (lines === null || retriedOnOpen.current) return
    retriedOnOpen.current = true
    retryAll()
  }, [lines, retryAll])

  const addLine = useCallback(
    (title: string) => {
      const line: PendingLine = { key: newOperationId(), title, operationId: newOperationId(), failed: false, date: next, typedOn: today }
      setLines(all => [...all, line])
      void saveLine(line)
    },
    [next, saveLine, setLines, today],
  )
  /** The input becomes a line: on Return, when he leaves it, and when the page is hidden. Never mid-pinyin. */
  const commitDraft = useCallback(() => {
    if (composing.current) return
    const title = draftRef.current.trim()
    if (!title) return
    setDraft('')
    addLine(title)
  }, [addLine, setDraft])

  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && retryAll()
    window.addEventListener('online', retryAll)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pagehide', commitDraft)
    return () => {
      window.removeEventListener('online', retryAll)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('pagehide', commitDraft)
    }
  }, [commitDraft, retryAll])

  if (lines === null) return null

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
                {line.typedOn < today && `${carriedLabel(line.typedOn, today)} · `}Not added ·{' '}
                <button type="button" className="app-link" onClick={() => void saveLine(line)}>
                  Retry
                </button>
              </span>
            ) : (
              <span className="tomorrow-line-state quiet">{line.typedOn < today && `${carriedLabel(line.typedOn, today)} · `}Adding…</span>
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
            onBlur={commitDraft}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) return
              e.preventDefault()
              commitDraft()
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
