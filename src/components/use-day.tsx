// The only place screens touch data: loadWorkspace()/runCommand() on the local server
// (src/server/functions.ts). getDayView is a pure read of the loaded workspace.
import { Button, toast } from '@heroui/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Action, DayView, LocalDate, Receipt, Task, Workspace } from '../domain/types'
import { applyCommand, getDayView } from '../domain/workspace'
import { rawOf, type Json, type RowEdit } from '../domain/database'
import { replyWorkspace } from './command-reply'
import { loadWorkspace, runCommand, runOutboxCommand } from '../server/functions'
import { appWrites, capture, draftDecisions, drainQueue, idbOutboxStore, outboxCounts, schedule, type DraftDecision, type DrainResult, type OutboxEntry, type OutboxStore, type SendAnswer } from './outbox'
import { isNetworkFailure } from './offline-copy'
import { drawRule, drawsAhead, takenBackText } from './draw-ahead'
import { justPressed, markWorking } from './press'
import { expandedWorkspace } from '../domain/synced'
import { configureDebug, debugClient } from '../lib/debug'
import { sampleActions } from './fixture'
import { todayIso } from './dates'
import { openAutomations } from './automation-sheet'
import { flushAllEditors } from './editor-flush'
import { offlineCopy } from './offline-copy'
import { setDraftOwner } from './draft-slots'
import { HOLD_MS, heldWorkspace, isSaving, settleTick, shownStatus, tapTarget, withTick, type Tick, type Ticks, type TickStatus } from './task-ticks'

export interface Transport {
  load(operationId?: string, triggerOperationId?: string): Promise<Workspace>
  run(workspace: Workspace, action: Action, operationId?: string): Promise<{ workspace: Workspace; receipt: Receipt }>
  /** B98: a change from the outbox (outbox.md §5). Absent in tests' transports, which then keep today's path. */
  runOutbox?(workspace: Workspace, entry: OutboxEntry): Promise<OutboxAnswer>
}

/** What the server made of an outbox change (outbox.md §5, §11). `missing`: this server has no outbox (an older build). */
export type OutboxAnswer = SendAnswer

/** An older build answers an unknown server function with an error, never by running it (outbox.md §11). */
const missingFunction = (error: unknown): boolean => /server function|not found|404/i.test(error instanceof Error ? error.message : String(error))

/**
 * Whose workspace is on screen: the `owner` of the last server answer, or of the offline copy when the app opened
 * offline. Null until either is known. Device-only records (the Tomorrow block's unsaved lines) are kept under it.
 */
let knownOwner: string | null = null
export function workspaceOwner(): string | null {
  return knownOwner
}
/** The one place the owner changes, so the kept drafts (draft-slots.ts) are read and written under the same account. */
function noteOwner(owner: string | null): void {
  knownOwner = owner
  setDraftOwner(owner)
}

// Every workspace the server answers with is the copy the next offline open shows, kept under the account it belongs to.
const serverTransport: Transport = {
  load: async (operationId = newOperationId(), triggerOperationId) => {
    const startedAt = Date.now()
    const response=await loadWorkspace({data:{operationId,triggerOperationId}})
    configureDebug(response.debug)
    noteOwner(response.owner)
    // Synced blocks' lines travel once, in their records (synced.ts).
    const workspace = expandedWorkspace(response.workspace)
    void offlineCopy.remember(workspace, { owner: response.owner, startedAt })
    return workspace
  },
  // The reply carries what the command changed (workspace-changes.ts), applied to the copy it was sent from. When that
  // copy isn't the one the changes start from (a replay) or the reply is another account's, it is loaded whole.
  run: async (workspace, action, operationId = newOperationId()) => {
    const startedAt = Date.now()
    const response = await runCommand({ data: { operationId, expectedRevision: workspace.revision, action, changes: true } })
    const ownerBefore = knownOwner
    noteOwner(response.owner)
    const next = replyWorkspace(workspace, response, ownerBefore)
    if (!next) return { workspace: await serverTransport.load(), receipt: response.receipt }
    void offlineCopy.remember(next, { owner: response.owner, startedAt })
    return { workspace: next, receipt: response.receipt }
  },
}

// B98: the outbox's send (outbox.md §5). Its answer is an outcome; only a failure of the network or server throws.
const sendOutbox = async (workspace: Workspace, entry: OutboxEntry): Promise<OutboxAnswer> => {
  const startedAt = Date.now()
  try {
    const answer = await runOutboxCommand({ data: { operationId: entry.operationId, expectedRevision: entry.baseRevision, action: entry.action, expectedOwner: entry.owner, basis: { baseRevision: entry.baseRevision, ownRevisions: entry.ownRevisions, readsBeyond: entry.readsBeyond } } })
    if (answer.status === 'owner-mismatch') return { status: 'owner-mismatch' }
    if (answer.status === 'already-applied') return { status: 'already-applied' }
    if (answer.status === 'held') return { status: 'held', reason: answer.reason, ...(answer.stale ? { stale: true as const } : {}) }
    // A change whose cells or version moved on since he made it reads as one changed elsewhere, with Keep mine (Jazz 3d66a938).
    if (answer.status === 'refused') return { status: 'held', reason: /not found|gone|no longer/i.test(answer.message) ? 'gone' : /changed elsewhere|saved elsewhere/i.test(answer.message) ? 'conflict' : 'refused', message: answer.message }
    const ownerBefore = knownOwner
    noteOwner(answer.owner)
    const next = replyWorkspace(workspace, { owner: answer.owner, changes: answer.changes }, ownerBefore) ?? await serverTransport.load()
    void offlineCopy.remember(next, { owner: answer.owner, startedAt })
    return { status: 'applied', workspace: next, receipt: answer.receipt }
  } catch (error) {
    if (isNetworkFailure(error)) return { status: 'offline' }
    if (missingFunction(error)) return { status: 'missing' }
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
serverTransport.runOutbox = sendOutbox

/** Why an outbox change didn't land now: it is kept (pending or held), or it was there already (`done`). */
class OutboxStop extends Error {
  readonly kind: 'held' | 'waiting' | 'offline' | 'failed' | 'owner' | 'done'
  readonly detail?: string
  /** Held only because the workspace moved on, and given back to the caller that asked for it (RunOptions.stale). */
  readonly handedBack: boolean
  constructor(kind: OutboxStop['kind'], detail?: string, handedBack = false) { super(`Outbox: ${kind}`); this.name = 'OutboxStop'; this.kind = kind; this.handedBack = handedBack; if (detail !== undefined) this.detail = detail }
}
/** What the banners read (outbox.md §8): changes kept and not yet sent, the oldest held one, what waits on it. */
export interface OutboxView {
  pending: number; held: OutboxEntry | null; waiting: number; durable: boolean; keptBack: boolean
  /** A change couldn't be sent for lack of network, or the browser says it's offline (§8.2). */
  offline: boolean
  /** Not durable and a change still unsent after a second, or after a failed send (§8.4, Jazz 3c65a099): never a flash on every change. */
  atRisk: boolean
  /**
   * Tap feedback §2.6: the day draft's decisions stored on this device and not yet answered, so a band shows what he
   * decided from the stored change itself, after a reload or offline too. `undone`: an Undo of it is stored after it.
   */
  decisions: DraftDecision[]
  /** The draft decisions the server held (a conflict): said on their band until Keep mine or Discard (Jazz 93fbd48f). */
  heldDecisions: DraftDecision[]
}
/** Set while the outbox may hold changes, so a load reads the store before the first paint only then (R1-18). */
const outboxHint = {
  key: 'daythread:outbox:stored',
  get(): boolean { try { return typeof localStorage !== 'undefined' && localStorage.getItem(this.key) === '1' } catch { return true } },
  set(): void { try { localStorage.setItem(this.key, '1') } catch { /* no storage: the store is read after the paint */ } },
  clear(): void { try { localStorage.removeItem(this.key) } catch { /* nothing to clear */ } },
}
/** Two taps on one to-do closer than this are one tap (B98 item 2; Jazz may tune it). */
const doubleTapMs = 500
const emptyOutbox: OutboxView = { pending: 0, held: null, waiting: 0, durable: true, keptBack: false, offline: false, atRisk: false, decisions: [], heldDecisions: [] }


/** Commands queued or being sent in this tab, across providers: a reload waits for none (new-build.ts). */
let commandsOut = 0
export const commandsPending = (): boolean => commandsOut > 0
/** A command that failed and waits on the header's Retry lives only in this tab: a reload would drop it (new-build.ts). */
let commandFailedOut = false
export const commandFailed = (): boolean => commandFailedOut

export function newOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export function isConflict(message: string | null): boolean {
  return message !== null && /saved elsewhere|changed|cannot undo/i.test(message)
}

/** A HeroUI toast after a command: Undo while the domain's single undo slot still holds it, plus an optional extra action. */
export interface Notice {
  text: string
  undoOperationId?: string
  extra?: { label: string; run: () => void }
}

type NoticeSpec = Notice | null
export type NoticeArg = NoticeSpec | ((r: Receipt) => NoticeSpec)
/** A domain refusal matching `inlineRefusal` is handed to `onRefused` instead of the save-failed bar. */
/**
 * A change given back to its caller (RunOptions.stale), until the caller replaces it or says it's done with it (Ratchet
 * 6804fae5). Kept, held and unshown in the outbox meanwhile; a reload shows it held.
 */
export interface Handoff {
  readonly seq: number
  /** Whose change it is, as it was when given back: never the tab's owner later on (Ratchet 1931aa3b). */
  readonly owner: string
  /** Its caller won't build it again, and has said so to him: it leaves the outbox. */
  done(): Promise<void>
}

type RunOptions = {
  inlineRefusal?: RegExp; /** `handoff`: given with "Saved elsewhere" to a caller that declared `stale`; pass it as `replaces` to the run that builds it again, or call `done`. */ onRefused?: (message: string, handoff?: Handoff) => void; /** The failure's message, for a caller that retries by itself (B35). */ onFailure?: (message: string) => void; /** B40: a background save; its failure says so in its own line, never the header's bar and Retry. */ quiet?: boolean
  /**
   * B98 (Lead bd4cc39e, Ratchet d6a88f04): what this caller does when its change, made just now in this tab, is held only
   * because the workspace moved on. `rebuild`: it builds the change again once on the latest state, as it does after
   * "Saved elsewhere"; `outcome`: it shows its own last word ("Can't undo · edited since"). Either way it's told
   * "Saved elsewhere" through `onRefused`, and the stored change stays until its rebuild is stored or the word is
   * said. Absent: the change is held, with the banner. A stored change replayed after a reload is never handed back.
   */
  stale?: 'rebuild' | 'outcome'
  /** This run builds again the change given back with this hand-off: stored in its place, in one transaction. */
  replaces?: Handoff
  /** B98: the change is kept in the outbox now, so a copy the caller kept for a closed tab (a cell's draft) can go (gate 4d6fbafe). */
  onStored?: () => void
  /**
   * B98: the run ended with its change kept on the device to be sent later (offline, a failed send, waiting on a held
   * one). `onKept` is told before the run's null comes back; `onLater` once that change lands (true), or is held or
   * discarded (false). A caller then shows it as on its way, never "not saved · Retry", which would make a second change.
   */
  onKept?: () => void
  /** The server held the change (a conflict, changed since): kept for Keep mine / Discard in the banner; its caller may say so in place (tap feedback §2.1.4). */
  onHeld?: (message: string) => void
  onLater?: (landed: boolean) => void
  /**
   * Release 2 (#374): this caller says it in place when its change, drawn before the answer, is held, and returns true
   * if it did (it's still on screen): then no generic notice. Called in the render that takes the change back, also
   * after the run returned (kept for later, then held on a later send). After a reload the generic notice says it.
   */
  onTakenBack?: (entry: OutboxEntry) => boolean
}

export type ActionSource = Action | ((workspace: Workspace) => Action | null)

interface WorkspaceContextValue {
  workspace: Workspace | null
  loadError: string | null
  /** The workspace on screen is the last-loaded copy: the network is away (docs/design/pwa.md §2). */
  offline: boolean
  saveState: SaveState
  saveError: string | null
  /** The command that failed and Retry would resend, if any. */
  failedAction: Action['type'] | null
  /** A function builds the action inside the queue, from the workspace every earlier command has landed on; null sends nothing. */
  run(action: ActionSource, notice?: NoticeArg, operationId?: string, options?: RunOptions): Promise<Receipt | null>
  /** The workspace as of the last command or load, before React re-renders: what a command just did. */
  latest(): Workspace | null
  retry(): void
  reload(): void
  refresh(triggerOperationId?: string): Promise<Workspace>
  addSampleData(): Promise<void>
  /** B72: to-dos whose tick is saving or holding its row (task-ticks.ts). */
  ticks: Ticks
  /** Ticks or unticks a to-do; ignored while that to-do's last tap is still saving. `notice` gets the new status. */
  toggleTask(taskId: string, notice: (to: Task['status'], r: Receipt) => NoticeSpec): void
  /** B98: what's kept on the device and not yet on the server, and the held change (outbox.md §8). */
  outbox: OutboxView
  discardHeld(): Promise<void>
  keepMine(): Promise<void>
  settleOutbox(): Promise<number>
  clearOutbox(): Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function scheduledFailure(rules: NonNullable<Receipt['automations']>): Notice {
  return { text: rules.paused.length === 1 ? `${rules.paused[0]!.name} paused` : `${rules.paused.length} paused`, extra: { label: 'Edit', run: () => openAutomations(rules.databaseId) } }
}
function withRules(spec: Notice, rules: NonNullable<Receipt['automations']>, operationId: string): Notice {
  const short = (name: string) => (name.length > 28 ? `${name.slice(0, 27)}…` : name)
  const paused = rules.paused.length === 1 ? `${short(rules.paused[0]!.name)} paused` : rules.paused.length ? `${rules.paused.length} paused` : ''
  const said = [spec.text, ...rules.ran.map(short), paused].filter(Boolean).join(' · ')
  return { ...spec, text: said, undoOperationId: operationId, ...(rules.paused.length ? { extra: { label: 'Edit', run: () => openAutomations(rules.databaseId) } } : {}) }
}

export function WorkspaceProvider({ children, transport = serverTransport }: { children: ReactNode; transport?: Transport }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastFailed, setLastFailed] = useState<{ action: Action; notice?: NoticeArg; operationId: string } | null>(null)
  // Commands are applied one at a time against the latest revision.
  const wsRef = useRef<Workspace | null>(null)
  // ---- B98: the outbox (outbox.md). This tab's owner's entries, mirrored from the store; the store is the truth.
  // Made once: a ref's initial value is evaluated on every render, so these are filled in only while empty.
  const store = useRef<OutboxStore | null | undefined>(undefined)
  if (store.current === undefined) store.current = transport.runOutbox && typeof indexedDB !== 'undefined' ? idbOutboxStore() : null
  const entries = useRef<OutboxEntry[]>([])
  /** Entries shown as made: stored before this load, or left after a send that didn't land. */
  const kept = useRef(new Set<number>())
  /** Release 2 (#374): his changes from this tab drawn as soon as they're stored, by seq (draw-ahead.ts); pruned as they leave. */
  const drawAhead = useRef(new Set<number>())
  const drawn = (seq: number | undefined) => seq !== undefined && (kept.current.has(seq) || drawAhead.current.has(seq))
  /** Callers that say in place a drawn change the server held (RunOptions.onTakenBack), by operation id, until it leaves the queue. */
  const takenBackBy = useRef(new Map<string, (entry: OutboxEntry) => boolean>())
  /**
   * What a caller in this tab says itself when its change is held, by operation, while its run is out: it
   * rebuilds a stale one (`stale`), or says a refusal in place (`inlineRefusal`). Those aren't said again.
   */
  const callerSays = useRef(new Map<string, { stale: boolean; inline?: RegExp }>())
  /** Changes already said to be not saved, by owner and operation: once each, whichever path found it (Ratchet b527e8d8). */
  const announced = useRef(new Set<string>())
  const durable = useRef(true), legacy = useRef(false), inFlight = useRef(new Set<number>())
  // A browser with no IndexedDB at all keeps nothing on the device (Ratchet 5ca37837).
  if (store.current === null && transport.runOutbox && durable.current) durable.current = false
  /** The last send failed for lack of network; cleared by the next one that gets through. */
  const netAway = useRef(false), slowUnsent = useRef(false)
  /** Not durable: changes that failed to send and live only in this tab's memory, by operation id, each at risk until that change itself gets through (Ratchet ff7e0d37). */
  const memoryUnsent = useRef(new Set<string>())
  /**
   * Changes given back to their caller (RunOptions.stale), by seq: kept, held and unshown until replaced. `newest`: the
   * newest seq stored when it was; `ready`: the caller has been told, so the next change stored here is its rebuild.
   */
  const handedBack = useRef(new Set<number>())
  const [outbox, setOutbox] = useState<OutboxView>(emptyOutbox)
  /** The workspace with every pending change applied, in order (§4): what changes are built on, and what's shown meanwhile. */
  /**
   * `shown`: only changes this tab isn't sending live right now (stored from before, or kept after a failed send). A
   * change on its way is shown by today's own marks (a tick's hold, a cell's pending value), which the prediction would
   * pre-empt: a ticked to-do would leave an Open list at once instead of after its hold.
   */
  const predicted = useCallback((shown = false): Workspace | null => {
    let ws = wsRef.current
    if (!ws) return null
    for (const e of entries.current) {
      if (e.state !== 'pending' || e.action.type === 'undo' || (shown && !drawn(e.seq))) continue
      try { ws = applyCommand(ws, { operationId: e.operationId, expectedRevision: ws.revision, action: e.action }).workspace } catch { /* the server will say */ }
    }
    return ws
  }, [])
  // B98: until the first load's stored changes are sent, nothing else is (the app's own writes on open wait: Jazz ef6b418a).
  const openQueue = useRef<() => void>(() => undefined)
  const queue = useRef<Promise<unknown>>(undefined as unknown as Promise<unknown>)
  if (!queue.current) queue.current = store.current ? new Promise<void>(resolve => { openQueue.current = resolve }) : Promise.resolve()
  const storedAtMount = useRef<Promise<OutboxEntry[]> | null | undefined>(undefined)
  // Read before the first paint only when a change was stored (a hint kept beside it): otherwise the store isn't even
  // opened on the way to the page (R1-18), and is read just after, in case the hint was lost.
  if (storedAtMount.current === undefined) storedAtMount.current = store.current && outboxHint.get() ? store.current.all().catch(() => { durable.current = false; return [] }) : null

  /** The server's workspace; what's shown has his pending changes on top, so a tick never shows unticked first (Jazz §8.1). */
  const adopt = useCallback((ws: Workspace) => {
    wsRef.current = ws
    setWorkspace(entries.current.some(e => e.state === 'pending' && drawn(e.seq)) ? predicted(true) ?? ws : ws)
  }, [predicted])
  const showOutbox = useCallback(() => {
    if (!entries.current.length && store.current && outboxHint.get()) void store.current.all().then(left => { if (!left.length) outboxHint.clear() }).catch(() => undefined)
    // The same split the drain sends by (Jazz b6c71626). His changes only: the app's own writes (opening a day, the
    // draft) are never counted to him (Jazz 8887e299).
    const shown = entries.current.filter(e => !handedBack.current.has(e.seq!))
    const { held, waiting, pending } = outboxCounts(shown)
    const away = netAway.current || (typeof navigator !== 'undefined' && navigator.onLine === false)
    setOutbox({ pending, held, waiting, durable: durable.current, keptBack: legacy.current && pending > 0, offline: away && pending > 0, atRisk: !durable.current && (slowUnsent.current || memoryUnsent.current.size > 0 || (away && commandsPending())), decisions: draftDecisions(shown), heldDecisions: draftDecisions(shown, 'held') })
    if (entries.current.some(e => e.state === 'pending' && drawn(e.seq))) { const shown = predicted(true); if (shown) setWorkspace(shown) } else if (wsRef.current) setWorkspace(wsRef.current)
  }, [predicted])
  /**
   * The owner's queue as the store has it now (a drain's read, another tab's, a hand-off). A change of his that went from
   * pending to held is said in the same render (Ratchet b527e8d8 §1, §2): a drawn one goes back on screen, and one that
   * waited clears its working mark (Lead 88aeff42: every waiting type too). Named, once per operation, by its caller in
   * place if it said it would, else by a notice. Not said: a change already held when this tab first saw it, the app's
   * own writes, a type with its own mark (a tick, a cell, the draft), one its caller rebuilds or refuses in place.
   */
  const takeQueue = useCallback((next: OutboxEntry[]) => {
    const before = new Map(entries.current.map(e => [e.seq, e]))
    entries.current = next
    const says = (e: OutboxEntry) => { const c = callerSays.current.get(e.operationId); return Boolean(c && ((c.stale && e.held?.stale) || c.inline?.test(e.held?.message ?? e.held?.reason ?? ''))) }
    const back = next.filter(e => e.state === 'held' && !e.app && before.get(e.seq)?.state === 'pending' && (drawn(e.seq) || drawRule[e.action.type] !== 'own')
      && !says(e) && !announced.current.has(`${e.owner}:${e.operationId}`))
    const live = new Set(next.map(e => e.seq))
    for (const seq of drawAhead.current) if (!live.has(seq)) drawAhead.current.delete(seq)
    const ops = new Set(next.map(e => e.operationId))
    for (const op of takenBackBy.current.keys()) if (!ops.has(op)) takenBackBy.current.delete(op)
    for (const op of callerSays.current.keys()) if (!ops.has(op)) callerSays.current.delete(op)
    if (!back.length) return
    showOutbox()
    for (const e of back) {
      announced.current.add(`${e.owner}:${e.operationId}`)
      // The caller says it if it's still on screen; otherwise (it closed, or this is a reload) the notice does.
      if (!takenBackBy.current.get(e.operationId)?.(e)) toast(takenBackText(e), { timeout: 6000 })
    }
  }, [showOutbox]) // eslint-disable-line react-hooks/exhaustive-deps
  // After a send that didn't land, try again on its own: 2 s, 5 s, 15 s, then every 30 s, without waiting for `online`,
  // which a dead connection never fires (Jazz 8887e299).
  const retryStep = useRef(0), retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const drainRef = useRef<(() => Promise<void>) | undefined>(undefined)
  const retryLater = useCallback(() => {
    if (retryTimer.current) return
    const delay = [2000, 5000, 15000][retryStep.current] ?? 30000
    retryStep.current++
    retryTimer.current = setTimeout(() => { retryTimer.current = undefined; if (entries.current.some(e => e.state === 'pending')) void drainRef.current?.() }, delay)
  }, [])
  /** Answers for this tab's own changes, sent by whichever of its drains got to them first; read once by the change's own job. */
  const ownJobs = useRef(new Set<number>()), outcomes = useRef(new Map<number, SendAnswer>())
  /** Callers waiting to hear what became of a change kept for later (RunOptions.onLater), by seq. */
  const later = useRef(new Map<number, (landed: boolean) => void>())
  const settleLater = useCallback((queue: readonly OutboxEntry[], answers?: ReadonlyMap<number, SendAnswer>) => {
    for (const [seq, tell] of [...later.current]) {
      const answer = answers?.get(seq), now = queue.find(e => e.seq === seq)
      const landed = answer ? answer.status === 'applied' || answer.status === 'already-applied' : !now ? true : now.state === 'held' ? false : null
      if (landed === null) continue
      later.current.delete(seq)
      tell(landed)
    }
  }, [])
  /**
   * The only way anything is sent from the outbox (Lead 150bd86f): under the owner's lock, the owner's stored queue is
   * drained in `seq` order by `drainQueue`, whichever tab stored each change. Every trigger comes here: open, a return
   * to the tab, the retry timer, Discard, Keep mine, a new change.
   */
  const drainLocked = useCallback(async (owner: string): Promise<DrainResult> => {
    const s = store.current!
    const work = () => drainQueue(s, owner, async entry => {
      inFlight.current.add(entry.seq!)
      try {
        const answer = await transport.runOutbox!(wsRef.current!, entry)
        if (answer.status === 'applied') adopt(answer.workspace)
        return answer
      } finally { inFlight.current.delete(entry.seq!) }
    }, takeQueue)
    try {
      // One tab sends an owner's changes at a time; without Web Locks two may send one, and its receipt answers the second (§7).
      const result = typeof navigator !== 'undefined' && navigator.locks ? await navigator.locks.request(`daythread-outbox:${owner}`, work) : await work()
      for (const [seq, answer] of result.answers) if (ownJobs.current.has(seq)) outcomes.current.set(seq, answer)
      settleLater(result.queue, result.answers)
      if (result.answers.size) { netAway.current = false; retryStep.current = 0 }
      const stop = result.stop?.answer
      if (stop?.status === 'offline') { netAway.current = true; retryLater() }
      else if (stop?.status === 'failed') retryLater()
      else if (stop?.status === 'missing') legacy.current = true
      return result
    } finally { showOutbox() }
  }, [transport, adopt, showOutbox, retryLater, settleLater, takeQueue])

  /** A change of his, stored in this tab: drained with the rest, and its own answer made what `transport.run` would have returned, or an `OutboxStop`. */
  const sendOwn = useCallback(async (entry: OutboxEntry, stale?: RunOptions['stale']): Promise<{ workspace: Workspace; receipt: Receipt }> => {
    const seq = entry.seq!, keptBefore = kept.current.has(seq)
    try {
      const result = outcomes.current.has(seq) ? null : await drainLocked(entry.owner)
      const answer = outcomes.current.get(seq)
      outcomes.current.delete(seq)
      if (answer) switch (answer.status) {
        // What every change sent so far has landed on: the drain adopted each in turn.
        case 'applied': return { workspace: wsRef.current ?? answer.workspace, receipt: answer.receipt }
        case 'already-applied': throw new OutboxStop('done')
        case 'held':
          // Made just now, held only because the workspace moved on, and its caller rebuilds or answers it itself: given back.
          if (answer.stale && stale && !keptBefore) throw new OutboxStop('held', 'Saved elsewhere', true)
          throw entry.app ? new OutboxStop('done') : new OutboxStop('held', answer.message ?? answer.reason)
        default: break
      }
      const now = entries.current.find(e => e.seq === seq)
      // Sent by another tab's drain, or discarded there.
      if (!now) throw new OutboxStop('done')
      if (now.state === 'held') throw new OutboxStop('held', now.held?.message ?? now.held?.reason)
      kept.current.add(seq)
      if (schedule(entries.current).waiting.has(seq)) throw new OutboxStop('waiting')
      const stop = result?.stop?.answer
      switch (stop?.status) {
        case 'failed': throw new OutboxStop('failed', stop.message)
        case 'owner-mismatch': throw new OutboxStop('owner')
        case 'missing': {
          // An older build is serving (a rollback). A stored change waits for a server that can check it (§11, Ratchet
          // c8c0f6f9); only one he made just now, in this tab, goes as before, as it would have without the outbox.
          if (keptBefore) throw new OutboxStop('offline')
          const sent = await transport.run(wsRef.current!, entry.action, entry.operationId)
          await store.current!.remove(seq); entries.current = entries.current.filter(e => e.seq !== seq); kept.current.delete(seq)
          return sent
        }
        default: throw new OutboxStop('offline')
      }
    } finally { ownJobs.current.delete(seq); showOutbox() }
  }, [transport, drainLocked, showOutbox])

  /**
   * A change given back to its caller leaves the outbox, in one transaction with what replaces it (or nothing, when its
   * caller is done with it), every change waiting on it being held (Lead bd4cc39e, Ratchet 6804fae5). Nothing else, no
   * timer, takes it out. The replacement's seq, or null.
   */
  const handOff = useCallback(async (token: Pick<Handoff, 'seq' | 'owner'>, replacement: OutboxEntry | null): Promise<number | null | 'not-held'> => {
    const s = store.current, { seq, owner } = token
    if (!s) return null
    // A rebuild is his change for the account it was given back under, or nothing.
    if (replacement && replacement.owner !== owner) return 'not-held'
    try {
      // Under the owner's lock, as every send is: never while another tab's drain is waiting on this original (Ratchet 23351123).
      const work = () => s.handOff(seq, owner, replacement)
      const at = typeof navigator !== 'undefined' && navigator.locks ? await navigator.locks.request(`daythread-outbox:${owner}`, work) : await work()
      handedBack.current.delete(seq)
      if (owner === knownOwner) { takeQueue((await s.all()).filter(e => e.owner === owner)); settleLater(entries.current) }
      return at
    } finally { showOutbox() }
  }, [showOutbox, settleLater, takeQueue])

  /** Once the owner is known (the first load, or the offline copy's), this owner's stored changes join the tab, before they're shown. */
  const takeStored = useCallback(async (owner: string | null) => {
    const all = storedAtMount.current
    if (!all || !owner) return
    storedAtMount.current = null
    const mine = (await all).filter(e => e.owner === owner)
    for (const e of mine) kept.current.add(e.seq!)
    entries.current = [...mine, ...entries.current.filter(e => !mine.some(m => m.seq === e.seq))]
    // The counts the banners read (an offline open shows "1 change will be sent" from its first paint).
    if (mine.length) showOutbox()
  }, [showOutbox])
  const refresh = useCallback(async (triggerOperationId?: string) => {
    const operationId=newOperationId(),started=performance.now()
    debugClient('workspace.refresh.start',{operationId,triggerOperationId})
    try { const next=await transport.load(operationId,triggerOperationId)
      // A load can be overtaken by a command that finished while it was in flight (he typed and it saved): its older
      // snapshot must not replace the newer one, or the editor would roll his text back (Ratchet #95).
      if (wsRef.current && next.revision < wsRef.current.revision) { debugClient('workspace.refresh.finish',{operationId,triggerOperationId,afterRevision:next.revision,elapsedMs:performance.now()-started,result:'stale'}); return wsRef.current }
      await takeStored(knownOwner)
      adopt(next); setOffline(false); debugClient('workspace.refresh.finish',{operationId,triggerOperationId,afterRevision:next.revision,elapsedMs:performance.now()-started,result:'ok'}); return next }
    catch(error) { debugClient('workspace.refresh.finish',{operationId,triggerOperationId,elapsedMs:performance.now()-started,result:'error',error:error instanceof Error?error.name:'UnknownError'}); throw error }
  }, [transport, adopt, takeStored])

  /** Sends every pending change of this owner, in order, through the queue (§6): on open, back online, Retry, Discard. */
  const drain = useCallback((first = false): Promise<void> => {
    const go = async () => {
      const owner = knownOwner
      if (!store.current || !transport.runOutbox || !owner) return
      const result = await drainLocked(owner)
      if (result.stop?.answer.status === 'owner-mismatch') { reloadRef.current?.(); return }
      if (result.answers.size) retireStaleUndo(wsRef.current!)
      // A change held or found already there: the latest is loaded, so the screen shows what the server has.
      if ([...result.answers.values()].some(a => a.status !== 'applied')) { try { await refresh() } catch { /* offline */ } }
    }
    const chain = (first ? Promise.resolve() : queue.current).then(go).catch(() => undefined)
    if (!first) queue.current = chain
    showOutbox()
    return chain
  }, [transport, drainLocked, refresh, showOutbox])
  drainRef.current = () => drain()
  // Stored changes first, then the queue opens for everything else (Jazz ef6b418a).
  const openAfterDrain = useCallback(() => {
    const open = openQueue.current
    openQueue.current = () => undefined
    void drain(true).finally(open)
  }, [drain])
  const reloadRef = useRef<(() => void) | undefined>(undefined)
  const gateOpen = useRef(!store.current)

  const reload = useCallback(() => {
    setLoadError(null)
    void refresh().then(async () => {
      legacy.current = false; netAway.current = false
      if (!gateOpen.current) {
        gateOpen.current = true; openAfterDrain()
        // No hint: nothing was stored, as far as this device knew. A look after the paint, in case the hint was lost
        // (storage cleared but not IndexedDB): what it finds is shown and sent then.
        if (store.current && !outboxHint.get() && !entries.current.length) {
          const found = (await store.current.all().catch(() => [])).filter(e => e.owner === knownOwner)
          if (found.length) { for (const e of found) kept.current.add(e.seq!); entries.current = [...found, ...entries.current]; outboxHint.set(); showOutbox(); void drain() }
        }
      } else void drain()
    }, async (e: unknown) => {
      // No network: the last-loaded copy opens the app, read as it was; any other failure is shown as before.
      const copy = await offlineCopy.fallback(e)
      if (copy && !knownOwner) noteOwner(await offlineCopy.recallOwner())
      await takeStored(knownOwner)
      // Offline: nothing can be sent; the queue opens so he can work, and his changes wait, stored (§8.2).
      if (!gateOpen.current) { gateOpen.current = true; openQueue.current(); openQueue.current = () => undefined }
      if (copy && (!wsRef.current || copy.revision >= wsRef.current.revision)) {
        adopt(copy); setOffline(true)
        debugClient('workspace.offline-copy', { afterRevision: copy.revision })
      } else if (copy && wsRef.current) setOffline(true)
      else setLoadError(e instanceof Error ? e.message : String(e))
    })
  }, [refresh, adopt, takeStored, openAfterDrain, drain])
  reloadRef.current = reload

  useEffect(reload, [reload])
  // The connection back: load again, and the offline line goes with the load.
  useEffect(() => {
    window.addEventListener('online', reload)
    return () => window.removeEventListener('online', reload)
  }, [reload])

  // An open tab only learns of edits made elsewhere (another tab, the phone) when it loads again. Coming back to the
  // tab loads again, after saving what was typed here, so the refresh never lands on unsaved typing. If that save is
  // refused (the page changed elsewhere), the editor already shows "changed elsewhere · draft kept" and nothing loads
  // over it. At most once every 5s.
  useEffect(() => {
    let last = 0, running = false
    const onVisible = async () => {
      if (document.visibilityState !== 'visible' || running || Date.now() - last < 5000) return
      running = true; last = Date.now()
      try {
        // Changes kept on the device go as soon as he's back, whatever the network events said (Jazz 8887e299).
        if (store.current && knownOwner) {
          // Another tab may have sent, held or discarded changes meanwhile: take the stored queue as it is, then send.
          const owner = knownOwner
          takeQueue((await store.current.all().catch(() => entries.current)).filter(e => e.owner === owner))
          showOutbox()
        }
        if (entries.current.some(e => e.state === 'pending')) { netAway.current = false; void drainRef.current?.() }
        if (!(await flushAllEditors())) return
        await queue.current
        await refresh()
      } catch { /* offline: the next action resyncs */ } finally { running = false }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); window.removeEventListener('pageshow', onVisible) }
  }, [refresh, showOutbox])

  useEffect(() => {
    if (saveState !== 'saved') return
    const t = setTimeout(() => setSaveState('idle'), 2000)
    return () => clearTimeout(t)
  }, [saveState])

  // Open toasts that offer Undo, by toast key. The domain keeps one undo slot, so a later change retires them.
  const undoToasts = useRef(new Map<string, string>())
  const retireStaleUndo = useCallback((ws: Workspace) => {
    for (const [key, operationId] of undoToasts.current)
      if (ws.undo?.operationId !== operationId) toast.close(key)
  }, [])

  const runRef = useRef<WorkspaceContextValue['run'] | null>(null)
  const push = useCallback((spec: Notice) => {
    const { text, undoOperationId, extra } = spec
    const close = () => toast.close(key)
    const undo = undoOperationId && {
      children: 'Undo',
      onPress: () => {
        close()
        if (wsRef.current?.undo?.operationId === undoOperationId)
          void runRef.current?.({ type: 'undo', targetOperationId: undoOperationId }, { text: 'Undone' }, undefined, { stale: 'outcome', inlineRefusal: /Cannot undo|Saved elsewhere/, onRefused: () => toast("Can't undo · edited since", { timeout: 6000 }) })
      },
    }
    const other = extra && { children: extra.label, onPress: () => { close(); extra.run() } }
    // A toast has one action button; when there are two, the extra one sits under the text.
    const key: string = toast(text, {
      timeout: 8000,
      actionProps: undo || other || undefined,
      description: undo && other ? <Button size="sm" variant="ghost" className="toast-extra" onPress={other.onPress}>{other.children}</Button> : undefined,
      onClose: () => undoToasts.current.delete(key),
    })
    if (undoOperationId) undoToasts.current.set(key, undoOperationId)
  }, [])


  const run = useCallback(
    (source: ActionSource, notice?: NoticeArg, operationId = newOperationId(), options: RunOptions = {}) => {
      commandsOut++
      // §4.2: a change that isn't drawn before the answer shows on the control he pressed that it's working, and takes no second press.
      const pressed = justPressed()
      let endWorking: (() => void) | null = null
      const working = (action: Action | null | undefined, drawnNow: boolean) => {
        if (pressed && action && !endWorking && drawRule[action.type] !== 'own' && !drawnNow) endWorking = markWorking(pressed)
      }
      // B98: built and stored now, against the predicted workspace, unless it's page text (the editor keeps its own drafts) or there's no outbox here.
      const owner = knownOwner, base = wsRef.current
      let stored: Promise<OutboxEntry | null> = Promise.resolve(null), built: Action | null | undefined, storeFailed = false, superseded = false
      if (store.current && durable.current && !legacy.current && owner && base) {
        const ahead = predicted() ?? base
        built = typeof source === 'function' ? source(ahead) : source
        working(built, Boolean(built && drawsAhead(built)))
        if (built && built.type !== 'save-editor') {
          const { entry } = capture(ahead, built, operationId, entries.current.some(e => e.action.type === 'undo'))
          const full: OutboxEntry = { ...entry, owner, baseRevision: base.revision, ownRevisions: [], createdAt: Date.now(), state: 'pending', ...(appWrites.has(built.type) ? { app: true } : {}) }
          // The rebuild of a change given back takes its place in one transaction; if storing it fails, the original stays.
          // Not held any more (another tab chose Keep mine on it): it goes on as it is, and this rebuild isn't sent too.
          const adding = options.replaces ? handOff(options.replaces, full).then(seq => { if (seq === 'not-held') { superseded = true; throw new Error('superseded') } if (seq === null) throw new Error('not stored'); return seq }) : store.current.add(full)
          stored = adding.then(async seq => {
            outboxHint.set()
            ownJobs.current.add(seq)
            if (drawsAhead(full.action)) drawAhead.current.add(seq)
            // Its caller's own word, kept as long as the change is in the queue (it may be held on a later send).
            if (options.onTakenBack) takenBackBy.current.set(operationId, options.onTakenBack)
            if (options.stale || options.inlineRefusal) callerSays.current.set(operationId, { stale: Boolean(options.stale), ...(options.inlineRefusal ? { inline: options.inlineRefusal } : {}) })
            const kept = { ...full, seq }
            options.onStored?.()
            // A drain in another tab may have read it into this tab's list already.
            if (!entries.current.some(e => e.seq === seq)) entries.current = [...entries.current, kept]
            if (navigator.storage?.persist && entries.current.length === 1) void navigator.storage.persist().catch(() => undefined)
            showOutbox()
            return kept
          }, () => { if (superseded) return null; storeFailed = true; durable.current = false; showOutbox(); return null })
        }
      }
      const job = queue.current.then(async (): Promise<Receipt | null> => {
        const current = wsRef.current
        if (!current) return null
        const entry = await stored
        if (superseded) return null
        // A rebuild with nothing to send: its caller has its outcome. One that failed to be stored leaves the original
        // until it lands (below).
        if (options.replaces && !entry && !storeFailed && !built) void options.replaces.done()
        const action = built !== undefined ? built : typeof source === 'function' ? source(current) : source
        if (!action) return null
        // Not stored (no device storage): nothing is drawn ahead, so it waits like the rest.
        working(action, Boolean(entry && drawsAhead(action)))
        if (!options.quiet) setSaveState('saving')
        // §8.4: where nothing could be stored, say so only if it's still on its way after a second.
        const risk = !entry && !durable.current ? setTimeout(() => { slowUnsent.current = true; showOutbox() }, 1000) : undefined
        void job.finally(() => { if (risk) { clearTimeout(risk); if (commandsOut <= 1) { slowUnsent.current = false; showOutbox() } } }).catch(() => undefined)
        const started=performance.now()
        const fields={operationId,command:action.type,beforeRevision:current.revision,...('pageId' in action?{pageId:action.pageId}:{}),...('taskId' in action?{taskId:action.taskId}:{})}
        debugClient('command.request',fields)
        try {
          const result = entry ? await sendOwn(entry, options.stale) : await transport.run(current, action, operationId)
          // A rebuild that couldn't be stored went as before and landed: the change it replaces is done with.
          if (options.replaces && !entry) await options.replaces.done()
          if (!entry && !durable.current && memoryUnsent.current.delete(operationId)) showOutbox()
          adopt(result.workspace)
          retireStaleUndo(result.workspace)
          debugClient('command.response',{...fields,afterRevision:result.workspace.revision,elapsedMs:performance.now()-started,result:'ok'})
          setSaveState('saved')
          setSaveError(null)
          setLastFailed(null)
          commandFailedOut = false
          const spec = typeof notice === 'function' ? notice(result.receipt) : notice
          const rules = result.receipt.automations
          // What rules did goes on the notice his change already has, with its one Undo: "Moved to Done · Log finish · Undo" (automations.md §5).
          if (rules?.scheduled) { if (rules.paused.length) push(scheduledFailure(rules)); else if (spec) push(spec) }
          else if (rules && (rules.ran.length || rules.paused.length)) push(withRules(spec ?? { text: result.receipt.message }, rules, result.receipt.operationId))
          else if (spec) push(spec)
          return result.receipt
        } catch (e) {
          if (e instanceof OutboxStop) {
            setSaveState('idle')
            if (e.handedBack && entry) {
              // Given back (RunOptions.stale): kept and unshown until its caller replaces it or is done with it.
              const seq = entry.seq!
              handedBack.current.add(seq); showOutbox()
              debugClient('command.response', { ...fields, elapsedMs: performance.now() - started, result: 'refused', error: 'outbox-handed-back' })
              // The latest first, so what the caller builds again is built on it.
              try { await refresh(operationId) } catch { /* offline */ }
              let finished: Promise<void> | null = null
              const token = { seq, owner: entry.owner }
              const handoff: Handoff = { ...token, done: () => (finished ??= handOff(token, null).then(() => undefined, () => undefined)) }
              options.onRefused?.('Saved elsewhere', handoff)
              // Its own word said in place ("Can't undo · edited since"): that's its outcome.
              if (options.stale === 'outcome') await handoff.done()
              return null
            }
            // Kept to be sent later: its caller hears what became of it (RunOptions.onLater).
            if (entry && (e.kind === 'offline' || e.kind === 'failed' || e.kind === 'waiting') && (options.onKept || options.onLater)) {
              if (options.onLater) later.current.set(entry.seq!, options.onLater)
              options.onKept?.()
            }
            if (e.kind === 'held' && options.inlineRefusal?.test(e.detail ?? '')) {
              // A refusal shown in place (Undo's "Can't undo"): nothing to keep (Jazz acdfa91).
              if (entry) { await store.current?.remove(entry.seq!); entries.current = entries.current.filter(x => x.seq !== entry.seq); showOutbox() }
              options.onRefused?.((e.detail ?? '').match(options.inlineRefusal)![0])
            } else if (e.kind === 'held') {
              options.onHeld?.(e.detail ?? '')
            } else if (e.kind === 'failed') {
              setSaveState('failed'); setSaveError(e.detail ?? 'Not saved'); setLastFailed({ action, notice, operationId }); commandFailedOut = !durable.current
            } else if (e.kind === 'owner') reloadRef.current?.()
            debugClient('command.response', { ...fields, elapsedMs: performance.now() - started, result: e.kind === 'done' ? 'replay' : 'error', error: `outbox-${e.kind}` })
            if (e.kind === 'held' || e.kind === 'done') { try { await refresh(operationId) } catch { /* offline */ } }
            return null
          }
          const message = e instanceof Error ? e.message : String(e)
          // Not saved and kept only here (a refusal shown in place, like "Can't undo", isn't a change at risk).
          if (!entry && !durable.current && !options.inlineRefusal?.test(message)) { memoryUnsent.current.add(operationId); showOutbox() }
          // A refusal the caller shows in place (e.g. "Can't undo · edited since"): nothing failed to save, so no red
          // bar and no Retry, which could only fail again (Jazz acdfa91).
          if (options.inlineRefusal?.test(message)) {
            setSaveState('saved')
            debugClient('command.response',{...fields,elapsedMs:performance.now()-started,result:'refused'})
            options.onRefused?.(message.match(options.inlineRefusal)![0])
            try { await refresh(operationId) } catch { /* offline: the next action resyncs */ }
            return null
          }
          // What the user typed stays on screen; the header shows the failure with Retry.
          if (!options.quiet) {
            setSaveState('failed')
            setSaveError(message)
            setLastFailed({ action, notice, operationId })
            commandFailedOut = true
          }
          options.onFailure?.(message)
          debugClient('command.response',{...fields,elapsedMs:performance.now()-started,result:isConflict(message)?'conflict':'error',error:e instanceof Error?e.name:'UnknownError'})
          // Resync before any retry: a stale revision would otherwise fail forever. Screens keep
          // their local edits and re-derive from the latest data; nothing is re-sent automatically.
          try {
            await refresh(operationId)
          } catch {
            // Still offline; Retry will try the load again through the same path.
          }
          return null
        }
      })
      queue.current = job.catch(() => undefined)
      // A caller rebuilds or refuses in place only while its run is out; after that a later hold is said like any other.
      void job.finally(() => { commandsOut--; endWorking?.(); callerSays.current.delete(operationId) }).catch(() => undefined)
      return job
    },
    [transport, adopt, push, refresh, retireStaleUndo, predicted, sendOwn, showOutbox, handOff],
  )
  runRef.current = run

  const [ticks, setTicks] = useState<Ticks>(() => new Map())
  // The guard reads the ref, so a second tap before React re-renders is still ignored.
  const ticksRef = useRef<Ticks>(ticks)
  const tickToken = useRef(0)
  const lastTap = useRef(new Map<string, number>())
  const updateTicks = useCallback((next: (ticks: Ticks) => Ticks) => { ticksRef.current = next(ticksRef.current); setTicks(ticksRef.current) }, [])
  /** Sends a tick through the B72 lifecycle: shown at once, other taps ignored while it saves, then the row's hold. */
  const runTick = useCallback((action: Extract<Action, { type: 'task-status' }> & { status: TickStatus }, notice?: NoticeArg, operationId?: string) => {
    const { taskId } = action
    // A second tap within 500 ms is the same tap (B72: his real double taps, 282b1ba1). After that, with the outbox, a tap
    // during a tick's send is its own change, built on what the screen shows (B98 item 2, Bumblebee d538310b); without
    // one, it waits for the send as before.
    const now = Date.now(), last = lastTap.current.get(taskId)
    if (last !== undefined && now - last < doubleTapMs) return
    if (isSaving(ticksRef.current, taskId) && !(store.current && durable.current && !legacy.current)) return
    lastTap.current.set(taskId, now)
    const tick: Tick = { to: action.status, phase: 'saving', token: ++tickToken.current }
    updateTicks(t => withTick(t, taskId, tick))
    void run(action, notice, operationId).then(receipt => {
      // A failed save shows the stored state again, and the header's error says why.
      if (!receipt) return updateTicks(t => settleTick(t, taskId, tick.token, null))
      updateTicks(t => settleTick(t, taskId, tick.token, { ...tick, phase: 'holding' }))
      setTimeout(() => updateTicks(t => settleTick(t, taskId, tick.token, null)), HOLD_MS)
    })
  }, [run, updateTicks])
  const toggleTask = useCallback((taskId: string, notice: (to: Task['status'], r: Receipt) => NoticeSpec) => {
    // B98 (Bumblebee ec4ab466): a tick kept on the device and shown is what the next tap undoes, so it queues the reverse.
    // Built on what the screen shows: every change of this tab still on its way, in flight or kept (B98 item 2).
    const task = (predicted() ?? wsRef.current)?.tasks.find(t => t.id === taskId)
    const to = task && (entries.current.some(e => e.state === 'pending' && (e.action as { taskId?: string }).taskId === taskId) ? (task.status === 'done' ? 'open' : 'done') : tapTarget(ticksRef.current, task))
    if (to) runTick({ type: 'task-status', taskId, status: to, today: todayIso() }, r => notice(to, r))
  }, [runTick, predicted])

  const retry = useCallback(() => {
    if (!lastFailed) return
    const { action, notice, operationId } = lastFailed
    debugClient('command.retry',{operationId,command:action.type})
    // A stored change is resent as it is, never made again (§5).
    if (entries.current.some(e => e.operationId === operationId)) { setLastFailed(null); setSaveState('idle'); void drain(); return }
    // B72 (Ratchet 4bae2184): a retried tick is a tick too, same operation id, so it gets the same guard and hold.
    if (action.type === 'task-status' && (action.status === 'done' || action.status === 'open')) runTick({ ...action, status: action.status }, notice, operationId)
    else void run(action, notice, operationId)
  }, [lastFailed, run, runTick])

  const addSampleData = useCallback(async () => {
    for (const action of sampleActions(todayIso())) if (!(await run(action))) return
    push({ text: 'Sample data added' })
  }, [run, push])

  /** §6, §8.3: the held change dropped; what waited on it is tried again. */
  const discardHeld = useCallback(async () => {
    const { held } = outboxCounts(entries.current)
    if (!held) return
    await store.current?.remove(held.seq!)
    entries.current = entries.current.filter(e => e.seq !== held.seq)
    later.current.get(held.seq!)?.(false); later.current.delete(held.seq!)
    showOutbox()
    try { await refresh() } catch { /* offline */ }
    void drain()
  }, [showOutbox, refresh, drain])
  /** §6 "Apply mine anyway", Jazz's "Keep mine": sent again on the latest revision, by his choice; a conflict only. */
  const keepMine = useCallback(async () => {
    const { held } = outboxCounts(entries.current)
    if (!held || !wsRef.current || (held.held?.reason !== 'conflict' && held.held?.reason !== 'changed-since' && held.held?.reason !== 'maybe-applied')) return
    // His values over what's there now: a cell's edit is checked against the cells as they are (gate 4d6fbafe).
    const ws = wsRef.current, now = (edit: RowEdit): RowEdit => {
      const row = ws.pages.find(p => p.id === edit.pageId)
      return row ? { ...edit, expected: Object.fromEntries(Object.keys(edit.expected ?? {}).map(k => [k, (rawOf(row, k) ?? null) as Json])) } : edit
    }
    const a = held.action
    const action = a.type === 'set-values' ? { ...a, ...now(a) } : a.type === 'set-values-many' ? { ...a, items: a.items.map(now) } : a
    const patch = { state: 'pending' as const, baseRevision: ws.revision, ownRevisions: [] as number[], action }
    await store.current?.update(held.seq!, { ...patch, held: undefined })
    entries.current = entries.current.map(e => (e.seq === held.seq ? { ...e, ...patch, held: undefined } : e))
    void drain()
  }, [drain])
  // The browser's own word on the network changes what the banners say (§8.2).
  useEffect(() => {
    const changed = () => showOutbox()
    window.addEventListener('offline', changed); window.addEventListener('online', changed)
    return () => { window.removeEventListener('offline', changed); window.removeEventListener('online', changed) }
  }, [showOutbox])
  // Only where nothing could be stored is a change at risk on leaving (Lead 87eca3cf; §8.4).
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (!durable.current && (commandsPending() || memoryUnsent.current.size > 0)) e.preventDefault() }
    window.addEventListener('beforeunload', before)
    return () => window.removeEventListener('beforeunload', before)
  }, [])

  /** Sign-out (§7, §8.5): sends what it can; how many changes are still only on this device. */
  const settleOutbox = useCallback(async (): Promise<number> => {
    if (navigator.onLine !== false) await drain()
    return entries.current.length
  }, [drain])
  /** Sign-out and Delete account, after he confirmed: this account's changes leave the device. */
  const clearOutbox = useCallback(async () => {
    if (knownOwner) await store.current?.clearOwner(knownOwner).catch(() => undefined)
    entries.current = []
    showOutbox()
  }, [showOutbox])

  const latest = useCallback(() => wsRef.current, [])
  const value = useMemo(
    () => ({
      workspace,
      latest,
      loadError,
      offline,
      saveState,
      saveError,
      failedAction: lastFailed?.action.type ?? null,
      run,
      retry,
      reload,
      refresh,
      addSampleData,
      ticks,
      toggleTask,
      outbox,
      discardHeld,
      keepMine,
      settleOutbox,
      clearOutbox,
    }),
    [workspace, latest, loadError, offline, saveState, saveError, lastFailed, run, retry, reload, refresh, addSampleData, ticks, toggleTask, outbox, discardHeld, keepMine, settleOutbox, clearOutbox],
  )
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}
/** The workspace, or null with no provider above: a block's copy for the clipboard may render outside the app. */
export function useWorkspaceIfAny(): Workspace | null {
  return useContext(WorkspaceContext)?.workspace ?? null
}

/** A to-do's box: what it shows (the tap at once, while it saves) and the tap. Reads the stored to-do, not a held copy. */
export function useTaskTick(taskId: string | undefined): { status: Task['status'] | undefined; toggle(notice: (to: Task['status'], r: Receipt) => NoticeSpec): void } {
  const { workspace, ticks, toggleTask } = useWorkspace()
  const task = taskId ? workspace?.tasks.find(t => t.id === taskId) : undefined
  return { status: task && shownStatus(ticks, task), toggle: notice => taskId && toggleTask(taskId, notice) }
}

/** The workspace for lists a to-do leaves on Done: a ticked one keeps its place until its hold ends (task-ticks.ts). */
export function useHeldWorkspace(): Workspace | null {
  const { workspace, ticks } = useWorkspace()
  return useMemo(() => (workspace ? heldWorkspace(workspace, ticks) : null), [workspace, ticks])
}

export function useDay(date: LocalDate): { view: DayView | null; workspace: Workspace | null } {
  const { workspace } = useWorkspace()
  const view = useMemo(() => (workspace ? getDayView(workspace, date) : null), [workspace, date])
  return { view, workspace }
}
