// B77: the day draft on a day page (Jazz 259d2c55's interface). The bands read `draftView`; every write saves what
// he typed on the page first and does nothing if that save fails, like the morning card. The model is asked once
// per day page per tab, when today's page is open and has no draft yet, and once more when he comes back to the page
// after an ask that failed or was lost in this tab; the page itself never waits on it.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { EditorNode } from '../domain/editor-document'
import { draftOf, draftView, type DraftItemView } from '../domain/day-draft'
import type { Action, LocalDate, Page, Task } from '../domain/types'
import { prepareDayDraft } from '../server/functions'
import { todayIso } from './dates'
import { flushEditor } from './editor-flush'
import { newOperationId, useWorkspace, workspaceOwner } from './use-day'

export type DayDraftState = 'none' | 'preparing' | 'ready' | 'failed' | 'offline'
export interface DayDraftHook {
  state: DayDraftState
  items: DraftItemView[]
  moreOpen: { taskId: string; title: string; since: LocalDate }[]
  /** Where a band whose anchor is gone goes: under the planning heading, after his planned rows. */
  planningEndId: string | null
  /** The block "N more open ▸" sits after: the end of the planning part. */
  moreOpenAfterId: string | null
  apply(itemIds: string[], edits?: Record<string, string>): Promise<{ applied: string[]; dropped: string[] }>
  skip(itemIds: string[]): Promise<boolean>
  addOpen(taskId: string): Promise<boolean>
  retry(): void
}
export type { DraftItemView, EditorNode, Task }

/**
 * This tab's ask for each day page's draft, shared by every hook on the page: in flight since `at`, answered (`done`), or
 * failed here with nothing stored, which shows Retry (Lead b01f4205). `failures` counts this tab's failed or lost asks:
 * a page asks by itself twice at most: a tab coming back after a failed or lost ask asks again (showing Preparing…, not
 * the error), and "Couldn't draft" stays only once that one fails too (Jazz d584f532). Retry always asks.
 */
type Ask = { state: 'asking'; at: number; failures: number } | { state: 'done' } | { state: 'failed'; failures: number }
const asks = new Map<string, Ask>()
const askListeners = new Set<() => void>()
const setAsk = (pageId: string, ask: Ask) => { asks.set(pageId, ask); for (const l of askListeners) l() }
const subscribeAsks = (l: () => void) => { askListeners.add(l); return () => { askListeners.delete(l) } }
/** No reply this long after asking (a tab frozen mid-request, Nov 1 07:00Z): the ask is taken as lost and may go again. */
const LOST_MS = 60_000
const inFlight = (ask: Ask | undefined): boolean => ask?.state === 'asking' && Date.now() - ask.at < LOST_MS
const failuresOf = (ask: Ask | undefined): number => !ask || ask.state === 'done' ? 0 : ask.state === 'failed' ? ask.failures : ask.failures + 1
const AUTO_ASKS = 2

export function useDayDraft(page: Page): DayDraftHook {
  const { workspace, run, latest, offline, refresh } = useWorkspace()
  const ask = useSyncExternalStore(subscribeAsks, () => asks.get(page.id), () => undefined)
  const view = useMemo(() => (workspace && page.type === 'daily' ? draftView(workspace, page) : null), [workspace, page])

  /** `auto`: asked by the page itself, not his Retry; it stops after AUTO_ASKS failed or lost asks. */
  const prepare = useCallback(async (auto: boolean) => {
    const before = asks.get(page.id)
    if (!page.date || inFlight(before) || (auto && failuresOf(before) >= AUTO_ASKS)) return
    const failures = failuresOf(before)
    const mine: Ask = { state: 'asking', at: Date.now(), failures }
    setAsk(page.id, mine)
    let outcome: Ask = { state: 'failed', failures: failures + 1 }
    // A tab he's looking at gets Retry when the reply never comes, without waiting for him to leave and come back
    // (Ratchet). A reply after that still stores its draft; it just doesn't overwrite this state.
    const lost = setTimeout(() => { if (asks.get(page.id) === mine) setAsk(page.id, { state: 'failed', failures: failures + 1 }) }, LOST_MS)
    try {
      // The server only computes the draft; storing it goes through this tab's queue, after any save he typed
      // meanwhile, so neither is sent against a revision the other has moved on (Lead 1d5e2e28).
      const { setDraft, owner } = await prepareDayDraft({ data: { date: page.date, operationId: newOperationId() } })
      // Made from another account's workspace (the session changed meanwhile): its words never go into this one.
      outcome = { state: 'done' }
      if (owner !== (workspaceOwner() ?? 'local')) return
      if (!setDraft) { await refresh(); return }
      outcome = { state: 'failed', failures: failures + 1 }
      const action = JSON.parse(setDraft) as Action
      // A refusal is another tab's draft winning (shown after run's own refresh). A failure resyncs inside run, so
      // one more try covers a change from another device; after that the state line shows Retry.
      for (let attempt = 0; attempt < 2; attempt++) {
        let refused = false
        if (await run(action, undefined, undefined, { quiet: true, inlineRefusal: /already has its draft/, onRefused: () => { refused = true } })) { outcome = { state: 'done' }; return }
        if (refused) { outcome = { state: 'done' }; return }
      }
    } catch { /* nothing stored: the state line shows Retry, and the next look at the page asks again */ } finally {
      clearTimeout(lost)
      // A late reply to an ask taken as lost doesn't overwrite the newer one.
      if (asks.get(page.id) === mine) setAsk(page.id, outcome)
    }
  }, [page.id, page.date, refresh, run])

  const hasDraft = Boolean(workspace && draftOf(workspace, page.id))
  const eligible = !offline && !hasDraft && page.type === 'daily' && page.date === todayIso()
  useEffect(() => {
    if (eligible && !asks.has(page.id)) void prepare(true)
  }, [eligible, page.id, prepare])
  // An ask still open (it failed here, or its reply never came) goes again when he comes back to today's page: a tab
  // woken after midnight, a Home Screen app reopened. Only while nothing is stored: a stored failure has its Retry.
  const offlineRef = useRef(offline); offlineRef.current = offline
  useEffect(() => {
    if (page.type !== 'daily') return
    const again = () => {
      const ws = latest()
      if (document.visibilityState !== 'visible' || offlineRef.current || !ws || draftOf(ws, page.id) || page.date !== todayIso()) return
      if (asks.has(page.id)) void prepare(true)
    }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    window.addEventListener('pageshow', again)
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); window.removeEventListener('pageshow', again) }
  }, [page.type, page.id, page.date, latest, prepare])

  /** Saves the page's typing first; a failed save stops the write. */
  const write = useCallback(async (...args: Parameters<typeof run>) => ((await flushEditor(page.id)) ? run(...args) : null), [page.id, run])

  const apply = useCallback(async (itemIds: string[], edits?: Record<string, string>) => {
    const open = new Set(itemIds.filter(id => draftOf(latest()!, page.id)?.items.some(i => i.id === id && i.state === 'open')))
    const notice = () => {
      const after = draftOf(latest()!, page.id)
      const applied = [...open].filter(id => after?.items.some(i => i.id === id && i.state === 'applied')).length
      const dropped = itemIds.length - applied
      return { text: `${applied === 1 ? 'Applied' : `Applied ${applied}`}${dropped ? ` · ${dropped} no longer open` : ''}` }
    }
    const receipt = await write({ type: 'apply-draft', pageId: page.id, itemIds, ...(edits ? { edits } : {}), today: todayIso() }, r => ({ ...notice(), undoOperationId: r.operationId }), undefined, { inlineRefusal: /Nothing to apply/ })
    const after = receipt ? draftOf(latest()!, page.id) : null
    const applied = itemIds.filter(id => open.has(id) && after?.items.some(i => i.id === id && i.state === 'applied'))
    return { applied, dropped: itemIds.filter(id => !applied.includes(id)) }
  }, [latest, page.id, write])

  const skip = useCallback(async (itemIds: string[]) => Boolean(await write({ type: 'skip-draft', pageId: page.id, itemIds }, r => ({ text: itemIds.length === 1 ? 'Skipped' : `Skipped ${itemIds.length}`, undoOperationId: r.operationId }), undefined, { inlineRefusal: /Nothing to skip/ })), [page.id, write])

  const addOpen = useCallback(async (taskId: string) => Boolean(page.date && await write({ type: 'plan-task', taskId, date: page.date, today: todayIso() }, r => ({ text: 'Added', undoOperationId: r.operationId }))), [page.date, write])

  const retry = useCallback(() => { void prepare(false) }, [prepare])

  const state: DayDraftState = offline && !view ? 'offline' : inFlight(ask) && !view?.items.length ? 'preparing'
    // A failed or lost ask here shows Retry at once (he may be looking at the page); a tab coming back asks again first.
    : !view ? (ask && ask.state !== 'done' ? 'failed' : 'none') : view.status === 'failed' ? 'failed' : 'ready'
  return { state, items: view?.items ?? [], moreOpen: view?.moreOpen ?? [], planningEndId: view?.planningEndId ?? null, moreOpenAfterId: view?.moreOpenAfterId ?? null, apply, skip, addOpen, retry }
}
