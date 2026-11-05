// Comments (docs/design/comments.md): a note attached to a page or row, kept out of its words. In a table of their own, never in a document, so a save can't touch one and a comment causes no save.
// Each thread has its own version: an edit, a delete or a resolve from a tab that hadn't seen the newest change to it is refused, and says so.
import { lineIdsOnPage, recordOfLine } from './synced.ts'
import type { Page, Workspace } from './types.ts'

export const commentLimit = 2000
/** Commands that write a note and leave the one Undo where it was. */
export const noteCommands = ['add-comment', 'edit-comment']
export const leavesUndoAlone = (type: string): boolean => noteCommands.includes(type)
export interface Comment { id: string; body: string; at: string; editedAt?: string }
/** A thread on a line: its block's id, which a move and a cut keep, and the words it was on, for when the line's gone (comments.md §4). */
export interface CommentAnchor {
  blockId: string
  quote: string
  /** On a to-do's line: its task, as planning it to another day makes it a new line there, and the thread goes too. */
  taskId?: string
  /** On selected words: where they start in the line, `quote` being those words. If they don't match there any more, it's on the whole line. */
  at?: number
}
export const quoteLimit = 300
export interface CommentThread {
  id: string
  pageId: string
  anchor?: CommentAnchor
  version: number
  createdAt: string
  resolvedAt?: string
  comments: Comment[]
}
export const lastTouched = (t: CommentThread): string => t.comments.reduce((latest, c) => (c.at > latest ? c.at : latest), t.createdAt)
/** Newest reply first (P2-3). */
export const threadsOn = (threads: readonly CommentThread[] | undefined, pageId: string): CommentThread[] =>
  (threads ?? []).filter(t => t.pageId === pageId).sort((a, b) => lastTouched(b).localeCompare(lastTouched(a)))
/** The threads a page shows: its own, and those on a shared line it holds a place of, as a thread belongs to the shared lines (comments.md §4). */
export function threadsShownOn(ws: Pick<Workspace, 'threads' | 'synced' | 'pages'>, pageId: string): CommentThread[] {
  const page = ws.pages.find(p => p.id === pageId), all = ws.threads ?? []
  if (!ws.synced?.length || !page) return threadsOn(all, pageId)
  const shown = all.filter(t => t.pageId === pageId || (t.anchor && recordOfLine(ws, t.anchor.blockId) && lineIdsOnPage(page, t.anchor.blockId, true).length > 0))
  return [...shown].sort((a, b) => lastTouched(b).localeCompare(lastTouched(a)))
}
/** A thread's line's ids on this page: its places while the line is shared, its own otherwise. */
export const threadLineIds = (ws: Pick<Workspace, 'synced'>, page: Pick<Page, 'document'>, anchor: CommentAnchor): string[] => lineIdsOnPage(page, anchor.blockId, Boolean(recordOfLine(ws, anchor.blockId)))
