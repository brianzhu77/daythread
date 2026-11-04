// The label on a synced block's top edge (states §3): what it is, where else it's shown, and how to end it.
import { useNavigate } from '@tanstack/react-router'
import { createContext, useContext } from 'react'
import { syncedPlaces } from '../domain/synced'
import { displayPageTitle } from './page-title'
import { RowMenu } from './row-menu'
import { useWorkspace } from './use-day'

export interface SyncedActions { copy(blockId: string): void; unsync(blockId: string, all: boolean): void; remove(blockId: string): void; hostPageId: string }
export const SyncedEditorActions = createContext<SyncedActions | null>(null)
/** The list stops at 8, newest first, with the original always in it (a copy on the Day template adds a day each day). */
const listLimit = 8

export function SyncedLabel({ blockId, syncId }: { blockId: string; syncId: string }) {
  const { workspace, refresh } = useWorkspace()
  const navigate = useNavigate()
  const actions = useContext(SyncedEditorActions)
  if (!workspace) return null
  const record = workspace.synced?.find(r => r.id === syncId)
  if (!record) return <span className="synced-unavailable" contentEditable={false}>↻ Sync unavailable<button type="button" className="app-link" onClick={() => void refresh()}>Retry</button></span>
  const places = syncedPlaces(workspace, syncId), live = places.filter(p => !p.page.trashedAt)
  const pages = new Set(live.map(p => p.page.id)).size
  const original = record.original === blockId
  const name = original ? 'Original' : 'Synced'
  const count = live.length <= 1 ? 'only here' : pages === live.length ? `${pages} pages` : `${live.length} places`
  const others = places.filter(p => p.block.id !== blockId).reverse()
  const first = others.find(p => p.block.id === record.original)
  const listed = [...(first ? [first] : []), ...others.filter(p => p !== first)].slice(0, listLimit)
  const more = others.length - listed.length
  const label = (p: (typeof places)[number]) => `${p.page.id === actions?.hostPageId ? 'Also on this page' : displayPageTitle(p.page)}${p.block.id === record.original ? ` · Original${p.page.trashedAt ? ' · in Trash' : ''}` : ''}`
  return <span className="synced-label" contentEditable={false}>
    <RowMenu label={`↻ ${name} · ${count}`} triggerClass="synced-label-button" trigger={<>↻ {name} · {count}</>} groups={[
      ...(listed.length ? [{ title: 'On', items: [
        ...listed.map(p => ({ label: label(p), onSelect: () => void navigate({ to: '/pages', search: { page: p.page.id, block: p.block.id } }) })),
        ...(more > 0 ? [{ label: `and ${more} more`, onSelect: () => undefined }] : []),
      ] }] : []),
      { items: [
        { label: 'Copy', onSelect: () => actions?.copy(blockId) },
        ...(original && live.length > 1 ? [{ label: 'Unsync all', onSelect: () => actions?.unsync(blockId, true) }] : [{ label: live.length > 1 ? 'Unsync here' : 'Unsync', onSelect: () => actions?.unsync(blockId, false) }]),
        // Its own row takes no line, so no handle reaches the block: here is where it's deleted, at both widths.
        { label: 'Delete', onSelect: () => actions?.remove(blockId) },
      ] },
    ]} />
  </span>
}
