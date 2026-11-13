// A smart note on a page (docs/design/smart-note.md §4): the record's last result, read-only, each statement with its
// numbered sources. The block holds only `noteId`. It takes no caret, so a tap raises no keyboard and IME is untouched.
import { toast } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactElement, type SyntheticEvent } from 'react'
import { pagePath } from '../domain/line-link'
import { collectInput, livePlaces, rangeGone, smartNoteLines, smartNoteOf, smartNoteText, sourceNumbers, type SmartBlock, type SmartNote, type SmartResult } from '../domain/smart-note'
import type { LocalDate, Page, Workspace } from '../domain/types'
import { askSmartNote, smartNotesOn } from '../server/functions'
import { fromIso, todayIso } from './dates'
import { flushAllEditors } from './editor-flush'
import { RefreshIcon, SmartNoteIcon } from './icons'
import { jumpInPage } from './line-jump'
import { RowMenu, type MenuItem } from './row-menu'
import { newOperationId, useWorkspace, workspaceOwner } from './use-day'

/** What the block needs of the editor, declared here as `ButtonLine` declares its own. */
type BlockEditor = { replaceBlocks(ids: string[], blocks: never): unknown; removeBlocks(ids: string[]): unknown }

const stop = (e: SyntheticEvent) => e.stopPropagation()

export function SmartNoteBlock({ blockId, noteId, editor }: { blockId: string; noteId: string; editor: BlockEditor }): ReactElement {
  const { workspace } = useWorkspace()
  const note = workspace ? smartNoteOf(workspace, noteId) : undefined
  const remove: MenuItem = { label: 'Delete', danger: true, onSelect: () => { editor.removeBlocks([blockId]) } }
  return <div className={`smart-note${note ? '' : ' is-deleted'}`} contentEditable={false} onMouseDown={stop} onPointerDown={stop} onKeyDown={stop}>
    {workspace && note ? <SmartNoteShown note={note} workspace={workspace} turnIntoText={() => { editor.replaceBlocks([blockId], smartNoteLines(workspace, note, () => crypto.randomUUID()) as never) }} remove={remove} />
      : <div className="smart-note-head"><span className="smart-note-name">This smart note was deleted</span><RowMenu label="Smart note actions" triggerClass="smart-note-more" groups={[{ items: [remove] }]} /></div>}
  </div>
}

function SmartNoteShown({ note, workspace, turnIntoText, remove }: { note: SmartNote; workspace: Workspace; turnIntoText: () => void; remove: MenuItem }) {
  const on = useSmartNotesOn()
  const ask = useSmartRefresh(note.id)
  const changed = useNotesChanged(workspace, note)
  const gone = useMemo(() => rangeGone(workspace, note.range), [workspace, note.range])
  const now = useMinute()
  const running = ask.state === 'running'
  const copy = () => {
    const done = (ok: boolean) => toast(ok ? 'Copied' : "Couldn't copy", { timeout: 4000 })
    if (!navigator.clipboard?.writeText) { done(false); return }
    navigator.clipboard.writeText(smartNoteText(note)).then(() => done(true), () => done(false))
  }
  const status = ask.state === 'failed'
    ? ask.error === 'empty-range' ? <span className="smart-note-status">No notes in this range</span>
      : <span className="smart-note-status">Couldn't refresh · <button type="button" onClick={ask.refresh}>Retry</button></span>
    : gone ? <span className="smart-note-status">Its range was deleted</span>
      : changed ? <span className="smart-note-changed">Notes changed</span> : null
  return <>
    <div className="smart-note-head" aria-busy={running || undefined}>
      <span className="smart-note-name"><SmartNoteIcon /><span>{note.name}</span></span>
      <span className="smart-note-meta">
        {status}
        <span className="smart-note-updated">Updated {ago(note.result.at, now)}</span>
        {on && <button type="button" className="smart-note-refresh" aria-label="Refresh" disabled={running} onClick={ask.refresh}><RefreshIcon /></button>}
        <RowMenu label={`${note.name} actions`} triggerClass="smart-note-more" groups={[
          { items: [{ label: 'Copy', onSelect: copy }, { label: 'Turn into text', onSelect: turnIntoText }] },
          { items: [remove] },
        ]} />
      </span>
    </div>
    <SmartNoteBody result={note.result} workspace={workspace} />
    <p className="smart-note-read">{readLine(note.result, todayIso())}</p>
  </>
}

/** The result's statements, with a number per source. Shared with setup's preview. */
export function SmartNoteBody({ result, workspace }: { result: SmartResult; workspace: Workspace }): ReactElement {
  const numbers = useMemo(() => sourceNumbers(result), [result])
  const places = useMemo(() => livePlaces(workspace, result), [workspace, result])
  const groups: (SmartBlock | SmartBlock[])[] = []
  for (const b of result.blocks) {
    const last = groups.at(-1)
    if (b.kind === 'bullet' && Array.isArray(last)) last.push(b)
    else groups.push(b.kind === 'bullet' ? [b] : b)
  }
  const words = (b: SmartBlock) => <>{b.text}{[...new Map(b.sources.map(s => [`${s.pageId}|${s.blockId}`, s])).entries()].map(([key, s]) => <SourceMark key={key} n={numbers.get(key)!} page={places.get(key)} blockId={s.blockId} />)}</>
  return <div className="smart-note-body">
    {groups.map((g, i) => Array.isArray(g) ? <ul key={i}>{g.map((b, j) => <li key={j}>{words(b)}</li>)}</ul>
      : <p key={i} className={g.kind === 'heading' ? 'smart-note-heading' : undefined}>{words(g)}</p>)}
  </div>
}

/** A source's number: opens its line as a line link does; plain and muted once the line is gone. */
function SourceMark({ n, page, blockId }: { n: number; page: Page | undefined; blockId: string }) {
  const navigate = useNavigate()
  if (!page) return <sup className="smart-note-source is-gone">{n}</sup>
  const href = pagePath(page, blockId)
  return <sup className="smart-note-source"><a href={href} onClick={e => {
    e.preventDefault()
    // Nothing stays focused after a jump, so a phone keyboard goes down.
    if (jumpInPage(page.id, blockId)) { (document.activeElement as HTMLElement | null)?.blur(); return }
    void navigate({ href, resetScroll: false })
  }}>{n}</a></sup>
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const dayLabel = (d: LocalDate, today: LocalDate) => fromIso(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) })

/** "Read 14 pages · Oct 20 to Nov 12 · 6 older pages left out". */
function readLine(r: SmartResult, today: LocalDate): string {
  const span = r.from && r.to ? ` · ${r.from === r.to ? dayLabel(r.from, today) : `${dayLabel(r.from, today)} to ${dayLabel(r.to, today)}`}` : ''
  return `Read ${plural(r.pagesRead, 'page')}${span}${r.pagesLeftOut ? ` · ${plural(r.pagesLeftOut, 'older page')} left out` : ''}`
}

/** "just now", "5m ago", "2h ago", "3d ago". */
function ago(at: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000)
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`
}
function useMinute(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer) }, [])
  return now
}

/**
 * Whether the notes in range differ from what the result was made from: a comparison of stored content, no model call.
 * Reading the range is not cheap, so it runs when the tab is idle, once per (revision, note, day); meanwhile the last
 * answer for the note stands, so nothing flickers.
 */
const changedByNote = new Map<string, { key: string; changed: boolean }>()
function useNotesChanged(workspace: Workspace, note: SmartNote): boolean {
  const today = todayIso(), key = `${workspace.revision}|${today}`
  const [, setTick] = useState(0)
  useEffect(() => {
    if (changedByNote.get(note.id)?.key === key) return
    const check = () => { changedByNote.set(note.id, { key, changed: collectInput(workspace, note.range, today).key !== note.result.inputKey }); setTick(t => t + 1) }
    if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(check); return () => cancelIdleCallback(id) }
    const timer = setTimeout(check, 0)
    return () => clearTimeout(timer)
  }, [key, note, today, workspace])
  return changedByNote.get(note.id)?.changed ?? false
}

/** Fetched once per tab; false until known and when offline. */
let notesOn: boolean | null = null, askingOn = false
const onListeners = new Set<() => void>()
const subscribeOn = (l: () => void) => { onListeners.add(l); return () => { onListeners.delete(l) } }
export function useSmartNotesOn(): boolean {
  const { offline } = useWorkspace()
  const on = useSyncExternalStore(subscribeOn, () => notesOn, () => null)
  useEffect(() => {
    if (offline || notesOn !== null || askingOn) return
    askingOn = true
    smartNotesOn().then(r => { notesOn = r.on }, () => { /* unknown: asked again on the next mount */ }).finally(() => { askingOn = false; for (const l of onListeners) l() })
  }, [offline])
  return !offline && on === true
}

/** This tab's refresh of each note, shared by every place showing it. `error`: the server's, for a failed ask. */
type Ask = { state: 'idle' } | { state: 'running'; at: number } | { state: 'failed'; error: string | null }
const asks = new Map<string, Ask>()
const askListeners = new Set<() => void>()
const setAsk = (noteId: string, ask: Ask) => { asks.set(noteId, ask); for (const l of askListeners) l() }
const subscribeAsks = (l: () => void) => { askListeners.add(l); return () => { askListeners.delete(l) } }
const idle: Ask = { state: 'idle' }
/** No reply this long after asking: the ask is taken as lost, and Retry shows. */
const LOST_MS = 60_000

/** Asks for a refresh and stores the result through this tab's queue. Shared by every place showing the note. `error`: the server's, for a failed ask. */
export function useSmartRefresh(noteId: string): { state: 'idle' | 'running' | 'failed'; error: string | null; refresh(): void } {
  const { run } = useWorkspace()
  const ask = useSyncExternalStore(subscribeAsks, () => asks.get(noteId) ?? idle, () => idle)
  const refresh = useCallback(() => {
    if (asks.get(noteId)?.state === 'running') return
    const mine: Ask = { state: 'running', at: Date.now() }
    setAsk(noteId, mine)
    let outcome: Ask = { state: 'failed', error: null }
    const lost = setTimeout(() => { if (asks.get(noteId) === mine) setAsk(noteId, { state: 'failed', error: null }) }, LOST_MS)
    void (async () => {
      try {
        // The model reads what was typed, so every open page is saved first; a failed save stops the ask.
        if (!(await flushAllEditors())) return
        const reply = await askSmartNote({ data: { operationId: newOperationId(), today: todayIso(), noteId } })
        // Made from another account's workspace (the session changed meanwhile): it never goes into this one.
        if (reply.owner !== (workspaceOwner() ?? 'local')) { outcome = idle; return }
        if (reply.status === 'off') { outcome = idle; return }
        // The note was removed on the server meanwhile: its block shows that, with no error here.
        if (reply.status === 'failed') { outcome = reply.error === 'not-found' ? idle : { state: 'failed', error: reply.error }; return }
        let refused = false
        const receipt = await run({ type: 'set-smart-note-result', noteId, result: reply.result }, undefined, undefined, { quiet: true, inlineRefusal: /Smart note not found/, onRefused: () => { refused = true } })
        if (receipt || refused) outcome = idle
      } catch { /* nothing stored: Retry shows */ } finally {
        clearTimeout(lost)
        if (asks.get(noteId) === mine) setAsk(noteId, outcome)
      }
    })()
  }, [noteId, run])
  return { state: ask.state, error: ask.state === 'failed' ? ask.error : null, refresh }
}
