// The only place screens touch data: loadWorkspace()/runCommand() on the local server
// (src/server/functions.ts). getDayView is a pure read of the loaded workspace.
import { Button, toast } from '@heroui/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Action, DayView, LocalDate, Receipt, Task, Workspace } from '../domain/types'
import { getDayView } from '../domain/workspace'
import { applyChanges } from '../domain/workspace-changes'
import { loadWorkspace, runCommand } from '../server/functions'
import { configureDebug, debugClient } from '../lib/debug'
import { sampleActions } from './fixture'
import { todayIso } from './dates'
import { flushAllEditors } from './editor-flush'
import { offlineCopy } from './offline-copy'
import { HOLD_MS, heldWorkspace, isSaving, settleTick, shownStatus, tapTarget, withTick, type Tick, type Ticks, type TickStatus } from './task-ticks'

export interface Transport {
  load(operationId?: string, triggerOperationId?: string): Promise<Workspace>
  run(workspace: Workspace, action: Action, operationId?: string): Promise<{ workspace: Workspace; receipt: Receipt }>
}

/**
 * Whose workspace is on screen: the `owner` of the last server answer, or of the offline copy when the app opened
 * offline. Null until either is known. Device-only records (the Tomorrow block's unsaved lines) are kept under it.
 */
let knownOwner: string | null = null
export function workspaceOwner(): string | null {
  return knownOwner
}

// Every workspace the server answers with is the copy the next offline open shows, kept under the account it belongs to.
const serverTransport: Transport = {
  load: async (operationId = newOperationId(), triggerOperationId) => {
    const startedAt = Date.now()
    const response=await loadWorkspace({data:{operationId,triggerOperationId}})
    configureDebug(response.debug)
    knownOwner = response.owner
    void offlineCopy.remember(response.workspace, { owner: response.owner, startedAt })
    return response.workspace
  },
  // The reply carries what the command changed (workspace-changes.ts), applied to the copy it was sent from. When that
  // copy isn't the one the changes start from (a replay, a reply from an older build), the workspace is loaded whole.
  run: async (workspace, action, operationId = newOperationId()) => {
    const startedAt = Date.now()
    const response = await runCommand({ data: { operationId, expectedRevision: workspace.revision, action, changes: true } })
    knownOwner = response.owner
    const next = response.changes ? applyChanges(workspace, response.changes) : response.workspace ?? null
    if (!next) return { workspace: await serverTransport.load(), receipt: response.receipt }
    void offlineCopy.remember(next, { owner: response.owner, startedAt })
    return { workspace: next, receipt: response.receipt }
  },
}

/** Commands queued or being sent in this tab, across providers: a reload waits for none (new-build.ts). */
let commandsOut = 0
export const commandsPending = (): boolean => commandsOut > 0

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
type NoticeArg = NoticeSpec | ((r: Receipt) => NoticeSpec)
/** A domain refusal matching `inlineRefusal` is handed to `onRefused` instead of the save-failed bar. */
type RunOptions = { inlineRefusal?: RegExp; onRefused?: (message: string) => void; /** The failure's message, for a caller that retries by itself (B35). */ onFailure?: (message: string) => void; /** B40: a background save; its failure says so in its own line, never the header's bar and Retry. */ quiet?: boolean }

interface WorkspaceContextValue {
  workspace: Workspace | null
  loadError: string | null
  /** The workspace on screen is the last-loaded copy: the network is away (docs/design/pwa.md §2). */
  offline: boolean
  saveState: SaveState
  saveError: string | null
  /** The command that failed and Retry would resend, if any. */
  failedAction: Action['type'] | null
  run(action: Action, notice?: NoticeArg, operationId?: string, options?: RunOptions): Promise<Receipt | null>
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
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children, transport = serverTransport }: { children: ReactNode; transport?: Transport }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastFailed, setLastFailed] = useState<{ action: Action; notice?: NoticeArg; operationId: string } | null>(null)
  // Commands are applied one at a time against the latest revision.
  const wsRef = useRef<Workspace | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const adopt = useCallback((ws: Workspace) => {
    wsRef.current = ws
    setWorkspace(ws)
  }, [])

  const refresh = useCallback(async (triggerOperationId?: string) => {
    const operationId=newOperationId(),started=performance.now()
    debugClient('workspace.refresh.start',{operationId,triggerOperationId})
    try { const next=await transport.load(operationId,triggerOperationId)
      // A load can be overtaken by a command that finished while it was in flight (he typed and it saved): its older
      // snapshot must not replace the newer one, or the editor would roll his text back (Ratchet #95).
      if (wsRef.current && next.revision < wsRef.current.revision) { debugClient('workspace.refresh.finish',{operationId,triggerOperationId,afterRevision:next.revision,elapsedMs:performance.now()-started,result:'stale'}); return wsRef.current }
      adopt(next); setOffline(false); debugClient('workspace.refresh.finish',{operationId,triggerOperationId,afterRevision:next.revision,elapsedMs:performance.now()-started,result:'ok'}); return next }
    catch(error) { debugClient('workspace.refresh.finish',{operationId,triggerOperationId,elapsedMs:performance.now()-started,result:'error',error:error instanceof Error?error.name:'UnknownError'}); throw error }
  }, [transport, adopt])

  const reload = useCallback(() => {
    setLoadError(null)
    void refresh().catch(async (e: unknown) => {
      // No network: the last-loaded copy opens the app, read as it was; any other failure is shown as before.
      const copy = await offlineCopy.fallback(e)
      if (copy && !knownOwner) knownOwner = await offlineCopy.recallOwner()
      if (copy && (!wsRef.current || copy.revision >= wsRef.current.revision)) {
        adopt(copy); setOffline(true)
        debugClient('workspace.offline-copy', { afterRevision: copy.revision })
      } else if (copy && wsRef.current) setOffline(true)
      else setLoadError(e instanceof Error ? e.message : String(e))
    })
  }, [refresh, adopt])

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
          void runRef.current?.({ type: 'undo', targetOperationId: undoOperationId }, { text: 'Undone' })
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
    (action: Action, notice?: NoticeArg, operationId = newOperationId(), options: RunOptions = {}) => {
      commandsOut++
      const job = queue.current.then(async (): Promise<Receipt | null> => {
        const current = wsRef.current
        if (!current) return null
        if (!options.quiet) setSaveState('saving')
        const started=performance.now()
        const fields={operationId,command:action.type,beforeRevision:current.revision,...('pageId' in action?{pageId:action.pageId}:{}),...('taskId' in action?{taskId:action.taskId}:{})}
        debugClient('command.request',fields)
        try {
          const result = await transport.run(current, action, operationId)
          adopt(result.workspace)
          retireStaleUndo(result.workspace)
          debugClient('command.response',{...fields,afterRevision:result.workspace.revision,elapsedMs:performance.now()-started,result:'ok'})
          setSaveState('saved')
          setSaveError(null)
          setLastFailed(null)
          const spec = typeof notice === 'function' ? notice(result.receipt) : notice
          if (spec) push(spec)
          return result.receipt
        } catch (e) {
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
    [transport, adopt, push, refresh, retireStaleUndo],
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
    const task = wsRef.current?.tasks.find(t => t.id === taskId)
    const to = task && tapTarget(ticksRef.current, task)
    if (to) runTick({ type: 'task-status', taskId, status: to, today: todayIso() }, r => notice(to, r))
  }, [runTick])

  const retry = useCallback(() => {
    if (!lastFailed) return
    const { action, notice, operationId } = lastFailed
    debugClient('command.retry',{operationId,command:action.type})
    // B72 (Ratchet 4bae2184): a retried tick is a tick too, same operation id, so it gets the same guard and hold.
    if (action.type === 'task-status' && (action.status === 'done' || action.status === 'open')) runTick({ ...action, status: action.status }, notice, operationId)
    else void run(action, notice, operationId)
  }, [lastFailed, run, runTick])

  const addSampleData = useCallback(async () => {
    for (const action of sampleActions(todayIso())) if (!(await run(action))) return
    push({ text: 'Sample data added' })
  }, [run, push])

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
    }),
    [workspace, latest, loadError, offline, saveState, saveError, lastFailed, run, retry, reload, refresh, addSampleData, ticks, toggleTask],
  )
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
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
