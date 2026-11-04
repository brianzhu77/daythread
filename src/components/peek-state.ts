// A row opened over its view (docs/design/peek.md): ?peek={row} on the page's own URL. Opening adds one history entry, and Back closes it.
import type { useNavigate } from '@tanstack/react-router'

/** Below this it opens as a full page, as the phone does. */
export const peekFloor = 900
/** The rows of the view it came from, in order, for ↑ ↓. After a reload there's no such list, and they don't show. */
let order: readonly string[] = []
export const peekOrder = () => order
let openedHere = false
export const peekOpenedHere = () => openedHere
export const noteOpenedHere = (on: boolean) => { openedHere = on }

export function openPeek(navigate: ReturnType<typeof useNavigate>, rowId: string, rows: readonly string[] | undefined) {
  order = rows ?? []
  openedHere = true
  void navigate({ to: '.', search: ((prev: Record<string, unknown>) => ({ ...prev, peek: rowId })) as never })
}
