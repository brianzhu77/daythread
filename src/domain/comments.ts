// Comments (docs/design/comments.md): a note attached to a page or row, kept out of its words. In a table of their own, never in a document, so a save can't touch one and a comment causes no save.
// Each thread has its own version: an edit, a delete or a resolve from a tab that hadn't seen the newest change to it is refused, and says so.
export const commentLimit = 2000
export interface Comment { id: string; body: string; at: string; editedAt?: string }
export interface CommentThread {
  id: string
  pageId: string
  version: number
  createdAt: string
  resolvedAt?: string
  comments: Comment[]
}
export const lastTouched = (t: CommentThread): string => t.comments.reduce((latest, c) => (c.at > latest ? c.at : latest), t.createdAt)
/** Newest reply first (P2-3). */
export const threadsOn = (threads: readonly CommentThread[] | undefined, pageId: string): CommentThread[] =>
  (threads ?? []).filter(t => t.pageId === pageId).sort((a, b) => lastTouched(b).localeCompare(lastTouched(a)))
