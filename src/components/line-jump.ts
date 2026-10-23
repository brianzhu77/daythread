import { toast } from '@heroui/react'

/**
 * The block jump (tags and A11 line links, Jazz line-links-states §4): the line lands about a third from the top of the
 * visible area (below a stuck top bar, above the phone's bottom bar and its fade), tinted briefly, nothing focused.
 */

/** Bars that cover the page while it scrolls: their edge bounds the visible area. */
const overlays = '.day-screen .capture-bar, .tab-bar, .banner.save-failed'
/** The fade above the phone's bottom bar (styles.css `.tab-bar::before`, 120px). */
const tabFade = 120

export function visibleArea(): { top: number; bottom: number } {
  let top = 0, bottom = window.innerHeight
  for (const el of document.querySelectorAll<HTMLElement>(overlays)) {
    const style = getComputedStyle(el), r = el.getBoundingClientRect()
    if (!r.height || style.display === 'none' || (style.position !== 'fixed' && style.position !== 'sticky')) continue
    if (el.classList.contains('tab-bar')) { bottom = Math.min(bottom, window.innerHeight - tabFade); continue }
    // A sticky bar sits at its `top` once the page scrolls under it, wherever it is now.
    if (style.top !== 'auto') top = Math.max(top, parseFloat(style.top) + r.height)
  }
  return { top, bottom: Math.max(bottom, top + 1) }
}

/** How far the line is from where the jump puts it (0 when it's there). */
function offset(el: HTMLElement): number {
  const { top, bottom } = visibleArea()
  return el.getBoundingClientRect().top - (top + (bottom - top) / 3)
}

/** Scrolls `el` to a third from the top, tints it, and checks once more after layout settles. Returns a cleanup. */
export function jumpToBlock(el: HTMLElement): () => void {
  window.scrollBy({ top: offset(el) })
  // The page can still be growing as the editor lays out (and a client-side navigation may restore scroll after this
  // runs), so check again once things settle and bring it back to the same spot if it drifted.
  const settle = setTimeout(() => { if (Math.abs(offset(el)) > 24) window.scrollBy({ top: offset(el) }) }, 350)
  el.classList.remove('block-flash')
  void el.offsetWidth
  el.classList.add('block-flash')
  const tint = setTimeout(() => el.classList.remove('block-flash'), 1600)
  return () => { clearTimeout(settle); clearTimeout(tint) }
}

/** Open editors, by page id, so a link to a line on the page you're on jumps without navigating (a second tap too). */
const editors = new Map<string, (blockId: string) => boolean>()

export function registerEditor(pageId: string, jump: (blockId: string) => boolean): () => void {
  editors.set(pageId, jump)
  return () => { if (editors.get(pageId) === jump) editors.delete(pageId) }
}

/** Jumps within an open editor of `pageId`; false when that page isn't open or the line isn't on it. */
export function jumpInPage(pageId: string, blockId: string): boolean {
  return editors.get(pageId)?.(blockId) ?? false
}

/**
 * The server couldn't say where a linked line is now (offline, an error): jump nowhere, since an old row would look
 * like the right one. The page named in the URL stays open at the top, the URL is kept, and Retry asks again
 * (Bumblebee 499095e0, Jazz states §4; Ratchet #146).
 */
export function lookupFailed(retry: () => void): void {
  window.scrollTo({ top: 0 })
  const key: string = toast("Couldn't check where that line is now", { timeout: 12000, actionProps: { children: 'Retry', onPress: () => { toast.close(key); retry() } } })
}
