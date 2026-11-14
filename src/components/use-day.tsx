// The only place screens touch data: loadWorkspace()/runCommand() on the local server
// (src/server/functions.ts). getDayView is a pure read of the loaded workspace.
import { Button, toast } from '@heroui/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Action, DayView, LocalDate, Receipt, Task, Workspace } from '../domain/types'
import { applyCommand, getDayView } from '../domain/workspace'
import { replyWorkspace } from './command-reply'
import { loadWorkspace, runCommand, runOutboxCommand } from '../server/functions'
import { capture, dependsOn, idbOutboxStore, type HeldReason, type OutboxEntry, type OutboxStore } from './outbox'
import { isNetworkFailure } from './offline-copy'
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
export type OutboxAnswer =
  | { status: 'applied'; workspace: Workspace; receipt: Receipt }
  | { status: 'already-applied' }
  | { status: 'held'; reason: HeldReason; message?: string }
  | { status: 'owner-mismatch' }
  | { status: 'offline' }
  | { status: 'missing' }
  | { status: 'failed'; message: string }

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
    if (answer.status === 'held') return { status: 'held', reason: answer.reason }
    if (answer.status === 'refused') return { status: 'held', reason: /not found|gone|no longer/i.test(answer.message) ? 'gone' : 'refused', message: answer.message }
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
  constructor(kind: OutboxStop['kind'], detail?: string) { super(`Outbox: ${kind}`); this.name = 'OutboxStop'; this.kind = kind; if (detail !== undefined) this.detail = detail }
}
/** What the banners read (outbox.md §8): changes kept and not yet sent, the oldest held one, what waits on it. */
export interface OutboxView {
  pending: number; held: OutboxEntry | null; waiting: number; durable: boolean; keptBack: boolean
  /** A change couldn't be sent for lack of network, or the browser says it's offline (§8.2). */
  offline: boolean
  /** Not durable and a change still unsent after a second, or after a failed send (§8.4, Jazz 3c65a099): never a flash on every change. */
  atRisk: boolean
}
const emptyOutbox: OutboxView = { pending: 0, held: null, waiting: 0, durable: true, keptBack: false, offline: false, atRisk: false }

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
type RunOptions = { inlineRefusal?: RegExp; onRefused?: (message: string) => void; /** The failure's message, for a caller that retries by itself (B35). */ onFailure?: (message: string) => void; /** B40: a background save; its failure says so in its own line, never the header's bar and Retry. */ quiet?: boolean }

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
  const store = useRef<OutboxStore | null>(transport.runOutbox && typeof indexedDB !== 'undefined' ? idbOutboxStore() : null)
  const entries = useRef<OutboxEntry[]>([])
  /** Entries shown as made: stored before this load, or left after a send that didn't land. */
  const kept = useRef(new Set<number>())
  const durable = useRef(true), legacy = useRef(false), inFlight = useRef(new Set<number>())
  /** The last send failed for lack of network; cleared by the next one that gets through. */
  const netAway = useRef(false), slowUnsent = useRef(false)
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
      if (e.state !== 'pending' || e.action.type === 'undo' || (shown && !kept.current.has(e.seq!))) continue
      try { ws = applyCommand(ws, { operationId: e.operationId, expectedRevision: ws.revision, action: e.action }).workspace } catch { /* the server will say */ }
    }
    return ws
  }, [])
  // B98: until the first load's stored changes are sent, nothing else is (the app's own writes on open wait: Jazz ef6b418a).
  const openQueue = useRef<() => void>(() => undefined)
  const queue = useRef<Promise<unknown>>(store.current ? new Promise<void>(resolve => { openQueue.current = resolve }) : Promise.resolve())
  const storedAtMount = useRef<Promise<OutboxEntry[]> | null>(store.current ? store.current.all().catch(() => { durable.current = false; return [] }) : null)

  /** The server's workspace; what's shown has his pending changes on top, so a tick never shows unticked first (Jazz §8.1). */
  const adopt = useCallback((ws: Workspace) => {
    wsRef.current = ws
    setWorkspace(entries.current.some(e => e.state === 'pending' && kept.current.has(e.seq!)) ? predicted(true) ?? ws : ws)
  }, [predicted])
  const showOutbox = useCallback(() => {
    const held = entries.current.find(e => e.state === 'held') ?? null
    const pending = entries.current.filter(e => e.state === 'pending')
    const away = netAway.current || (typeof navigator !== 'undefined' && navigator.onLine === false)
    setOutbox({ pending: pending.length, held, waiting: held ? pending.filter(e => e.seq! > held.seq! && dependsOn(e, held)).length : 0, durable: durable.current, keptBack: legacy.current && pending.length > 0, offline: away && pending.length > 0, atRisk: !durable.current && (slowUnsent.current || (away && commandsPending())) })
    if (pending.some(e => kept.current.has(e.seq!))) { const shown = predicted(true); if (shown) setWorkspace(shown) } else if (wsRef.current) setWorkspace(wsRef.current)
  }, [predicted])
  /** Sends one stored entry and makes its answer what `transport.run` would have returned, or an `OutboxStop`. */
  const sendEntry = useCallback(async (entry: OutboxEntry): Promise<{ workspace: Workspace; receipt: Receipt }> => {
    const s = store.current!, seq = entry.seq!
    const held = entries.current.find(h => h.state === 'held' && h.seq! < seq && dependsOn(entry, h))
    if (held) { kept.current.add(seq); throw new OutboxStop('waiting') }
    inFlight.current.add(seq)
    try {
      // One tab sends an owner's changes at a time; without Web Locks two may send one, and its receipt answers the second (§7).
      const send = () => transport.runOutbox!(wsRef.current!, entry)
      const answer = typeof navigator !== 'undefined' && navigator.locks ? await navigator.locks.request(`daythread-outbox:${entry.owner}`, send) : await send()
      const drop = () => { entries.current = entries.current.filter(e => e.seq !== seq) }
      switch (answer.status) {
        case 'applied': {
          netAway.current = false
          await s.acknowledge(seq, entry.owner, answer.receipt.revision)
          drop()
          const r = answer.receipt.revision
          if (r !== undefined) for (const e of entries.current) if (e.seq! > seq && !e.ownRevisions.includes(r)) e.ownRevisions.push(r)
          return { workspace: answer.workspace, receipt: answer.receipt }
        }
        case 'already-applied': await s.acknowledge(seq, entry.owner, undefined); drop(); throw new OutboxStop('done')
        case 'held': {
          const patch = { state: 'held' as const, held: { reason: answer.reason, ...(answer.message ? { message: answer.message } : {}) } }
          await s.update(seq, patch)
          entries.current = entries.current.map(e => (e.seq === seq ? { ...e, ...patch } : e))
          throw new OutboxStop('held', answer.message ?? answer.reason)
        }
        case 'owner-mismatch': throw new OutboxStop('owner')
        case 'offline': kept.current.add(seq); netAway.current = true; throw new OutboxStop('offline')
        case 'failed': kept.current.add(seq); throw new OutboxStop('failed', answer.message)
        case 'missing': {
          // An older build is serving (a rollback). A stored change waits for a server that can check it (§11, Ratchet
          // c8c0f6f9); only one he made just now, in this tab, goes as before, as it would have without the outbox.
          legacy.current = true
          if (kept.current.has(seq)) throw new OutboxStop('offline')
          const result = await transport.run(wsRef.current!, entry.action, entry.operationId)
          await s.remove(seq); drop()
          return result
        }
      }
    } finally { inFlight.current.delete(seq); showOutbox() }
  }, [transport, showOutbox])

  /** Once the owner is known (the first load, or the offline copy's), this owner's stored changes join the tab, before they're shown. */
  const takeStored = useCallback(async (owner: string | null) => {
    const all = storedAtMount.current
    if (!all || !owner) return
    storedAtMount.current = null
    const mine = (await all).filter(e => e.owner === owner)
    for (const e of mine) kept.current.add(e.seq!)
    entries.current = [...mine, ...entries.current.filter(e => !mine.some(m => m.seq === e.seq))]
  }, [])
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
    let chain: Promise<unknown> = first ? Promise.resolve() : queue.current
    for (const e of entries.current) {
      if (e.state !== 'pending' || inFlight.current.has(e.seq!)) continue
      chain = chain.then(async () => {
        const now = entries.current.find(x => x.seq === e.seq)
        if (!now || now.state !== 'pending' || inFlight.current.has(e.seq!)) return
        try { const r = await sendEntry(now); adopt(r.workspace); retireStaleUndo(r.workspace) }
        catch (err) {
          if (err instanceof OutboxStop && (err.kind === 'held' || err.kind === 'done')) { try { await refresh(e.operationId) } catch { /* offline */ } }
          else if (err instanceof OutboxStop && err.kind === 'owner') reloadRef.current?.()
        }
      }).catch(() => undefined)
    }
    if (!first) queue.current = chain
    showOutbox()
    return chain.then(() => undefined)
  }, [sendEntry, adopt, refresh, showOutbox])
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
    void refresh().then(() => { legacy.current = false; if (!gateOpen.current) { gateOpen.current = true; openAfterDrain() } else void drain() }, async (e: unknown) => {
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
        if (!(await flushAllEditors())) return
        await queue.current
        await refresh()
      } catch { /* offline: the next action resyncs */ } finally { running = false }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible) }
  }, [refresh])

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
          void runRef.current?.({ type: 'undo', targetOperationId: undoOperationId }, { text: 'Undone' }, undefined, { inlineRefusal: /Cannot undo|Saved elsewhere/, onRefused: () => toast("Can't undo · edited since", { timeout: 6000 }) })
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
      // B98: built and stored now, against the predicted workspace, unless it's page text (the editor keeps its own drafts) or there's no outbox here.
      const owner = knownOwner, base = wsRef.current
      let stored: Promise<OutboxEntry | null> = Promise.resolve(null), built: Action | null | undefined
      if (store.current && durable.current && !legacy.current && owner && base) {
        const ahead = predicted() ?? base
        built = typeof source === 'function' ? source(ahead) : source
        if (built && built.type !== 'save-editor') {
          const { entry } = capture(ahead, built, operationId, entries.current.some(e => e.action.type === 'undo'))
          const full: OutboxEntry = { ...entry, owner, baseRevision: base.revision, ownRevisions: [], createdAt: Date.now(), state: 'pending' }
          stored = store.current.add(full).then(seq => {
            const kept = { ...full, seq }
            entries.current = [...entries.current, kept]
            if (navigator.storage?.persist && entries.current.length === 1) void navigator.storage.persist().catch(() => undefined)
            showOutbox()
            return kept
          }, () => { durable.current = false; showOutbox(); return null })
        }
      }
      const job = queue.current.then(async (): Promise<Receipt | null> => {
        const current = wsRef.current
        if (!current) return null
        const entry = await stored
        const action = built !== undefined ? built : typeof source === 'function' ? source(current) : source
        if (!action) return null
        if (!options.quiet) setSaveState('saving')
        // §8.4: where nothing could be stored, say so only if it's still on its way after a second.
        const risk = !entry && !durable.current ? setTimeout(() => { slowUnsent.current = true; showOutbox() }, 1000) : undefined
        void job.finally(() => { if (risk) { clearTimeout(risk); if (commandsOut <= 1) { slowUnsent.current = false; showOutbox() } } }).catch(() => undefined)
        const started=performance.now()
        const fields={operationId,command:action.type,beforeRevision:current.revision,...('pageId' in action?{pageId:action.pageId}:{}),...('taskId' in action?{taskId:action.taskId}:{})}
        debugClient('command.request',fields)
        try {
          const result = entry ? await sendEntry(entry) : await transport.run(current, action, operationId)
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
            if (e.kind === 'held' && options.inlineRefusal?.test(e.detail ?? '')) {
              // A refusal shown in place (Undo's "Can't undo"): nothing to keep (Jazz acdfa91).
              if (entry) { await store.current?.remove(entry.seq!); entries.current = entries.current.filter(x => x.seq !== entry.seq); showOutbox() }
              options.onRefused?.((e.detail ?? '').match(options.inlineRefusal)![0])
            } else if (e.kind === 'failed') {
              setSaveState('failed'); setSaveError(e.detail ?? 'Not saved'); setLastFailed({ action, notice, operationId }); commandFailedOut = !durable.current
            } else if (e.kind === 'owner') reloadRef.current?.()
            debugClient('command.response', { ...fields, elapsedMs: performance.now() - started, result: e.kind === 'done' ? 'replay' : 'error', error: `outbox-${e.kind}` })
            if (e.kind === 'held' || e.kind === 'done') { try { await refresh(operationId) } catch { /* offline */ } }
            return null
          }
          const message = e instanceof Error ? e.message : String(e)
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
      void job.finally(() => { commandsOut-- }).catch(() => undefined)
      return job
    },
    [transport, adopt, push, refresh, retireStaleUndo, predicted, sendEntry, showOutbox],
  )
  runRef.current = run

  const [ticks, setTicks] = useState<Ticks>(() => new Map())
  // The guard reads the ref, so a second tap before React re-renders is still ignored.
  const ticksRef = useRef<Ticks>(ticks)
  const tickToken = useRef(0)
  const updateTicks = useCallback((next: (ticks: Ticks) => Ticks) => { ticksRef.current = next(ticksRef.current); setTicks(ticksRef.current) }, [])
  /** Sends a tick through the B72 lifecycle: shown at once, other taps ignored while it saves, then the row's hold. */
  const runTick = useCallback((action: Extract<Action, { type: 'task-status' }> & { status: TickStatus }, notice?: NoticeArg, operationId?: string) => {
    const { taskId } = action
    if (isSaving(ticksRef.current, taskId)) return
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
    const task = (predicted(true) ?? wsRef.current)?.tasks.find(t => t.id === taskId)
    const to = task && tapTarget(ticksRef.current, task)
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
    const held = entries.current.find(e => e.state === 'held')
    if (!held) return
    await store.current?.remove(held.seq!)
    entries.current = entries.current.filter(e => e.seq !== held.seq)
    showOutbox()
    try { await refresh() } catch { /* offline */ }
    void drain()
  }, [showOutbox, refresh, drain])
  /** §6 "Apply mine anyway", Jazz's "Keep mine": sent again on the latest revision, by his choice; a conflict only. */
  const keepMine = useCallback(async () => {
    const held = entries.current.find(e => e.state === 'held')
    if (!held || !wsRef.current || (held.held?.reason !== 'conflict' && held.held?.reason !== 'changed-since' && held.held?.reason !== 'maybe-applied')) return
    const patch = { state: 'pending' as const, baseRevision: wsRef.current.revision, ownRevisions: [] as number[] }
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
    const before = (e: BeforeUnloadEvent) => { if (!durable.current && commandsPending()) e.preventDefault() }
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
