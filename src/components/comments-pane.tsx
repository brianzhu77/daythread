// Comments on a page or row (docs/design/comments.md §2, step 1 of §6). At the side at 1280, a sheet at 390. Nothing shows until there's a comment.
// A note is written to its own table and never to the page, so it causes no save and a save can't touch it. What's typed stays until it's saved, with Retry if it wasn't.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { toast } from '@heroui/react'
import { commentLimit, threadsOn, type Comment, type CommentThread } from '../domain/comments'
import type { Page } from '../domain/types'
import { CloseIcon, CommentIcon } from './icons'
import { useKeyboardTop } from './keyboard'
import { newOperationId, useWorkspace } from './use-day'

let open: { pageId: string; composing: boolean; threadId: string | null } | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export function openComments(pageId: string, options: { composing?: boolean; threadId?: string } = {}) { open = { pageId, composing: Boolean(options.composing), threadId: options.threadId ?? null }; changed() }
const closeComments = () => { open = null; changed() }
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** A field that keeps its words until they're saved. ⌘Enter sends at 1280; on a phone Enter is a new line and the button sends. */
function CommentField({ initial = '', label, action, placeholder, onDone, onCancel, autoFocus }: { initial?: string; label: string; action: string; placeholder: string; onDone(body: string): Promise<'saved' | 'kept'>; onCancel?: () => void; autoFocus?: boolean }) {
  const [body, setBody] = useState(initial), [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (autoFocus) field.current?.focus({ preventScroll: true }) }, [autoFocus])
  const over = body.trim().length > commentLimit
  const send = async () => {
    const words = body.trim()
    if (!words || over || state === 'saving') return
    setState('saving')
    const result = await onDone(words)
    if (result === 'saved') { setBody(''); setState('idle') } else setState('failed')
  }
  return <div className="comment-field">
    <textarea ref={field} aria-label={label} placeholder={placeholder} rows={2} value={body} onChange={e => { setBody(e.target.value); setState('idle') }}
      onKeyDown={e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
        // Esc cancels, keeping the draft if there are words (§2).
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (onCancel) onCancel(); else if (!body.trim()) closeComments(); else field.current?.blur() }
      }} />
    {over && <p className="comment-note" role="status">{commentLimit.toLocaleString('en-US')} characters at most</p>}
    {state === 'failed' && !over && <p className="comment-note" role="status">Not saved · <button type="button" className="app-link" onClick={() => void send()}>Retry</button></p>}
    <div className="comment-field-actions">
      {onCancel && <button type="button" className="app-link" onClick={onCancel}>Cancel</button>}
      <button type="button" className="app-link" disabled={!body.trim() || over || state === 'saving'} onClick={() => void send()}>{action}</button>
    </div>
  </div>
}

function ThreadView({ thread, focused }: { thread: CommentThread; focused: boolean }) {
  const { run } = useWorkspace()
  const [editing, setEditing] = useState<string | null>(null), [replying, setReplying] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focused) box.current?.scrollIntoView({ block: 'center' }) }, [focused])
  const refused = (message: string) => toast(/Changed elsewhere/.test(message) ? 'Changed in another tab, so nothing was changed' : message, { timeout: 6000 })
  /** What's typed stays on anything but a save. A refusal says why, and only a failed connection is worth a Retry. */
  const save = async (action: Parameters<typeof run>[0], notice?: Parameters<typeof run>[1]): Promise<'saved' | 'kept'> => {
    const receipt = await run(action, notice, newOperationId(), { quiet: true, inlineRefusal: /Changed elsewhere|That comment's gone|characters at most|needs words/, onRefused: refused })
    return receipt ? 'saved' : 'kept'
  }
  const withUndo = (r: { message: string; operationId: string }) => ({ text: r.message, undoOperationId: r.operationId })
  return <div ref={box} className={`comment-thread${focused ? ' is-focused' : ''}`}>
    {thread.comments.map((comment: Comment) => <div key={comment.id} className="comment">
      <div className="comment-head">
        <time dateTime={comment.at}>{when(comment.at)}{comment.editedAt ? ' · edited' : ''}</time>
        <span className="comment-actions">
          <button type="button" className="app-link" onClick={() => setEditing(comment.id)}>Edit</button>
          <button type="button" className="app-link" onClick={() => void save({ type: 'delete-comment', threadId: thread.id, commentId: comment.id, version: thread.version }, withUndo)}>Delete</button>
        </span>
      </div>
      {editing === comment.id
        ? <CommentField initial={comment.body} label="Edit comment" action="Save" placeholder="" autoFocus onCancel={() => setEditing(null)} onDone={async body => { const r = await save({ type: 'edit-comment', threadId: thread.id, commentId: comment.id, body, version: thread.version, at: new Date().toISOString() }); if (r === 'saved') setEditing(null); return r }} />
        : <p className="comment-body">{comment.body}</p>}
    </div>)}
    <div className="comment-thread-actions">
      <button type="button" className="app-link" onClick={() => setReplying(!replying)}>Reply</button>
      <button type="button" className="app-link" onClick={() => void save({ type: 'resolve-thread', threadId: thread.id, resolved: !thread.resolvedAt, version: thread.version, at: new Date().toISOString() }, withUndo)}>{thread.resolvedAt ? 'Reopen' : 'Resolve'}</button>
    </div>
    {replying && <CommentField label="Reply" action="Reply" placeholder="Reply" autoFocus onCancel={() => setReplying(false)} onDone={async body => { const r = await save({ type: 'add-comment', pageId: thread.pageId, threadId: thread.id, commentId: crypto.randomUUID(), body, at: new Date().toISOString() }); if (r === 'saved') setReplying(false); return r }} />}
  </div>
}

export function CommentsPaneHost() {
  const current = useSyncExternalStore(subscribe, () => open, () => null)
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
  const add = async (body: string): Promise<'saved' | 'kept'> => {
    const receipt = await run({ type: 'add-comment', pageId, threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), body, at: new Date().toISOString() }, undefined, newOperationId(), { quiet: true, inlineRefusal: /characters at most|needs words|in Trash/, onRefused: message => toast(message, { timeout: 6000 }) })
    return receipt ? 'saved' : 'kept'
  }
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
    {show === 'open' && <CommentField label="New comment" action="Comment" placeholder="Add a comment" autoFocus={composing && !phone} onDone={add} />}
  </aside>, document.body)
}

/** How many open comments a page has, in its head. None, nothing's drawn (P2-1). */
export function CommentCount({ page }: { page: Pick<Page, 'id'> }) {
  const { workspace } = useWorkspace()
  const count = (workspace?.threads ?? []).filter(t => t.pageId === page.id && !t.resolvedAt).length
  if (!count) return null
  return <button type="button" className="comment-count" aria-label={`${count} ${count === 1 ? 'comment' : 'comments'}`} onClick={() => openComments(page.id)}><CommentIcon /><span>{count}</span></button>
}
