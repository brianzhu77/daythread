// A row opened over its view (docs/design/peek.md): ?peek={row} on the page's own URL. Opening adds one history entry, and Back closes it.
import type { useNavigate } from '@tanstack/react-router'

/** Below this it opens as a full page, as the phone does. */
export const peekFloor = 900
/** Below this a side peek opens as a center one: the sidebar's 260, a view of at least 420 and a peek of at least 420 (§4). */
export const sideFloor = 1100
/** The rows of the view it came from, as drawn, for ↑ ↓. After a reload there's no such list, and they don't show. */
let order: readonly string[] = []
export const peekOrder = () => order
let openedHere = false
export const peekOpenedHere = () => openedHere
export const noteOpenedHere = (on: boolean) => { openedHere = on }

/**
 * The rows as they're drawn, across groups and folds, from the view showing this one. The last match, as a peek comes after the page behind in
 * the document and a view inside it is the one tapped.
 */
export function drawnRows(rowId: string): string[] | null {
  const block = [...document.querySelectorAll(`[data-row="${CSS.escape(rowId)}"]`)].at(-1)?.closest('.database-block')
  if (!block) return null
  return [...new Set([...block.querySelectorAll<HTMLElement>('[data-row]')].map(el => el.dataset.row!))]
}

/**
 * The page's own place in the router's scroll record while a peek is over it. A peek's entry shares it, as the view can scroll beside a side peek
 * and closing is going Back, which would otherwise put the view where it was when the peek opened.
 */
let pageScrollKey: string | null = null
export function scrollKeyOf(location: { state: unknown; search: unknown }): string {
  const own = (location.state as { __TSR_key?: string }).__TSR_key ?? ''
  return (location.search as { peek?: unknown }).peek && pageScrollKey ? pageScrollKey : own
}

export function openPeek(navigate: ReturnType<typeof useNavigate>, rowId: string, rows: readonly string[] | undefined, side: boolean) {
  order = rows ?? []
  // Another row while one's open replaces it, so Back closes the peek instead of walking through every row.
  const replacing = new URLSearchParams(window.location.search).has('peek')
  if (!replacing) { openedHere = true; pageScrollKey = (window.history.state as { __TSR_key?: string } | null)?.__TSR_key ?? null }
  void navigate({ to: '.', search: (({ side: _side, ...prev }: Record<string, unknown>) => ({ ...prev, peek: rowId, ...(side ? { side: 1 } : {}) })) as never, replace: replacing, resetScroll: false })
}
