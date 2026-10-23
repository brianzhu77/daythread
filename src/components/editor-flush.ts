// Commands from outside the editor that change an open page (the morning card) must not land on top of unsaved
// typing: the editor would then refuse the outside change ("Page changed elsewhere"). The open editor registers its
// save here; such a command first saves what was typed and does nothing if that save fails (Lead 5f3615d0).
const flushers = new Map<string, () => Promise<boolean>>()

// B40: an editor that is mounting has read (or is about to read) this tab's draft for its page, so a background save
// must leave that page alone from the first render, not only once the editor has registered its flush.
const mounting = new Set<string>()
export const noteEditorMounting = (pageId: string) => { mounting.add(pageId) }
export const doneEditorMounting = (pageId: string) => { mounting.delete(pageId) }

export function registerEditorFlush(pageId: string, flush: () => Promise<boolean>): () => void {
  flushers.set(pageId, flush); mounting.delete(pageId)
  return () => { if (flushers.get(pageId) === flush) flushers.delete(pageId) }
}

/** Saves what was typed on that page; true when nothing is left unsaved (or no editor is open for it). */
export async function flushEditor(pageId: string): Promise<boolean> {
  const flush = flushers.get(pageId)
  return flush ? flush() : true
}

// Saves an editor sends as it closes (leaving the page). On the phone he types on a page, opens Pages and taps Export:
// that page's editor is already gone and its save may still be on its way (Ratchet 8b6615ff). A failed one leaves the
// text in this tab's draft, which Export recovers (draft-recovery.ts).
const leaving = new Set<Promise<boolean>>()
/** Registers a closing editor's save. */
export function trackLeaveSave(save: Promise<unknown>): void {
  const settled = save.then(() => true, () => true)
  leaving.add(settled)
  void settled.finally(() => leaving.delete(settled))
}

/** Pages with an editor open in this tab: their drafts are theirs to save. */
export const openEditorPages = (): Set<string> => new Set([...flushers.keys(), ...mounting])
/** True while a closing editor's save is still on its way (its draft isn't "kept" yet). */
export const leaveSavesPending = (): boolean => leaving.size > 0

/** Saves every open editor and waits for closing ones to finish; true when no open editor is left unsaved. */
export async function flushAllEditors(): Promise<boolean> {
  const [saved] = await Promise.all([Promise.all([...flushers.values()].map(flush => flush())), Promise.all([...leaving])])
  return saved.every(Boolean)
}

// The document each page's editor last saved as it closed. When he comes back before that save lands, the page then
// changes under the new editor; that change is his own, not another tab's, so the editor carries on from it instead of
// reporting a conflict (Jazz, Ratchet #99).
const leaveSaves = new Map<string, string>()
export const rememberLeaveSave = (pageId: string, document: string) => { leaveSaves.set(pageId, document) }
export const isOwnLeaveSave = (pageId: string, editorJSON: string | undefined) => editorJSON !== undefined && leaveSaves.get(pageId) === editorJSON
