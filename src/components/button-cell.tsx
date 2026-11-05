// A Button property in a row (docs/design/buttons.md §3): the same pill, in the cell or on the row page. It doesn't open the row.
import { useRef, useSyncExternalStore } from 'react'
import type { Property } from '../domain/database'
import type { Page } from '../domain/types'
import { isRunning, subscribeRunning, useRunRowButton } from './button-run'

export function ButtonCell({ property, row }: { property: Property; row: Page }) {
  const pill = useRef<HTMLButtonElement>(null)
  const stored = property.button?.steps ?? '', databaseId = row.parentId ?? '', key = `${property.id}:${row.id}`
  const run = useRunRowButton(() => undefined)
  const waiting = useSyncExternalStore(subscribeRunning, () => isRunning(key), () => false)
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation()
  return <button ref={pill} type="button" className={`editor-button-pill is-cell${waiting ? ' is-waiting' : ''}`} aria-busy={waiting || undefined}
    onPointerDown={stop} onMouseDown={e => { e.preventDefault(); stop(e) }} onTouchStart={stop}
    onClick={e => { e.stopPropagation(); e.preventDefault(); void run(databaseId, property.id, stored, [row.id]) }}>
    <span>{property.button?.label || property.name}</span>
  </button>
}
