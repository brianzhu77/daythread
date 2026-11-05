// Comments on a page or row (docs/design/comments.md §2, step 1 of §6). At the side at 1280, a sheet at 390. Nothing shows until there's a comment.
// A note is written to its own table and never to the page, so it causes no save and a save can't touch it. What's typed stays until it's saved, with Retry if it wasn't.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { toast } from '@heroui/react'
import { useRouterState } from '@tanstack/react-router'
import { commentLimit, threadsShownOn, type Comment, type CommentAnchor, type CommentThread } from '../domain/comments'
import { lineIdsOnPage } from '../domain/synced'
import type { Page } from '../domain/types'
import { CloseIcon, CommentIcon } from './icons'
import { useKeyboardTop } from './keyboard'
import { newOperationId, useWorkspace, workspaceOwner } from './use-day'

type Open = { pageId: string; composing: boolean; threadId: string | null; anchor: CommentAnchor | null }
let open: Open | null = null
/** A pane waiting for the page it's about, as a search hit opens it and goes there. */
let arriving: Open | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export function openComments(pageId: string, options: { composing?: boolean; threadId?: string; afterGoing?: boolean; anchor?: CommentAnchor } = {}) {
  const opening = { pageId, composing: Boolean(options.composing), threadId: options.threadId ?? null, anchor: options.anchor ?? null }
  if (options.afterGoing) { arriving = opening; return }
  open = opening; changed()
}
/** The page a location shows. The pane is about one page, so going to another closes it. */
export const placeOf = (location: { pathname: string; search: unknown }) => { const { page, peek } = location.search as { page?: string; peek?: string }; return `${location.pathname}|${page ?? ''}|${peek ?? ''}` }
const closeComments = () => { open = null; changed() }
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** What's typed and not sent, so closing the pane, Esc or a phone discarding the tab loses nothing (§2). Kept under the account, as a day's id is the same in every account. */
const draftAt = (key: string) => `daythread.comment-draft.${workspaceOwner() ?? ''}.${key}`
const drafts = {
  get(key: string): string | null { try { return sessionStorage.getItem(draftAt(key)) } catch { return null } },
  set(key: string, words: string) { try { sessionStorage.setItem(draftAt(key), words) } catch { /* It stays on screen, which is the most that can be done. */ } },
  delete(key: string) { try { sessionStorage.removeItem(draftAt(key)) } catch { /* As above. */ } },
}
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
function CommentField({ draftKey, initial = '', label, action, placeholder, onDone, onSaved, replaces, onCancel, autoFocus }: { draftKey: string; initial?: string; label: string; action: string; placeholder: string; onDone(body: string, stamp: Stamp): Promise<Sent>; /** After a save, with what was typed during it, if anything. */ onSaved?: (left: string) => void; /** It rewrites the whole comment, so what's in the field stays whole. */ replaces?: boolean; onCancel?: () => void; autoFocus?: boolean }) {
  const [body, setBody] = useState(drafts.get(draftKey) ?? initial), [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle')
  // What's in the field now, for a reply to read when it arrives, as typing goes on during a send.
  const typed = useRef(body)
  const field = useRef<HTMLTextAreaElement>(null)
  const attempt = useRef<{ words: string; stamp: Stamp } | null>(null)
  useEffect(() => { if (autoFocus) field.current?.focus({ preventScroll: true }) }, [autoFocus])
  const over = body.trim().length > commentLimit
  const send = async () => {
    const sent = typed.current, words = sent.trim()
    if (!words || sent.trim().length > commentLimit || state === 'saving') return
    setState('saving')
    if (attempt.current?.words !== words) attempt.current = { words, stamp: { operationId: newOperationId(), threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), at: new Date().toISOString() } }
    const result = await onDone(words, attempt.current.stamp)
    if (result === 'saved') {
      // Only what went: anything typed since is the next draft.
      const now = typed.current, left = now === sent ? '' : !replaces && now.startsWith(sent) ? now.slice(sent.length).trimStart() : now
      attempt.current = null
      typed.current = left
      setBody(left)
      if (left) drafts.set(draftKey, left); else drafts.delete(draftKey)
      onSaved?.(left)
    }
    // A refusal says why by itself, and a Retry could only be refused again.
    setState(result === 'failed' ? 'failed' : 'idle')
  }
  return <div className="comment-field">
    <textarea ref={field} aria-label={label} placeholder={placeholder} rows={2} value={body} onChange={e => { typed.current = e.target.value; setBody(e.target.value); drafts.set(draftKey, e.target.value); setState('idle') }}
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

// Its own id, or as a place of a shared line.
const lineOf = (blockId: string) => document.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(blockId)}"], [data-node-type="blockContainer"][data-id^="${CSS.escape(blockId)}:"]`)
/** Goes to the line, and shows which it is for a moment. */
function goToLine(blockId: string) {
  const line = lineOf(blockId)
  if (!line) return
  line.scrollIntoView({ block: 'center' })
  line.classList.add('is-comment-target')
  setTimeout(() => line.classList.remove('is-comment-target'), 1600)
}
function ThreadView({ thread, focused }: { thread: CommentThread; focused: boolean }) {
  const { run, workspace } = useWorkspace()
  const anchor = thread.anchor, page = anchor ? workspace?.pages.find(p => p.id === thread.pageId) : undefined
  // On the page as saved, or on screen, as it may not have been saved yet.
  const gone = anchor ? !lineOf(anchor.blockId) && !(page && lineIdsOnPage(page, anchor.blockId).length) : false
  const hidden = anchor ? lineOf(anchor.blockId)?.getBoundingClientRect().height === 0 : false
  // What's edited is the thread as it read when Edit was pressed, so a change since is refused rather than written over.
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null), [replying, setReplying] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focused) box.current?.scrollIntoView({ block: 'center' }) }, [focused])
  /** From a button, with no field to say so: a failure is the header's, with its Retry. */
  const act = (action: Parameters<Run>[0]) => void send(run, action, { notice: r => ({ text: r.message, undoOperationId: r.operationId }), quiet: false })
  return <div ref={box} className={`comment-thread${focused ? ' is-focused' : ''}`}>
    {anchor && (gone
      ? <p className="comment-quote is-gone">Line removed{anchor.quote ? ` · ${anchor.quote}` : ''}</p>
      // An empty row hidden on a past day is there, but there's nowhere to go: its words, and no button that seems to do nothing.
      : hidden ? <p className="comment-quote">{anchor.quote || 'An empty line'}</p>
      : <button type="button" className="comment-quote" onClick={() => goToLine(anchor.blockId)}>{anchor.quote || 'An empty line'}</button>)}
    {thread.comments.map((comment: Comment) => <div key={comment.id} className="comment">
      <div className="comment-head">
        <time dateTime={comment.at}>{when(comment.at)}{comment.editedAt ? ' · edited' : ''}</time>
        <span className="comment-actions">
          <button type="button" className="app-link" onClick={() => setEditing({ id: comment.id, version: thread.version })}>Edit</button>
          <button type="button" className="app-link" onClick={() => act({ type: 'delete-comment', threadId: thread.id, commentId: comment.id, version: thread.version })}>Delete</button>
        </span>
      </div>
      {editing?.id === comment.id
        ? <CommentField draftKey={`edit:${comment.id}`} initial={comment.body} label="Edit comment" action="Save" placeholder="" autoFocus replaces onCancel={() => setEditing(null)} onDone={(body, { operationId, at }) => send(run, { type: 'edit-comment', threadId: thread.id, commentId: comment.id, body, version: editing.version, at }, { operationId, quiet: true })} onSaved={left => setEditing(left ? { id: comment.id, version: editing.version + 1 } : null)} />
        : <p className="comment-body">{comment.body}</p>}
    </div>)}
    <div className="comment-thread-actions">
      <button type="button" className="app-link" onClick={() => setReplying(!replying)}>Reply</button>
      <button type="button" className="app-link" onClick={() => act({ type: 'resolve-thread', threadId: thread.id, resolved: !thread.resolvedAt, version: thread.version, at: new Date().toISOString() })}>{thread.resolvedAt ? 'Reopen' : 'Resolve'}</button>
    </div>
    {replying && <CommentField draftKey={`reply:${thread.id}`} label="Reply" action="Reply" placeholder="Reply" autoFocus onCancel={() => setReplying(false)} onDone={(body, { operationId, commentId, at }) => send(run, { type: 'add-comment', pageId: thread.pageId, threadId: thread.id, commentId, body, at }, { operationId, quiet: true })} onSaved={left => { if (!left) setReplying(false) }} />}
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
  return current ? <CommentsPane key={`${current.pageId}|${current.anchor?.blockId ?? ''}`} pageId={current.pageId} composing={current.composing} threadId={current.threadId} anchor={current.anchor} /> : null
}
function CommentsPane({ pageId, composing, threadId, anchor }: { pageId: string; composing: boolean; threadId: string | null; anchor: CommentAnchor | null }) {
  const { workspace, run } = useWorkspace()
  const threads = workspace ? threadsShownOn(workspace, pageId) : []
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
  const add = async (body: string, { operationId, threadId, commentId, at }: Stamp) => {
    written.current = threadId
    return send(run, { type: 'add-comment', pageId, threadId, commentId, body, at, ...(anchor ? { anchor } : {}) }, { operationId, quiet: true })
  }
  // Written on that line, the next one in this pane is on the page again, unless a line is asked for. Not while there are words typed since: they're for this line (Ratchet).
  const written = useRef<string | null>(null)
  const afterSent = (left: string) => { if (anchor && !left && written.current) openComments(pageId, { threadId: written.current }) }
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
    {show === 'open' && anchor && <p className="comment-quote is-composing">{anchor.quote || 'An empty line'}</p>}
    {show === 'open' && <CommentField draftKey={anchor ? `new:${pageId}:${anchor.blockId}` : `new:${pageId}`} label="New comment" action="Comment" placeholder={anchor ? 'Comment on this line' : 'Add a comment'} autoFocus={composing && !phone} onDone={add} onSaved={afterSent} />}
  </aside>, document.body)
}

/** How many open comments a page has, in its head. None, nothing's drawn (P2-1). */
export function CommentCount({ page }: { page: Pick<Page, 'id'> }) {
  const { workspace } = useWorkspace()
  const count = workspace ? threadsShownOn(workspace, page.id).filter(t => !t.resolvedAt).length : 0
  if (!count) return null
  return <button type="button" className="comment-count" aria-label={`${count} ${count === 1 ? 'comment' : 'comments'}`} onClick={() => openComments(page.id)}><CommentIcon /><span>{count}</span></button>
}
