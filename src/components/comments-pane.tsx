// Comments on a page or row (docs/design/comments.md §2, step 1 of §6). At the side at 1280, a sheet at 390. Nothing shows until there's a comment.
// A note is written to its own table and never to the page, so it causes no save and a save can't touch it. What's typed stays until it's saved, with Retry if it wasn't.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { toast } from '@heroui/react'
import { useRouterState } from '@tanstack/react-router'
import { commentLimit, threadsOn, type Comment, type CommentThread } from '../domain/comments'
import type { Page } from '../domain/types'
import { CloseIcon, CommentIcon } from './icons'
import { useKeyboardTop } from './keyboard'
import { newOperationId, useWorkspace } from './use-day'

type Open = { pageId: string; composing: boolean; threadId: string | null }
let open: Open | null = null
/** A pane waiting for the page it's about, as a search hit opens it and goes there. */
let arriving: Open | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export function openComments(pageId: string, options: { composing?: boolean; threadId?: string; afterGoing?: boolean } = {}) {
  const opening = { pageId, composing: Boolean(options.composing), threadId: options.threadId ?? null }
  if (options.afterGoing) { arriving = opening; return }
  open = opening; changed()
}
/** The page a location shows. The pane is about one page, so going to another closes it. */
export const placeOf = (location: { pathname: string; search: unknown }) => { const { page, peek } = location.search as { page?: string; peek?: string }; return `${location.pathname}|${page ?? ''}|${peek ?? ''}` }
const closeComments = () => { open = null; changed() }
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** What's typed and not sent, for as long as this tab lives, so closing the pane or Esc loses nothing (§2). */
const drafts = new Map<string, string>()
type Sent = 'saved' | 'refused' | 'failed'
/** One send of some words. A Retry of them is the same operation with the same input, so a save that landed with its answer lost isn't made twice. */
type Stamp = { operationId: string; threadId: string; commentId: string; at: string }
type Run = ReturnType<typeof useWorkspace>['run']

const refusals = /^.*(Saved elsewhere|Changed elsewhere|That comment's gone|characters at most|needs words|in Trash).*$/
/**
 * One comment command. A tab behind the workspace is refused whatever it sends, and comes back up to date. That alone says nothing about this thread,
 * so it's sent once more, and the version the action carries decides: another page's change lets it through, a change to this thread doesn't (§3).
 */
async function send(run: Run, action: Parameters<Run>[0], { operationId = newOperationId(), notice, quiet }: { operationId?: string; notice?: Parameters<Run>[1]; quiet: boolean }): Promise<Sent> {
  let refusal: string | null = null
  const attempt = () => run(action, notice, operationId, { quiet, inlineRefusal: refusals, onRefused: message => { refusal = message } })
  let receipt = await attempt()
  if (!receipt && refusal !== null && /Saved elsewhere/.test(refusal)) { refusal = null; receipt = await attempt() }
  if (receipt) return 'saved'
  if (refusal === null) return 'failed'
  toast(/elsewhere/.test(refusal) ? 'Changed in another tab, so nothing was changed' : refusal, { timeout: 6000 })
  return 'refused'
}

/** A field that keeps its words until they're saved. ⌘Enter sends at 1280; on a phone Enter is a new line and the button sends. */
function CommentField({ draftKey, initial = '', label, action, placeholder, onDone, onCancel, autoFocus }: { draftKey: string; initial?: string; label: string; action: string; placeholder: string; onDone(body: string, stamp: Stamp): Promise<Sent>; onCancel?: () => void; autoFocus?: boolean }) {
  const [body, setBody] = useState(drafts.get(draftKey) ?? initial), [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const field = useRef<HTMLTextAreaElement>(null)
  const attempt = useRef<{ words: string; stamp: Stamp } | null>(null)
  useEffect(() => { if (autoFocus) field.current?.focus({ preventScroll: true }) }, [autoFocus])
  const over = body.trim().length > commentLimit
  const send = async () => {
    const words = body.trim()
    if (!words || over || state === 'saving') return
    setState('saving')
    if (attempt.current?.words !== words) attempt.current = { words, stamp: { operationId: newOperationId(), threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), at: new Date().toISOString() } }
    const result = await onDone(words, attempt.current.stamp)
    if (result === 'saved') { drafts.delete(draftKey); attempt.current = null; setBody('') }
    // A refusal says why by itself, and a Retry could only be refused again.
    setState(result === 'failed' ? 'failed' : 'idle')
  }
  return <div className="comment-field">
    <textarea ref={field} aria-label={label} placeholder={placeholder} rows={2} value={body} onChange={e => { setBody(e.target.value); drafts.set(draftKey, e.target.value); setState('idle') }}
      onKeyDown={e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
        // Esc cancels, keeping the draft if there are words (§2).
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (onCancel) onCancel(); else if (!body.trim()) closeComments(); else field.current?.blur() }
      }} />
    {over && <p className="comment-note" role="status">{commentLimit.toLocaleString('en-US')} characters at most</p>}
    {state === 'failed' && !over && <p className="comment-note" role="status">Not saved · <button type="button" className="app-link" onClick={() => void send()}>Retry</button></p>}
    <div className="comment-field-actions">
      {onCancel && <button type="button" className="app-link" onClick={() => { drafts.delete(draftKey); onCancel() }}>Cancel</button>}
      <button type="button" className="app-link" disabled={!body.trim() || over || state === 'saving'} onClick={() => void send()}>{action}</button>
    </div>
  </div>
}

function ThreadView({ thread, focused }: { thread: CommentThread; focused: boolean }) {
  const { run } = useWorkspace()
  // What's edited is the thread as it read when Edit was pressed, so a change since is refused rather than written over.
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null), [replying, setReplying] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focused) box.current?.scrollIntoView({ block: 'center' }) }, [focused])
  /** From a button, with no field to say so: a failure is the header's, with its Retry. */
  const act = (action: Parameters<Run>[0]) => void send(run, action, { notice: r => ({ text: r.message, undoOperationId: r.operationId }), quiet: false })
  return <div ref={box} className={`comment-thread${focused ? ' is-focused' : ''}`}>
    {thread.comments.map((comment: Comment) => <div key={comment.id} className="comment">
      <div className="comment-head">
        <time dateTime={comment.at}>{when(comment.at)}{comment.editedAt ? ' · edited' : ''}</time>
        <span className="comment-actions">
          <button type="button" className="app-link" onClick={() => setEditing({ id: comment.id, version: thread.version })}>Edit</button>
          <button type="button" className="app-link" onClick={() => act({ type: 'delete-comment', threadId: thread.id, commentId: comment.id, version: thread.version })}>Delete</button>
        </span>
      </div>
      {editing?.id === comment.id
        ? <CommentField draftKey={`edit:${comment.id}`} initial={comment.body} label="Edit comment" action="Save" placeholder="" autoFocus onCancel={() => setEditing(null)} onDone={async (body, { operationId, at }) => { const r = await send(run, { type: 'edit-comment', threadId: thread.id, commentId: comment.id, body, version: editing.version, at }, { operationId, quiet: true }); if (r === 'saved') setEditing(null); return r }} />
        : <p className="comment-body">{comment.body}</p>}
    </div>)}
    <div className="comment-thread-actions">
      <button type="button" className="app-link" onClick={() => setReplying(!replying)}>Reply</button>
      <button type="button" className="app-link" onClick={() => act({ type: 'resolve-thread', threadId: thread.id, resolved: !thread.resolvedAt, version: thread.version, at: new Date().toISOString() })}>{thread.resolvedAt ? 'Reopen' : 'Resolve'}</button>
    </div>
    {replying && <CommentField draftKey={`reply:${thread.id}`} label="Reply" action="Reply" placeholder="Reply" autoFocus onCancel={() => setReplying(false)} onDone={async (body, { operationId, commentId, at }) => { const r = await send(run, { type: 'add-comment', pageId: thread.pageId, threadId: thread.id, commentId, body, at }, { operationId, quiet: true }); if (r === 'saved') setReplying(false); return r }} />}
  </div>
}

export function CommentsPaneHost() {
  const current = useSyncExternalStore(subscribe, () => open, () => null)
  const place = useRouterState({ select: r => placeOf(r.location) }), seen = useRef(place)
  useEffect(() => {
    if (seen.current === place) return
    seen.current = place
    open = arriving; arriving = null; changed()
  }, [place])
  return current ? <CommentsPane key={current.pageId} pageId={current.pageId} composing={current.composing} threadId={current.threadId} /> : null
}
function CommentsPane({ pageId, composing, threadId }: { pageId: string; composing: boolean; threadId: string | null }) {
  const { workspace, run } = useWorkspace()
  const threads = threadsOn(workspace?.threads, pageId)
  const opened = threads.find(t => t.id === threadId)
  const [show, setShow] = useState<'open' | 'resolved'>(opened?.resolvedAt ? 'resolved' : 'open')
  const shown = threads.filter(t => (show === 'open') === !t.resolvedAt), other = threads.length - shown.length
  const keyboardTop = useKeyboardTop()
  const phone = window.matchMedia('(max-width: 899px)').matches
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as Element).closest?.('.comment-field')) { e.preventDefault(); e.stopPropagation(); closeComments() } }
    document.addEventListener('keydown', esc, true)
    return () => document.removeEventListener('keydown', esc, true)
  }, [])
  const add = (body: string, { operationId, threadId, commentId, at }: Stamp) => send(run, { type: 'add-comment', pageId, threadId, commentId, body, at }, { operationId, quiet: true })
  return createPortal(<aside className={`comments-pane${phone ? ' is-sheet' : ''}`} aria-label="Comments" style={phone && keyboardTop !== null ? { bottom: window.innerHeight - keyboardTop, height: Math.min(window.innerHeight * 0.7, (window.visualViewport?.height ?? window.innerHeight) - 8) } : undefined}>
    <header className="comments-pane-head">
      <h2>Comments</h2>
      <span role="tablist" className="comments-pane-tabs">
        <button type="button" role="tab" aria-selected={show === 'open'} className={show === 'open' ? 'is-on' : ''} onClick={() => setShow('open')}>Open</button>
        <button type="button" role="tab" aria-selected={show === 'resolved'} className={show === 'resolved' ? 'is-on' : ''} onClick={() => setShow('resolved')}>Resolved</button>
      </span>
      <button type="button" className="comments-pane-close" aria-label="Close comments" onClick={closeComments}><CloseIcon /></button>
    </header>
    <div className="comments-pane-list">
      {shown.map(t => <ThreadView key={t.id} thread={t} focused={t.id === threadId} />)}
      {!shown.length && <p className="comment-note">{show === 'open' ? (other ? `No open comments · ${other} resolved` : 'No comments') : 'Nothing resolved'}</p>}
    </div>
    {show === 'open' && <CommentField draftKey={`new:${pageId}`} label="New comment" action="Comment" placeholder="Add a comment" autoFocus={composing && !phone} onDone={add} />}
  </aside>, document.body)
}

/** How many open comments a page has, in its head. None, nothing's drawn (P2-1). */
export function CommentCount({ page }: { page: Pick<Page, 'id'> }) {
  const { workspace } = useWorkspace()
  const count = (workspace?.threads ?? []).filter(t => t.pageId === page.id && !t.resolvedAt).length
  if (!count) return null
  return <button type="button" className="comment-count" aria-label={`${count} ${count === 1 ? 'comment' : 'comments'}`} onClick={() => openComments(page.id)}><CommentIcon /><span>{count}</span></button>
}
