// The only place screens touch data: loadWorkspace()/runCommand() on the local server
// (src/server/functions.ts). getDayView is a pure read of the loaded workspace.
import { Button, toast } from '@heroui/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Action, DayView, LocalDate, Receipt, Workspace } from '../domain/types'
import { getDayView } from '../domain/workspace'
import { loadWorkspace, runCommand } from '../server/functions'
import { configureDebug, debugClient } from '../lib/debug'
import { sampleActions } from './fixture'
import { todayIso } from './dates'

export interface Transport {
  load(operationId?: string, triggerOperationId?: string): Promise<Workspace>
  run(workspace: Workspace, action: Action, operationId?: string): Promise<{ workspace: Workspace; receipt: Receipt }>
}

const serverTransport: Transport = {
  load: async (operationId = newOperationId(), triggerOperationId) => {
    const response=await loadWorkspace({data:{operationId,triggerOperationId}})
    configureDebug(response.debug)
    return response.workspace
  },
  run: (workspace, action, operationId = newOperationId()) => runCommand({ data: { operationId, expectedRevision: workspace.revision, action } }),
}

export function newOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export function isConflict(message: string | null): boolean {
  return message !== null && /saved elsewhere|changed|cannot undo/i.test(message)
}
/** Which simulated provider outcome the next capture or draft uses (01 §9 item 6). */
export type SimOutcome = 'success' | 'failure' | 'budget' | 'context'

/** A HeroUI toast after a command: Undo while the domain's single undo slot still holds it, plus an optional extra action. */
export interface Notice {
  text: string
  undoOperationId?: string
  extra?: { label: string; run: () => void }
}

type NoticeSpec = Notice | null
type NoticeArg = NoticeSpec | ((r: Receipt) => NoticeSpec)

interface WorkspaceContextValue {
  workspace: Workspace | null
  loadError: string | null
  saveState: SaveState
  saveError: string | null
  /** The command that failed and Retry would resend, if any. */
  failedAction: Action['type'] | null
  simOutcome: SimOutcome
  setSimOutcome(o: SimOutcome): void
  run(action: Action, notice?: NoticeArg, operationId?: string): Promise<Receipt | null>
  retry(): void
  reload(): void
  refresh(triggerOperationId?: string): Promise<Workspace>
  addSampleData(): Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children, transport = serverTransport }: { children: ReactNode; transport?: Transport }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastFailed, setLastFailed] = useState<{ action: Action; notice?: NoticeArg; operationId: string } | null>(null)
  const [simOutcome, setSimOutcome] = useState<SimOutcome>('success')
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
    try { const next=await transport.load(operationId,triggerOperationId); adopt(next); debugClient('workspace.refresh.finish',{operationId,triggerOperationId,afterRevision:next.revision,elapsedMs:performance.now()-started,result:'ok'}); return next }
    catch(error) { debugClient('workspace.refresh.finish',{operationId,triggerOperationId,elapsedMs:performance.now()-started,result:'error',error:error instanceof Error?error.name:'UnknownError'}); throw error }
  }, [transport, adopt])

  const reload = useCallback(() => {
    setLoadError(null)
    void refresh().catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [refresh])

  useEffect(reload, [reload])

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
    (action: Action, notice?: NoticeArg, operationId = newOperationId()) => {
      const job = queue.current.then(async (): Promise<Receipt | null> => {
        const current = wsRef.current
        if (!current) return null
        setSaveState('saving')
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
          // What the user typed stays on screen; the header shows the failure with Retry.
          const message = e instanceof Error ? e.message : String(e)
          setSaveState('failed')
          setSaveError(message)
          setLastFailed({ action, notice, operationId })
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
      return job
    },
    [transport, adopt, push, refresh, retireStaleUndo],
  )
  runRef.current = run

  const retry = useCallback(() => {
    if (lastFailed) { debugClient('command.retry',{operationId:lastFailed.operationId,command:lastFailed.action.type}); void run(lastFailed.action, lastFailed.notice, lastFailed.operationId) }
  }, [lastFailed, run])

  const addSampleData = useCallback(async () => {
    for (const action of sampleActions(todayIso())) if (!(await run(action))) return
    push({ text: 'Sample data added' })
  }, [run, push])

  const value = useMemo(
    () => ({
      workspace,
      loadError,
      saveState,
      saveError,
      failedAction: lastFailed?.action.type ?? null,
      simOutcome,
      setSimOutcome,
      run,
      retry,
      reload,
      refresh,
      addSampleData,
    }),
    [workspace, loadError, saveState, saveError, lastFailed, simOutcome, run, retry, reload, refresh, addSampleData],
  )
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}

export function useDay(date: LocalDate): { view: DayView | null; workspace: Workspace | null } {
  const { workspace } = useWorkspace()
  const view = useMemo(() => (workspace ? getDayView(workspace, date) : null), [workspace, date])
  return { view, workspace }
}
