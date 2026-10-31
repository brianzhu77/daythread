import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalDate, Page, Receipt } from '../domain/types'
import { getDayView } from '../domain/workspace'
import { addDays } from './dates'
import { newOperationId, useWorkspace, workspaceOwner } from './use-day'

/**
 * B76 (Lead 718baab1): the Tomorrow block is gone; the day's draft reads his template's own "Tomorrow" section instead.
 * What stays is B68's promise that nothing typed there vanishes: lines still unsaved on this device (and a half-typed
 * input) are saved once, each as a to-do on the later of the day it was meant for and today (Bumblebee 0331a0c6), with
 * the same operation ids and lost-reply recovery as before. Nothing is shown; once the list is empty, this does nothing.
 *
 * Kept from the block (B68, task #227): unsaved lines live under one key per account, each with its date; a retry
 * after a lost response replays the same add, never a second task.
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
  /** Every add sent under the operation id. One may have landed with its reply lost; replaying it names the task. */
  sent?: AddSent[]
  /**
   * The plan-tasks that moves a recovered task to a day, one operation id per day, kept so a retry replays it. A move
   * that landed with its reply lost and is retried on a later day gets that day's own id, which moves it again.
   */
  moves?: Record<LocalDate, string>
}
interface AddSent { pageId: string; plannedOn: LocalDate }

/**
 * Unsaved lines and the draft exist only on this device, so they're kept under the account they belong to: another
 * account on the same browser never sees or sends them, and they're back when that account signs in again. Sign-out
 * leaves them (the server doesn't have them). With no known account, nothing is read or kept.
 */
const linesKey = (owner: string) => `daythread.tomorrow-lines.${owner}`
const draftKey = (owner: string) => `daythread.tomorrow-draft.${owner}`
/**
 * Before B68 a day's unsaved lines lived under its own key, for no account, and were never read again after midnight.
 * They can only come from builds before invites, when his was the one account, so the first account to open the block
 * after the update takes them, once (Lead's ruling on #227).
 */
const legacyPrefix = 'daythread.review-lines.'

function readLines(owner: string | null): PendingLine[] {
  if (!owner) return []
  try {
    const raw = localStorage.getItem(linesKey(owner))
    return raw ? (JSON.parse(raw) as PendingLine[]) : []
  } catch {
    return []
  }
}

/** Moves lines left under the old per-day keys to this account's list and deletes the old keys. */
function adoptLegacyLines(owner: string): void {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(legacyPrefix))
  if (!keys.length) return
  const lines = readLines(owner)
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
        // The old block sent its add to the next day's page, whose id is fixed (`day:<date>`).
        const date = addDays(day, 1)
        lines.push({ key: l.key ?? newOperationId(), title: l.title, operationId: l.operationId, failed: true, date, typedOn: day, sent: [{ pageId: `day:${date}`, plannedOn: date }] })
      }
    }
  }
  localStorage.setItem(linesKey(owner), JSON.stringify(lines))
  for (const key of keys) localStorage.removeItem(key)
}

/**
 * The unsaved lines, written to storage synchronously on every change: a line added as the page is hidden is kept
 * even if the page is frozen before React renders again. Each change starts from what storage holds, so two tabs
 * don't drop each other's lines. With no known account the lines live in memory only.
 */
function usePendingLines(owner: string | null): [PendingLine[] | null, (change: (all: PendingLine[]) => PendingLine[]) => void, () => PendingLine[]] {
  // null until read from storage, so a resumed block never flashes its blank state.
  const [value, setValue] = useState<PendingLine[] | null>(null)
  const memory = useRef<PendingLine[]>([])
  const current = useCallback(() => (owner ? readLines(owner) : memory.current), [owner])
  useEffect(() => {
    if (!owner) {
      setValue(memory.current)
      return
    }
    adoptLegacyLines(owner)
    setValue(readLines(owner))
    const onStorage = (e: StorageEvent) => e.key === linesKey(owner) && setValue(readLines(owner))
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [owner])
  const update = useCallback(
    (change: (all: PendingLine[]) => PendingLine[]) => {
      const next = change(current())
      if (owner) localStorage.setItem(linesKey(owner), JSON.stringify(next))
      else memory.current = next
      setValue(next)
    },
    [current, owner],
  )
  return [value, update, current]
}

/**
 * The server's refusal of an add whose operation id already holds a different add: one sent on an earlier day landed
 * and its reply was lost. Only this refusal is recovered; any other stays on Retry.
 */
const addedEarlier = /Operation identity reused with different input/

export function PendingTomorrowLines({ today }: { today: LocalDate }) {
  const { run, latest } = useWorkspace()
  // The account is known by the time the block shows: the workspace it renders came with it.
  const owner = workspaceOwner()
  const [lines, setLines, currentLines] = usePendingLines(owner)

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

  /**
   * An add sent on an earlier day landed but its reply was lost. Replaying the earlier adds under the same operation id
   * makes the server name the task it made (a replay never applies twice); the task is then planned for the line's day,
   * as the morning card does, so it ends up on today's page once. False keeps the line on Retry.
   */
  const recoverEarlierAdd = useCallback(
    async (key: string, date: LocalDate): Promise<boolean> => {
      const line = currentLines().find(l => l.key === key)
      if (!line) return true
      let taskId: string | undefined
      for (const sent of line.sent ?? []) {
        if (sent.plannedOn === date) continue
        const receipt = await run({ type: 'add-task', pageId: sent.pageId, title: line.title, plannedOn: sent.plannedOn }, null, line.operationId, { quiet: true, inlineRefusal: addedEarlier })
        taskId = receipt?.entityId
        if (taskId) break
      }
      if (!taskId) return false
      const task = latest()?.tasks.find(t => t.id === taskId)
      // Ticked, removed or already on the day since: nothing to move.
      if (!task || task.status !== 'open' || getDayView(latest()!, date).dayTasks.some(t => t.id === taskId)) return true
      const moveOperationId = line.moves?.[date] ?? newOperationId()
      if (!line.moves?.[date]) setLines(all => all.map(l => (l.key === key ? { ...l, moves: { ...l.moves, [date]: moveOperationId } } : l)))
      return Boolean(await run({ type: 'plan-tasks', date, items: [{ taskId }] }, null, moveOperationId, { quiet: true }))
    },
    [currentLines, latest, run, setLines],
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
        const target = await ensurePage(date)
        let receipt: Receipt | null = null
        let landedEarlier = false
        if (target) {
          const sent: AddSent = { pageId: target.id, plannedOn: date }
          // Recorded before sending: if this one lands and its reply is lost, a later day can still replay it.
          setLines(all => all.map(l => (l.key === line.key && !l.sent?.some(x => x.pageId === sent.pageId) ? { ...l, sent: [...(l.sent ?? []), sent] } : l)))
          receipt = await run({ type: 'add-task', pageId: sent.pageId, title: line.title, plannedOn: date }, null, line.operationId, {
            quiet: true,
            inlineRefusal: addedEarlier,
            onRefused: () => (landedEarlier = true),
          })
        }
        const saved = receipt ? true : landedEarlier ? await recoverEarlierAdd(line.key, date) : false
        setLines(all => (saved ? all.filter(l => l.key !== line.key) : all.map(l => (l.key === line.key ? { ...l, failed: true } : l))))
        // The day's record says he planned the next day from this page; nothing else reads the flag.
        const typedPage = latest()?.pages.find(p => p.type === 'daily' && p.date === line.typedOn)
        if (saved && typedPage && !typedPage.reviewSaved) void run({ type: 'save-review', date: line.typedOn }, null, undefined, { quiet: true })
        return saved
      })().finally(() => saving.current.delete(line.key))
      saving.current.set(line.key, job)
      return job
    },
    [ensurePage, latest, recoverEarlierAdd, run, setLines, today],
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

  // A half-typed input left by the old block becomes a line once, for today: its intended day isn't known.
  useEffect(() => {
    if (!owner) return
    const kept = localStorage.getItem(draftKey(owner))?.trim()
    if (!kept) return
    localStorage.removeItem(draftKey(owner))
    const line: PendingLine = { key: newOperationId(), title: kept, operationId: newOperationId(), failed: false, date: today, typedOn: today }
    setLines(all => [...all, line])
    void saveLine(line)
  }, [owner, saveLine, setLines, today])

  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && retryAll()
    window.addEventListener('online', retryAll)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', retryAll)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [retryAll])

  return null
}

