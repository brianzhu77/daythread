// A smart note's picker and setup (docs/design/smart-note.md §4), in Buttons' shell: popover-sized at 1280, a sheet
// above the keyboard at 390. A preview is this view's own state: nothing is stored before Save.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useRouterState } from '@tanstack/react-router'
import { listedPages } from '../domain/page-tree'
import { placedSmartNotes, smartLimits, smartNoteOf, type SmartNote, type SmartRange, type SmartResult, type SmartWhere, type SmartWindow } from '../domain/smart-note'
import { tagIndex, tagKey } from '../domain/tags'
import type { Workspace } from '../domain/types'
import { askSmartNote } from '../server/functions'
import { todayIso } from './dates'
import { flushAllEditors } from './editor-flush'
import { useKeyboardTop } from './keyboard'
import { pageLabel } from './page-tree'
import { useWide } from './property-editors'
import { readLine, SmartNoteBody } from './smart-note-block'
import { newOperationId, useWorkspace, workspaceOwner } from './use-day'

type Open = { seq: number; at: { top: number; left: number } | null; noteId?: string; onPlaced?: (noteId: string) => void }
let open: Open | null = null, seq = 0
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const close = () => { open = null; notify() }

/** New: the picker first when a placed note exists, else setup. `noteId`: setup for that note (Edit). `onPlaced`: the note to show at the caller's block; not called for an Edit. */
export function openSmartNoteSetup(options: { anchor: Element | null; noteId?: string; onPlaced?: (noteId: string) => void }): void {
  const r = options.anchor?.getBoundingClientRect()
  // Hung from what opened it, kept on screen, as other sheets hang from theirs.
  const at = r ? { top: Math.max(16, Math.min(r.bottom + 6, window.innerHeight - 560)), left: Math.max(16, Math.min(r.left, window.innerWidth - 416)) } : null
  open = { seq: ++seq, at, ...(options.noteId ? { noteId: options.noteId } : {}), ...(options.onPlaced ? { onPlaced: options.onPlaced } : {}) }
  notify()
}

export function SmartNoteSetupHost(): ReactElement | null {
  const current = useSyncExternalStore(subscribe, () => open, () => null)
  const { workspace } = useWorkspace()
  // Any navigation closes it, storing nothing: its placement belongs to the page it was opened on.
  const place = useRouterState({ select: r => r.location.href }), seen = useRef(place)
  useEffect(() => {
    if (seen.current === place) return
    seen.current = place
    if (open) close()
  }, [place])
  if (!current || !workspace) return null
  // An Edit whose note is gone has nothing to edit.
  if (current.noteId && !smartNoteOf(workspace, current.noteId)) return null
  return <Shell key={current.seq} current={current} workspace={workspace} />
}

function Shell({ current, workspace }: { current: Open; workspace: Workspace }) {
  const wide = useWide(), keyboardTop = useKeyboardTop()
  const [picking, setPicking] = useState(() => !current.noteId && placedSmartNotes(workspace).length > 0)
  const note = current.noteId ? smartNoteOf(workspace, current.noteId) : undefined
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Escape ends a composition first; only a key outside one closes.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); close() } }
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) close() }
    document.addEventListener('keydown', esc, true); document.addEventListener('pointerdown', away, true)
    return () => { document.removeEventListener('keydown', esc, true); document.removeEventListener('pointerdown', away, true) }
  }, [])
  const placed = (noteId: string) => { current.onPlaced?.(noteId); close() }
  return createPortal(<>
    <div className="database-menu-scrim" aria-hidden="true" />
    <div ref={box} className="app-menu database-menu button-editor smart-setup" role="dialog" aria-label="Smart note" style={{ position: 'fixed', ...(wide ? current.at ?? { top: 90, left: Math.max(16, window.innerWidth / 2 - 200) } : {}), ...(!wide && keyboardTop !== null ? { '--keyboard-lift': `${window.innerHeight - keyboardTop}px` } as object : {}) }} onKeyDown={e => e.stopPropagation()}>
      {picking ? <Picker workspace={workspace} onPick={placed} onNew={() => setPicking(false)} />
        : <Setup note={note} workspace={workspace} onSaved={id => (note ? close() : placed(id))} />}
    </div>
  </>, document.body)
}

function Picker({ workspace, onPick, onNew }: { workspace: Workspace; onPick(noteId: string): void; onNew(): void }) {
  const notes = useMemo(() => placedSmartNotes(workspace), [workspace])
  return <>
    <div className="database-menu-head button-editor-head"><span>Smart note</span></div>
    {notes.map(({ note, places }) => <button key={note.id} type="button" role="menuitem" className="smart-setup-pick" onClick={() => onPick(note.id)}>
      <span>{note.name}</span>{places > 1 && <small>{places} places</small>}
    </button>)}
    <button type="button" role="menuitem" onClick={onNew}>New smart note</button>
  </>
}

/** What a preview was run with, so a result shows as current only for the prompt and range it was made from. */
const specKey = (prompt: string, range: SmartRange) => JSON.stringify([prompt.trim(), range.where.kind, range.where.kind === 'pages' ? range.where.pageIds : range.where.kind === 'tag' ? range.where.tag : null, range.days])
const askable = (prompt: string, range: SmartRange) => Boolean(prompt.trim()) && !(range.where.kind === 'pages' && !range.where.pageIds.length) && !(range.where.kind === 'tag' && !range.where.tag)
type Preview = { key: string; state: 'running' } | { key: string; state: 'ready'; result: SmartResult } | { key: string; state: 'failed'; error: string | null }

function Setup({ note, workspace, onSaved }: { note: SmartNote | undefined; workspace: Workspace; onSaved(noteId: string): void }) {
  const { run } = useWorkspace()
  const [prompt, setPrompt] = useState(note?.prompt ?? ''), [range, setRange] = useState<SmartRange>(note?.range ?? { where: { kind: 'workspace' }, days: 0 }), [name, setName] = useState(note?.name ?? '')
  const [preview, setPreview] = useState<Preview | null>(null), [saving, setSaving] = useState(false)
  const asked = useRef(0), shown = useRef<HTMLDivElement>(null)
  // One id for the life of the sheet, so a Save that failed and a second Save store one note.
  const id = useRef(note?.id ?? crypto.randomUUID()).current
  const key = specKey(prompt, range), canAsk = askable(prompt, range)
  const fresh = preview?.state === 'ready' && preview.key === key ? preview.result : null
  // An Edit that changed neither keeps the stored result.
  const result = fresh ?? (note && specKey(note.prompt, note.range) === key ? note.result : null)
  const canSave = Boolean(result) && canAsk && !saving

  const runPreview = async () => {
    const mine = ++asked.current, sent = key
    const settle = (next: Preview | null) => { if (asked.current === mine) setPreview(next) }
    setPreview({ key: sent, state: 'running' })
    try {
      // The model reads what was typed, so every open page is saved first.
      if (!(await flushAllEditors())) { settle({ key: sent, state: 'failed', error: null }); return }
      const reply = await askSmartNote({ data: { operationId: newOperationId(), today: todayIso(), ...(note ? { noteId: note.id } : {}), prompt: prompt.trim(), range } })
      // Made from another account's workspace (the session changed meanwhile): never shown in this one.
      if (reply.owner !== (workspaceOwner() ?? 'local')) { settle(null); return }
      settle(reply.status === 'ready' ? { key: sent, state: 'ready', result: reply.result } : { key: sent, state: 'failed', error: reply.status === 'failed' ? reply.error : null })
    } catch { settle({ key: sent, state: 'failed', error: null }) }
  }
  const save = async () => {
    if (!result || !canSave) return
    setSaving(true)
    const receipt = await run({ type: 'save-smart-note', note: { id, name: name.trim(), prompt: prompt.trim(), range, refresh: 'manual', result } }, r => ({ text: r.message, undoOperationId: r.operationId }))
    setSaving(false)
    if (receipt) onSaved(id)
  }
  const running = preview?.state === 'running'
  // A reply lands below the fields: bring it into view, above the sticky actions.
  useEffect(() => { if (preview && !running) shown.current?.scrollIntoView({ block: 'nearest' }) }, [preview, running])
  return <>
    <div className="database-menu-head button-editor-head"><span>{note ? 'Smart note' : 'New smart note'}</span></div>
    <label className="button-editor-label" htmlFor="smart-note-prompt">Prompt</label>
    <textarea id="smart-note-prompt" className="button-editor-field smart-setup-prompt" maxLength={smartLimits.prompt} rows={3} autoFocus={!note} value={prompt} onChange={e => setPrompt(e.target.value)} />
    <RangeFields range={range} workspace={workspace} onChange={setRange} />
    <label className="button-editor-label" htmlFor="smart-note-name">Name</label>
    <input id="smart-note-name" className="button-editor-name" maxLength={smartLimits.name} placeholder={prompt.trim().slice(0, 60)} value={name} onChange={e => setName(e.target.value)} />
    {preview && preview.state !== 'running' && <div ref={shown} className="smart-setup-preview" role="status">
      {preview.state === 'ready' ? <>
        <SmartNoteBody result={preview.result} workspace={workspace} inert />
        <p className="smart-note-read">{readLine(preview.result, todayIso())}</p>
      </> : preview.error === 'empty-range' ? <span className="smart-note-status">No notes in this range</span>
        : <span className="smart-note-status">Couldn't refresh · <button type="button" onClick={() => void runPreview()}>Retry</button></span>}
    </div>}
    <div className="smart-setup-actions">
      <button type="button" id="smart-note-preview" className="smart-setup-run" disabled={!canAsk || running} aria-busy={running || undefined} onClick={() => void runPreview()}>Run preview</button>
      <button type="button" id="smart-note-cancel" onClick={close}>Cancel</button>
      <button type="button" id="smart-note-save" className="smart-setup-save" disabled={!canSave} aria-busy={saving || undefined} onClick={() => void save()}>Save</button>
    </div>
  </>
}

const windows: { days: SmartWindow; label: string }[] = [{ days: 0, label: 'All time' }, { days: 7, label: 'Last 7 days' }, { days: 30, label: 'Last 30 days' }, { days: 90, label: 'Last 90 days' }]

/** Where the note reads, and how far back. */
function RangeFields({ range, workspace, onChange }: { range: SmartRange; workspace: Workspace; onChange(next: SmartRange): void }) {
  const tags = useMemo(() => tagIndex(workspace), [workspace])
  const { where } = range
  const put = (next: SmartWhere) => onChange({ ...range, where: next })
  const choose = (kind: SmartWhere['kind']) => put(kind === 'pages' ? { kind, pageIds: [] } : kind === 'tag' ? { kind, tag: tags[0]?.tag ?? '' } : { kind })
  // A stored tag no longer in use stays choosable, so an Edit shows what the note reads.
  const shownTag = where.kind === 'tag' ? tags.find(t => t.key === tagKey(where.tag))?.tag ?? where.tag : ''
  const tagChoices = shownTag && !tags.some(t => t.tag === shownTag) ? [shownTag, ...tags.map(t => t.tag)] : tags.map(t => t.tag)
  return <>
    <label className="button-editor-label" id="smart-note-range" htmlFor="smart-note-where">Range</label>
    <div className="smart-setup-range">
      <select id="smart-note-where" className="button-editor-field" value={where.kind} onChange={e => choose(e.target.value as SmartWhere['kind'])}>
        <option value="workspace">Whole workspace</option>
        <option value="pages">Pages</option>
        {(tags.length > 0 || where.kind === 'tag') && <option value="tag">Tag</option>}
        <option value="days">Day pages</option>
      </select>
      <select id="smart-note-days" className="button-editor-field" aria-labelledby="smart-note-range" value={range.days} onChange={e => onChange({ ...range, days: Number(e.target.value) as SmartWindow })}>
        {windows.map(w => <option key={w.days} value={w.days}>{w.label}</option>)}
      </select>
    </div>
    {where.kind === 'pages' && <PagesField pageIds={where.pageIds} workspace={workspace} onChange={pageIds => put({ kind: 'pages', pageIds })} />}
    {where.kind === 'tag' && <select id="smart-note-tag" className="button-editor-field" aria-label="Tag" value={shownTag} onChange={e => put({ kind: 'tag', tag: e.target.value })}>
      {tagChoices.map(tag => <option key={tag} value={tag}>#{tag}</option>)}
    </select>}
  </>
}

function PagesField({ pageIds, workspace, onChange }: { pageIds: string[]; workspace: Workspace; onChange(next: string[]): void }) {
  const [query, setQuery] = useState('')
  const today = todayIso()
  const pages = useMemo(() => listedPages(workspace), [workspace])
  const q = query.trim().toLowerCase()
  const found = pages.filter(p => pageLabel(p, today).toLowerCase().includes(q)).slice(0, 8)
  const chosen = pageIds.flatMap(id => { const page = workspace.pages.find(p => p.id === id && !p.trashedAt); return page ? [page] : [] })
  const full = pageIds.length >= smartLimits.pages
  const toggle = (id: string) => onChange(pageIds.includes(id) ? pageIds.filter(x => x !== id) : full ? pageIds : [...pageIds, id])
  return <div className="smart-setup-pages">
    {chosen.length > 0 && <div className="smart-setup-chips">
      {chosen.map(p => <span key={p.id} className="smart-setup-chip"><span>{pageLabel(p, today)}</span><button type="button" aria-label={`Remove ${pageLabel(p, today)}`} onClick={() => toggle(p.id)}>×</button></span>)}
    </div>}
    <input id="smart-note-pages" className="button-editor-field" aria-label="Pages" value={query} onChange={e => setQuery(e.target.value)} />
    {found.map(p => {
      const on = pageIds.includes(p.id)
      return <label key={p.id} className="smart-setup-page"><input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(p.id)} /><span>{pageLabel(p, today)}</span></label>
    })}
  </div>
}
