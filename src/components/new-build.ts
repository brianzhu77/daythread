import { useEffect } from 'react'
import { getAppInfo } from '../server/functions'
import { flushAllEditors } from './editor-flush'
import { commandsPending } from './use-day'
import { draftAskPending } from './use-day-draft'

// An open tab moves onto a new release by itself (Lead 115ea14a): he rarely reloads, so a fix otherwise waits on him.
// A return to the tab finds the server on another build and marks the move; the next time he leaves, the tab reloads
// while hidden, so he never sees it (Jazz, Lead 9c08dbcc). It goes only when nothing is on its way and nothing is in his
// hands: every editor saved, no command or draft ask out, no IME composition, no key in the last 2 s, no menu, dialog
// or list open. It comes back on the same page, scroll and (with a mouse) caret, with no notice. A tab frozen as it was
// hidden (the Home Screen app) finishes the reload when he opens it again, the one case where it shows.

/** This build's id, stamped once per build into the client and the server alike (vite.config.ts). */
export const ownBuild: string = import.meta.env.VITE_DAYTHREAD_BUILD ?? ''
/** The build this tab last reloaded for: one move per new build, so a page that comes back old can never loop. */
const movedKey = 'daythread.movedTo'
const resumeKey = 'daythread.resume'
const openUi = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"]'

interface Caret { blockId: string; offset: number }
interface Resume { href: string; scroll: { window: number; sidebar: number }; caret: Caret | null }

let lastKey = 0
let composing = false
/**
 * Only a key that types or moves the caret counts. Leaving a tab by keyboard sends one keydown first (the ⌘ or Ctrl of
 * ⌘T, ⌘-Tab, Ctrl-Tab, ⌘1-9, ⌘L), so a lone modifier or anything with ⌘ or Ctrl held would block every such leave
 * (Lead 842f7f62).
 */
const modifierKeys = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn', 'FnLock', 'OS', 'Hyper', 'Super', 'Symbol', 'SymbolLock', 'AltGraph'])
const types = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !modifierKeys.has(e.key)
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', e => { if (types(e)) lastKey = Date.now() }, { capture: true, passive: true })
  document.addEventListener('compositionstart', () => { composing = true }, true)
  document.addEventListener('compositionend', () => { composing = false }, true)
}
/**
 * An Undo notice (a toast, role alertdialog) still showing: a reload would take its Undo away. Its time doesn't run
 * while the tab is hidden, so waiting is no use; that leave is skipped and the next one moves.
 */
const undoShowing = () => Boolean(document.querySelector('.app-toasts [role="alertdialog"]'))
const quiet = () => !composing && Date.now() - lastKey >= 2000 && ![...document.querySelectorAll(openUi)].some(e => !e.closest('.app-toasts'))
/** Nothing on its way to the server: no queued command (a tick, a drag, a set-draft) and no draft ask (Lead ea5dc1fb). */
const idle = () => !commandsPending() && !draftAskPending()
/** Waits up to `ms` for the tab to go idle; false if it didn't. */
async function settled(ms: number): Promise<boolean> {
  for (const until = Date.now() + ms; !idle(); ) {
    if (Date.now() > until) return false
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return true
}

const sidebar = () => document.querySelector<HTMLElement>('.sidebar')
const finePointer = () => window.matchMedia('(pointer: fine)').matches
/** A block's own content, without its nested blocks. */
const contentOf = (outer: Element) => [...outer.querySelectorAll<HTMLElement>('.bn-block-content')].find(c => c.closest('.bn-block-outer') === outer) ?? null

/** Where the caret rests in an editor: its block and the text offset in it. */
function caretNow(): Caret | null {
  const sel = getSelection()
  const node = sel?.rangeCount ? sel.anchorNode : null
  const el = node instanceof Element ? node : node?.parentElement
  if (!sel || !node || !el?.closest('.continuous-editor') || !document.activeElement?.closest('.continuous-editor')) return null
  const outer = el.closest<HTMLElement>('.bn-block-outer[data-id]'), content = outer && contentOf(outer)
  if (!outer || !content?.contains(node)) return null
  const range = document.createRange()
  range.setStart(content, 0)
  range.setEnd(node, sel.anchorOffset)
  return { blockId: outer.dataset.id!, offset: range.toString().length }
}

/** Puts the caret back; false while the block isn't drawn yet. */
function restoreCaret(caret: Caret): boolean {
  const outer = document.querySelector(`.bn-block-outer[data-id="${CSS.escape(caret.blockId)}"]`), content = outer && contentOf(outer)
  const editable = content?.closest<HTMLElement>('[contenteditable="true"]')
  if (!content || !editable) return false
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  let left = caret.offset, at: Text | null = null
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
    at = t
    if (left <= t.length) break
    left -= t.length
  }
  editable.focus({ preventScroll: true })
  const sel = getSelection()
  if (at) sel?.collapse(at, Math.min(left, at.length)); else sel?.collapse(content, 0)
  return true
}

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
 * True once, for the editor that opens right after a move: its caret is put back as he left it (or, on a touch screen,
 * left out, so no keyboard comes up), not placed at the first empty line.
 */
export function openedByMove(): boolean {
  if (!resumed || caretWaived) return false
  caretWaived = true
  return true
}

/**
 * After the move: the same scroll, and the caret where he left it. The page reloads hidden, where animation frames
 * don't run, so the scroll is set on a timer while hidden, again the moment it is shown (before the first frame), and
 * then held for a second and a half: rows drawn above the fold move the scroll on their own (the browser keeps the
 * visible line in place). His first wheel, touch or key ends it.
 */
function resume() {
  const saved = resumed
  if (!saved) return
  const inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
  let timer = 0, frame = 0, until = 0, caretDone = !saved.caret || !finePointer()
  const apply = () => {
    const side = sidebar()
    if (side && saved.scroll.sidebar && Math.abs(side.scrollTop - saved.scroll.sidebar) >= 2) side.scrollTop = saved.scroll.sidebar
    if (Math.abs(window.scrollY - saved.scroll.window) >= 2) window.scrollTo(0, saved.scroll.window)
    if (!caretDone && document.visibilityState === 'visible') caretDone = restoreCaret(saved.caret!)
  }
  const stop = () => {
    clearTimeout(timer); cancelAnimationFrame(frame)
    for (const t of inputs) removeEventListener(t, stop, true)
    document.removeEventListener('visibilitychange', shown)
  }
  const whileHidden = () => { apply(); if (document.visibilityState === 'hidden') timer = window.setTimeout(whileHidden, 100) }
  const hold = () => { apply(); if (performance.now() < until) frame = requestAnimationFrame(hold); else stop() }
  const shown = () => {
    if (document.visibilityState !== 'visible') return
    clearTimeout(timer); until = performance.now() + 1500; hold()
  }
  for (const t of inputs) addEventListener(t, stop, { capture: true, passive: true })
  if (document.visibilityState === 'visible') shown()
  else { document.addEventListener('visibilitychange', shown); whileHidden() }
}

export function useMoveToNewBuild() {
  useEffect(() => {
    if (!ownBuild) return
    resume()
    /** The server's newer build, found on a return; the next hide moves to it. */
    let pending: string | null = null
    let busy = false
    const check = async () => {
      if (busy || !navigator.onLine) return
      busy = true
      try {
        const { build } = await getAppInfo()
        pending = build && build !== ownBuild && sessionStorage.getItem(movedKey) !== build ? build : null
      } catch { /* unreachable server: the next return checks again */ } finally { busy = false }
    }
    const move = async (build: string) => {
      busy = true
      try {
        const left = { scroll: { window: window.scrollY, sidebar: sidebar()?.scrollTop ?? 0 }, caret: finePointer() ? caretNow() : null }
        // A save going (or failing, offline), a command or draft ask still out, or an Undo notice showing keeps the tab
        // as it is until the next time he leaves; a short wait covers a command about to land.
        if (!quiet() || undoShowing() || !(await flushAllEditors()) || !(await settled(10_000)) || !(await flushAllEditors()) || !idle() || !quiet() || undoShowing()) return
        sessionStorage.setItem(movedKey, build)
        sessionStorage.setItem(resumeKey, JSON.stringify({ href: location.href, ...left } satisfies Resume))
        location.reload()
      } finally { busy = false }
    }
    const onChange = () => {
      if (document.visibilityState === 'visible') void check()
      else if (pending && !busy) void move(pending)
    }
    document.addEventListener('visibilitychange', onChange)
    window.addEventListener('pageshow', onChange)
    return () => { document.removeEventListener('visibilitychange', onChange); window.removeEventListener('pageshow', onChange) }
  }, [])
}
