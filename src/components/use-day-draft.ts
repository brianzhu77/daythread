// B77: the day draft on a day page (Jazz 259d2c55's interface). The bands read `draftView`; every write saves what
// he typed on the page first and does nothing if that save fails, like the morning card. The model is asked once
// per day page per tab, when today's page is open and has no draft yet; the page itself never waits on it.
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  /** The block "N more open ▸" sits after; also where a band whose anchor is gone goes. */
  planningEndId: string | null
  apply(itemIds: string[], edits?: Record<string, string>): Promise<{ applied: string[]; dropped: string[] }>
  skip(itemIds: string[]): Promise<boolean>
  addOpen(taskId: string): Promise<boolean>
  retry(): void
}
export type { DraftItemView, EditorNode, Task }

/** Day pages asked for in this tab: one request each, however often the page re-renders or remounts. */
const asked = new Set<string>()

export function useDayDraft(page: Page): DayDraftHook {
  const { workspace, run, latest, offline, refresh } = useWorkspace()
  const [preparing, setPreparing] = useState(false)
  const view = useMemo(() => (workspace && page.type === 'daily' ? draftView(workspace, page) : null), [workspace, page])

  const prepare = useCallback(async () => {
    if (!page.date) return
    setPreparing(true)
    try {
      // The server only computes the draft; storing it goes through this tab's queue, after any save he typed
      // meanwhile, so neither is sent against a revision the other has moved on (Lead 1d5e2e28).
      const { setDraft, owner } = await prepareDayDraft({ data: { date: page.date, operationId: newOperationId() } })
      // Made from another account's workspace (the session changed meanwhile): its words never go into this one.
      if (owner !== (workspaceOwner() ?? 'local')) return
      if (!setDraft) { await refresh(); return }
      const action = JSON.parse(setDraft) as Action
      // A refusal is another tab's draft winning (shown after run's own refresh). A failure resyncs inside run, so
      // one more try covers a change from another device; after that the state line shows none, as when offline.
      for (let attempt = 0; attempt < 2; attempt++) {
        let refused = false
        if (await run(action, undefined, undefined, { quiet: true, inlineRefusal: /already has its draft/, onRefused: () => { refused = true } })) return
        if (refused) return
      }
    } catch { /* the state line shows Retry from the stored status, or none */ } finally { setPreparing(false) }
  }, [page.date, refresh, run])

  const hasDraft = Boolean(workspace && draftOf(workspace, page.id))
  useEffect(() => {
    if (offline || hasDraft || page.type !== 'daily' || page.date !== todayIso() || asked.has(page.id)) return
    asked.add(page.id)
    void prepare()
  }, [offline, hasDraft, page.type, page.date, page.id, prepare])

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

  const retry = useCallback(() => { void prepare() }, [prepare])

  const state: DayDraftState = offline && !view ? 'offline' : preparing && !view?.items.length ? 'preparing' : !view ? 'none' : view.status === 'failed' ? 'failed' : 'ready'
  return { state, items: view?.items ?? [], moreOpen: view?.moreOpen ?? [], planningEndId: view?.planningEndId ?? null, apply, skip, addOpen, retry }
}
