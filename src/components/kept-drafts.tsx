import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Page } from '../domain/types'
import { longLabel, todayIso } from './dates'
import { isNetworkFailure, saveKeptDrafts } from './draft-recovery'
import { orphans, ownDrafts } from './draft-slots'
import { leaveSavesPending, openEditorPages } from './editor-flush'
import { useWorkspace } from './use-day'

/**
 * B40 (Bumblebee e52b1214, Lead c8c13a2b): text kept as a draft because its save failed shows from any screen, not only
 * in its page's editor (B38), and is saved in the background, so "trying again" is true (Lead 1c8db2df, Roadbuster's
 * five conditions). State only: the line and the phone's tab dot have nothing to tap.
 */
export interface KeptPage { pageId: string; name: string; tab: '/' | '/calendar' | '/pages'; stuck: boolean }
interface KeptState { pages: KeptPage[]; online: boolean }

let state: KeptState = { pages: [], online: true }
const listeners = new Set<() => void>()
const publish = (next: KeptState) => {
  if (JSON.stringify(next) === JSON.stringify(state)) return
  state = next
  listeners.forEach(l => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const empty: KeptState = { pages: [], online: true }
export const useKeptDrafts = (): KeptState => useSyncExternalStore(subscribe, () => state, () => empty)

const shortTitle = (title: string) => (title.length > 28 ? `${title.slice(0, 27).trimEnd()}…` : title || 'Untitled')
function describe(page: Page, today: string): Pick<KeptPage, 'name' | 'tab'> {
  if (page.type === 'daily' && page.date) return page.date === today ? { name: "Today's page", tab: '/' } : { name: longLabel(page.date), tab: '/calendar' }
  return { name: shortTitle(page.title), tab: '/pages' }
}

const baseDelay = 30_000, maxDelay = 5 * 60_000

/** Mounted once in the app frame: watches this tab's kept drafts, retries them, and shows the line. */
export function KeptDrafts() {
  const { workspace, refresh, run } = useWorkspace()
  const pagesRef = useRef<Page[]>([]); pagesRef.current = workspace?.pages ?? []
  const refreshRef = useRef(refresh); refreshRef.current = refresh
  const runRef = useRef(run); runRef.current = run

  useEffect(() => {
    // Non-network failures per page: after the second, the line says where to act (Bumblebee); retries go on quietly.
    const refusals = new Map<string, number>()
    let delay = baseDelay, timer: ReturnType<typeof setTimeout> | undefined, running = false

    const kept = (): string[] => {
      const open = openEditorPages(), ids = new Set<string>()
      for (const d of ownDrafts()) if (!open.has(d.pageId)) ids.add(d.pageId)
      // A gone tab's draft is kept here even for an open page: the editor merges those only as it opens.
      for (const p of pagesRef.current) if (orphans(p.id).length) ids.add(p.id)
      return [...ids]
    }
    const scan = () => {
      // A closing editor's save is still on its way: its draft isn't kept yet (no flash of "not saved").
      if (leaveSavesPending()) return
      const today = todayIso(), byId = new Map(pagesRef.current.map(p => [p.id, p]))
      // Drafts for deleted or missing pages can't be saved anywhere, so they never count (Roadbuster condition 3).
      const pages = kept().flatMap(id => { const page = byId.get(id); return page && !page.trashedAt ? [{ pageId: id, ...describe(page, today), stuck: (refusals.get(id) ?? 0) >= 2 }] : [] })
      for (const id of refusals.keys()) if (!pages.some(p => p.pageId === id)) refusals.delete(id)
      publish({ pages, online: navigator.onLine !== false })
      if (pages.length && !timer && !running) schedule(2_000)
    }
    const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { timer = undefined; void attempt() }, ms) }
    const attempt = async () => {
      if (running || leaveSavesPending()) { if (!running) schedule(2_000); return }
      scan()
      if (!state.pages.length) return
      if (navigator.onLine === false) return // the `online` event brings it back
      running = true
      let failure: { pageId: string; message: string } | null = null
      let ok = false
      try {
        ok = await saveKeptDrafts(() => refreshRef.current(), runRef.current, openEditorPages(), { quiet: true, leaveOpenPages: true, onFailure: f => { failure = f } })
      } catch (error) {
        failure = { pageId: '', message: error instanceof Error ? error.message : String(error) }
      } finally { running = false }
      const failed = failure as { pageId: string; message: string } | null
      if (ok) { refusals.clear(); delay = baseDelay }
      else if (failed && !isNetworkFailure(failed.message)) {
        if (failed.pageId) refusals.set(failed.pageId, (refusals.get(failed.pageId) ?? 0) + 1)
        delay = Math.min(delay * 2, maxDelay)
      } else delay = baseDelay
      scan()
      if (state.pages.length) schedule(delay)
    }
    const backOnline = () => { delay = baseDelay; scan(); schedule(0) }
    const visible = () => { if (document.visibilityState === 'visible') { scan(); schedule(500) } }
    const offline = () => scan()
    const poll = setInterval(scan, 2_000)
    window.addEventListener('online', backOnline); window.addEventListener('offline', offline)
    window.addEventListener('storage', scan); document.addEventListener('visibilitychange', visible)
    scan(); schedule(1_000)
    return () => {
      clearInterval(poll); clearTimeout(timer)
      window.removeEventListener('online', backOnline); window.removeEventListener('offline', offline)
      window.removeEventListener('storage', scan); document.removeEventListener('visibilitychange', visible)
    }
  }, [])

  const { pages, online } = useKeptDrafts()
  if (!pages.length) return null
  const stuck = pages.filter(p => p.stuck), one = pages[0]!, n = pages.length
  const text = stuck.length ? (stuck.length === 1 ? `Couldn't save ${stuck[0]!.name} · open it` : `Couldn't save ${stuck.length} pages · open them`)
    : !online ? (n === 1 ? `Offline · ${one.name} saves when you're back` : `Offline · ${n} pages save when you're back`)
    : n === 1 ? `${one.name} not saved yet · trying again` : `${n} pages not saved yet · trying again`
  // No live-region role: it can change every couple of seconds while the connection flaps.
  return <div className="editor-unsaved-line is-elsewhere"><span className="editor-unsaved-dot" aria-hidden="true" />{text}</div>
}
