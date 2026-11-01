import { useEffect } from 'react'
import { getAppInfo } from '../server/functions'
import { flushAllEditors } from './editor-flush'

// An open tab moves onto a new release by itself (Lead 115ea14a): he rarely reloads, so a fix otherwise waits on him.
// Never under his hands (Jazz): only when the tab has just come back from hidden, everything typed is saved, and no
// caret, menu, sheet or dialog is active. It comes back on the same page and scroll, with no notice, so it looks like
// the page he left. If any of that fails, it waits for his next return.

/** This build's id, stamped once per build into the client and the server alike (vite.config.ts). */
export const ownBuild: string = import.meta.env.VITE_DAYTHREAD_BUILD ?? ''
/** The build this tab last reloaded for: one move per new build, so a page that comes back old can never loop. */
const movedKey = 'daythread.movedTo'
const resumeKey = 'daythread.resume'

interface Resume { href: string; scroll: { window: number; sidebar: number } }

function quiet(): boolean {
  const a = document.activeElement
  if (a instanceof HTMLElement && (a.isContentEditable || a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement)) return false
  return !document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"]')
}

const sidebar = () => document.querySelector<HTMLElement>('.sidebar')

/** What this load resumes, read once as the app's code loads, before any screen's effects run. */
const resumed: Resume | null = (() => {
  if (typeof window === 'undefined') return null
  try {
    const saved = JSON.parse(sessionStorage.getItem(resumeKey) ?? 'null') as Resume | null
    sessionStorage.removeItem(resumeKey)
    return saved?.href === location.href ? saved : null
  } catch { return null }
})()
let caretWaived = false
/**
 * True once, for the editor that opens right after a move: he left it with no caret, so it opens without one (and
 * without scrolling to it), as a day the screen moved to after midnight does.
 */
export function openedByMove(): boolean {
  if (!resumed || caretWaived) return false
  caretWaived = true
  return true
}

/**
 * After the move: the same scroll, held for 3 s while the page finishes drawing. Rows drawn above the fold move the
 * scroll on their own (the browser keeps the visible line in place), so one restore isn't enough. His first wheel,
 * touch or key ends it.
 */
function resume() {
  const saved = resumed
  if (!saved) return
  const until = performance.now() + 3000, inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
  let frame = 0
  const stop = () => { cancelAnimationFrame(frame); for (const t of inputs) removeEventListener(t, stop, true) }
  const step = () => {
    const side = sidebar()
    if (side && saved.scroll.sidebar && Math.abs(side.scrollTop - saved.scroll.sidebar) >= 2) side.scrollTop = saved.scroll.sidebar
    if (Math.abs(window.scrollY - saved.scroll.window) >= 2) window.scrollTo(0, saved.scroll.window)
    if (performance.now() < until) frame = requestAnimationFrame(step); else stop()
  }
  for (const t of inputs) addEventListener(t, stop, { capture: true, passive: true })
  frame = requestAnimationFrame(step)
}

export function useMoveToNewBuild() {
  useEffect(() => {
    if (!ownBuild) return
    resume()
    let checking = false
    const onReturn = async () => {
      if (document.visibilityState !== 'visible' || checking || !navigator.onLine) return
      checking = true
      try {
        const { build } = await getAppInfo()
        if (!build || build === ownBuild || sessionStorage.getItem(movedKey) === build || !quiet()) return
        // A save still going (or failing, offline) keeps the tab as it is until his next return.
        if (!(await flushAllEditors()) || !quiet() || document.visibilityState !== 'visible') return
        sessionStorage.setItem(movedKey, build)
        sessionStorage.setItem(resumeKey, JSON.stringify({ href: location.href, scroll: { window: window.scrollY, sidebar: sidebar()?.scrollTop ?? 0 } } satisfies Resume))
        location.reload()
      } catch { /* unreachable server: the next return checks again */ } finally { checking = false }
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('pageshow', onReturn)
    return () => { document.removeEventListener('visibilitychange', onReturn); window.removeEventListener('pageshow', onReturn) }
  }, [])
}
