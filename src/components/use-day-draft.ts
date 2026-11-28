// B77: the day draft on a day page (Jazz 259d2c55's interface). The bands read `draftView`; every write saves what
// he typed on the page first and does nothing if that save fails, like the morning card. The model is asked once
// per day page per tab, when today's page is open and has no draft yet (or only one an older recipe made, Brian
// 3d7aca46), and once more when he comes back to the page after an ask that failed or was lost in this tab; the page
// itself never waits on it.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { EditorNode } from '../domain/editor-document'
import { draftOf, draftStale, draftView, type DraftItemView } from '../domain/day-draft'
import type { Action, LocalDate, Page, Task, Workspace } from '../domain/types'
import { prepareDayDraft } from '../server/functions'
import { todayIso } from './dates'
import { applyDraftAction, draftTicket, reopenDraftAction, skipDraftAction, type DraftTicket } from './draft-actions'
import { draftLineState, type DayDraftState, type DraftAskSummary } from './draft-words'
import { flushEditor } from './editor-flush'
import { newOperationId, useWorkspace, workspaceOwner } from './use-day'

export type { DayDraftState, DraftTicket }
export interface DayDraftHook {
  state: DayDraftState
  items: DraftItemView[]
  moreOpen: { taskId: string; title: string; since: LocalDate }[]
  /** Where a band whose anchor is gone goes: under the planning heading, after his planned rows. */
  planningEndId: string | null
  /** The block "N more open ▸" sits after: the end of the planning part. */
  moreOpenAfterId: string | null
  /**
   * Tap feedback §2: the decisions stored on this device and not answered yet, by item, so a band shows the result at
   * once and keeps it across a reload. Read from the outbox, never from component memory (§2.6).
   */
  decided: Record<string, 'apply' | 'skip'>
  /** Decisions the server held (the draft changed since), by item, with their operation: said in place until Keep mine or Discard. */
  held: Record<string, { kind: 'apply' | 'skip' | 'move'; operationId: string; /** One decision on several items (Apply all, Dismiss): said once, under the draft line (B109). */ batch: boolean }>
  /**
   * `onStored`: the change is kept on this device (the first frame its band may look decided, §2). Resolves once the
   * server has answered: what it applied, what was no longer open, `refused` when nothing was ("Nothing to apply"), and
   * `failed` when it wasn't stored and didn't land either.
   */
  apply(itemIds: string[], edits?: Record<string, string>, hooks?: DecisionHooks): Promise<DecisionOutcome & { applied: string[]; dropped: string[] }>
  /** Skipped for today: the notice's ticket for Move to and its second Undo, or null when nothing was skipped. `onStored` gets the ticket. */
  skip(itemIds: string[], hooks?: DecisionHooks<DraftTicket>): Promise<DraftTicket | null>
  /** The Applied notice's Undo (§2.4a): its own change, naming the apply, sent after it; works before the apply has landed. */
  undoApply(operationId: string): Promise<'done' | 'refused' | 'failed'>
  /**
   * Move to a later day (Brian 17e7b7f2, Lead d2d043f0): each suggested to-do on the ticket is planned on `date` and
   * stays skipped here. Lines have no day and are left as they are. A to-do planned elsewhere since the notice was shown
   * keeps that plan (`dropped`); 'refused' when none could move for that reason. Its Undo takes back only the move.
   */
  snooze(ticket: DraftTicket, date: LocalDate): Promise<{ status: 'done' | 'refused' | 'failed'; moved: string[]; dropped: string[]; operationId: string; /** The server's refusal, when refused. */ reason?: string }>
  /** Undo on `Moved to …`: takes back only the move; 'refused' when the workspace's Undo has moved on. */
  undoMove(operationId: string): Promise<'done' | 'refused' | 'failed'>
  /**
   * #377: the row's Another day on a carried to-do: skipped here and planned on `date` in one write (`move-draft`), so
   * its Undo (`undoApply`, which works before it has landed too) takes back both. `refused` with the server's reason.
   */
  move(itemId: string, date: LocalDate, hooks?: DecisionHooks): Promise<DecisionOutcome & { reason?: string }>
  /**
   * The skip notice's Undo once Undo move has used the workspace's one Undo: reopens what that skip left, or 'refused'
   * when it was skipped, moved or applied since, or its to-do planned elsewhere (`Can't undo · edited since`).
   */
  reopen(ticket: DraftTicket): Promise<'done' | 'refused' | 'failed'>
  addOpen(taskId: string): Promise<boolean>
  retry(): void
}
export type { DraftItemView, EditorNode, Task }
export interface DecisionHooks<T = string> { onStored?: (stored: T) => void; /** The server said nothing was left to decide (decided elsewhere). */ onRefused?: () => void; /** The server held it (the draft changed since): the banner keeps Keep mine / Discard. */ onHeld?: () => void }
export interface DecisionOutcome { operationId: string; stored: boolean; landed: boolean; refused: boolean; /** Held by the server, not refused outright: still in the outbox for Keep mine / Discard. */ held: boolean; failed: boolean }

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
const askSummary = (ask: Ask | undefined): DraftAskSummary => (!ask ? null : ask.state === 'asking' ? (inFlight(ask) ? 'in-flight' : 'lost') : ask.state)
/** A draft ask still waiting for its reply in this tab, on any page: a reload waits for it (new-build.ts). */
export const draftAskPending = (): boolean => [...asks.values()].some(inFlight)
const failuresOf = (ask: Ask | undefined): number => !ask || ask.state === 'done' ? 0 : ask.state === 'failed' ? ask.failures : ask.failures + 1
const AUTO_ASKS = 2
/** A draft that stands for the day. One an older recipe made doesn't: today's is asked for again, its bands shown meanwhile. */
const standingDraft = (ws: Workspace, pageId: string): boolean => { const d = draftOf(ws, pageId); return Boolean(d && !draftStale(d)) }

export function useDayDraft(page: Page): DayDraftHook {
  const { workspace, run, latest, offline, refresh, outbox } = useWorkspace()
  const decisions = useRef(outbox.decisions); decisions.current = outbox.decisions
  const decided = useMemo(() => {
    const out: Record<string, 'apply' | 'skip'> = {}
    for (const d of outbox.decisions) if (d.pageId === page.id && !d.undone) for (const id of d.itemIds) out[id] = d.type === 'apply-draft' ? 'apply' : 'skip'
    return out
  }, [outbox.decisions, page.id])
  const held = useMemo(() => {
    const out: DayDraftHook['held'] = {}
    for (const d of outbox.heldDecisions) if (d.pageId === page.id) for (const id of d.itemIds) out[id] = { kind: d.type === 'apply-draft' ? 'apply' : d.type === 'move-draft' ? 'move' : 'skip', operationId: d.operationId, batch: d.itemIds.length > 1 }
    return out
  }, [outbox.heldDecisions, page.id])
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
      const { setDraft, owner, remakeFailed } = await prepareDayDraft({ data: { date: page.date, operationId: newOperationId() } })
      // Made from another account's workspace (the session changed meanwhile): its words never go into this one.
      outcome = { state: 'done' }
      if (owner !== (workspaceOwner() ?? 'local')) return
      // Today's older draft couldn't be made again: it stays, its bands showing, and this counts as a failed ask.
      if (remakeFailed) { outcome = { state: 'failed', failures: failures + 1 }; return }
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

  const hasDraft = Boolean(workspace && standingDraft(workspace, page.id))
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
      if (document.visibilityState !== 'visible' || offlineRef.current || !ws || standingDraft(ws, page.id) || page.date !== todayIso()) return
      if (asks.has(page.id)) void prepare(true)
    }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    window.addEventListener('pageshow', again)
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); window.removeEventListener('pageshow', again) }
  }, [page.type, page.id, page.date, latest, prepare])

  /** Saves the page's typing first; a failed save stops the write. */
  const write = useCallback(async (...args: Parameters<typeof run>) => ((await flushEditor(page.id)) ? run(...args) : null), [page.id, run])

  const apply = useCallback(async (itemIds: string[], edits?: Record<string, string>, hooks?: DecisionHooks) => {
    const open = new Set(itemIds.filter(id => draftOf(latest()!, page.id)?.items.some(i => i.id === id && i.state === 'open')))
    const operationId = newOperationId()
    let stored = false, refused = false, held = false
    // No notice from here: the day-draft UI shows `Applied · Undo` as soon as the change is stored (tap feedback §2.1).
    const receipt = await write(applyDraftAction(page.id, itemIds, todayIso(), edits), undefined, operationId, {
      inlineRefusal: /Nothing to apply/, onRefused: () => { refused = true }, onHeld: () => { held = true }, onStored: () => { stored = true; hooks?.onStored?.(operationId) },
    })
    const after = receipt ? draftOf(latest()!, page.id) : null
    const applied = itemIds.filter(id => open.has(id) && after?.items.some(i => i.id === id && i.state === 'applied'))
    return { applied, dropped: itemIds.filter(id => !applied.includes(id)), operationId, stored, landed: Boolean(receipt), refused, held, failed: !receipt && !refused && !held && !stored }
  }, [latest, page.id, write])

  const undoApply = useCallback(async (operationId: string) => {
    // Before the apply has landed, its stored change is what the Undo names; once it has, the workspace's one Undo must still be it.
    const waiting = decisions.current.some(d => d.operationId === operationId)
    if (!waiting && latest()?.undo?.operationId !== operationId) return 'refused' as const
    let refused = false
    const receipt = await run({ type: 'undo', targetOperationId: operationId }, undefined, undefined, { stale: 'outcome', inlineRefusal: /Cannot undo|Saved elsewhere/, onRefused: () => { refused = true } })
    return receipt ? 'done' as const : refused ? 'refused' as const : 'failed' as const
  }, [latest, run])

  const skip = useCallback(async (itemIds: string[], hooks?: DecisionHooks<DraftTicket>): Promise<DraftTicket | null> => {
    const ws = latest()
    const skippedBy = newOperationId()
    // No notice from here: the day-draft UI shows `Skipped` with its day row (day-draft.tsx).
    const ticket: DraftTicket = ws ? draftTicket(ws, page.id, itemIds, skippedBy) : { itemIds, skippedBy, seen: {} }
    const receipt = await write(skipDraftAction(page.id, itemIds), undefined, skippedBy, { inlineRefusal: /Nothing to skip/, onRefused: () => hooks?.onRefused?.(), onHeld: () => hooks?.onHeld?.(), onStored: () => hooks?.onStored?.(ticket) })
    return receipt ? ticket : null
  }, [latest, page.id, write])

  const snooze = useCallback(async (ticket: DraftTicket, date: LocalDate) => {
    const operationId = newOperationId()
    let refused = false, reason = ''
    const movedNow = () => ticket.itemIds.filter(id => draftOf(latest()!, page.id)?.items.some(i => i.id === id && i.until === date && i.by === operationId))
    // The `Moved to …` notice is the day-draft UI's: its Undo brings the Skipped notice back (day-draft.tsx).
    const receipt = await write({ type: 'snooze-draft', pageId: page.id, itemIds: ticket.itemIds, date, today: todayIso(), skippedBy: ticket.skippedBy, seen: ticket.seen }, undefined, operationId, { inlineRefusal: /Nothing to move|Pick a later day|Changed elsewhere/, onRefused: message => { refused = true; reason = message } })
    const moved = receipt ? movedNow() : []
    return { status: receipt ? 'done' as const : refused ? 'refused' as const : 'failed' as const, moved, dropped: ticket.itemIds.filter(id => !moved.includes(id)), operationId, ...(refused ? { reason } : {}) }
  }, [latest, page.id, write])

  const reopen = useCallback(async (ticket: DraftTicket) => {
    let refused = false
    const receipt = await write(reopenDraftAction(page.id, ticket), { text: 'Undone' }, undefined, { inlineRefusal: /Cannot undo/, onRefused: () => { refused = true } })
    return receipt ? 'done' as const : refused ? 'refused' as const : 'failed' as const
  }, [page.id, write])

  /** Undo on `Moved to …`: the workspace's one Undo, as every other notice sends it. The ticket still works afterwards. */
  const undoMove = useCallback(async (operationId: string) => {
    if (latest()?.undo?.operationId !== operationId) return 'refused' as const
    let refused = false
    const receipt = await run({ type: 'undo', targetOperationId: operationId }, undefined, undefined, { stale: 'outcome', inlineRefusal: /Cannot undo|Saved elsewhere/, onRefused: () => { refused = true } })
    return receipt ? 'done' as const : refused ? 'refused' as const : 'failed' as const
  }, [latest, run])

  const move = useCallback(async (itemId: string, date: LocalDate, hooks?: DecisionHooks) => {
    const operationId = newOperationId()
    let stored = false, refused = false, held = false, reason = ''
    const receipt = await write({ type: 'move-draft', pageId: page.id, itemId, date, today: todayIso() }, undefined, operationId, {
      inlineRefusal: /Nothing to move|Pick a later day|Changed elsewhere/, onRefused: message => { refused = true; reason = message; hooks?.onRefused?.() },
      onHeld: () => { held = true; hooks?.onHeld?.() }, onStored: () => { stored = true; hooks?.onStored?.(operationId) },
    })
    return { operationId, stored, landed: Boolean(receipt), refused, held, failed: !receipt && !refused && !held && !stored, ...(refused ? { reason } : {}) }
  }, [page.id, write])

  const addOpen = useCallback(async (taskId: string) => Boolean(page.date && await write({ type: 'plan-task', taskId, date: page.date, today: todayIso() }, r => ({ text: 'Added', undoOperationId: r.operationId }))), [page.date, write])

  const retry = useCallback(() => { void prepare(false) }, [prepare])

  const state = draftLineState(view, askSummary(ask), offline)
  return { state, items: view?.items ?? [], decided, held, moreOpen: view?.moreOpen ?? [], planningEndId: view?.planningEndId ?? null, moreOpenAfterId: view?.moreOpenAfterId ?? null, apply, skip, undoApply, snooze, undoMove, move, reopen, addOpen, retry }
}
