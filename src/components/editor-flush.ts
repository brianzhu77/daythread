// Commands from outside the editor that change an open page (the morning card) must not land on top of unsaved
// typing: the editor would then refuse the outside change ("Page changed elsewhere"). The open editor registers its
// save here; such a command first saves what was typed and does nothing if that save fails (Lead 5f3615d0).
const flushers = new Map<string, () => Promise<boolean>>()

export function registerEditorFlush(pageId: string, flush: () => Promise<boolean>): () => void {
  flushers.set(pageId, flush)
  return () => { if (flushers.get(pageId) === flush) flushers.delete(pageId) }
}

/** Saves what was typed on that page; true when nothing is left unsaved (or no editor is open for it). */
export async function flushEditor(pageId: string): Promise<boolean> {
  const flush = flushers.get(pageId)
  return flush ? flush() : true
}

// Saves an editor sends as it closes (leaving the page). On the phone he types on a page, opens Pages and taps Export:
// that page's editor is already gone, and its save may still be on its way, or may have failed and left the text only
// in this device's draft (Ratchet 8b6615ff). Export waits for the first and refuses while any of the second remain.
const leaving = new Set<Promise<boolean>>()
const unsavedPages = new Set<string>()
/** Registers a closing editor's save; it resolves true once saved (or nothing needed saving). */
export function trackLeaveSave(pageId: string, save: Promise<boolean>): void {
  leaving.add(save)
  void save.then(saved => { if (saved) unsavedPages.delete(pageId); else unsavedPages.add(pageId) }, () => unsavedPages.add(pageId)).finally(() => leaving.delete(save))
}

/**
 * Saves every open editor and waits for closing ones; true when nothing is left unsaved anywhere. A page whose save
 * failed as it closed counts as unsaved until its editor, opened again, has saved it.
 */
export async function flushAllEditors(): Promise<boolean> {
  const open = [...flushers.entries()]
  const [saved] = await Promise.all([Promise.all(open.map(([, flush]) => flush())), Promise.allSettled([...leaving])])
  open.forEach(([pageId], i) => { if (saved[i]) unsavedPages.delete(pageId) })
  return saved.every(Boolean) && unsavedPages.size === 0
}

// The document each page's editor last saved as it closed. When he comes back before that save lands, the page then
// changes under the new editor; that change is his own, not another tab's, so the editor carries on from it instead of
// reporting a conflict (Jazz, Ratchet #99).
const leaveSaves = new Map<string, string>()
export const rememberLeaveSave = (pageId: string, document: string) => { leaveSaves.set(pageId, document) }
export const isOwnLeaveSave = (pageId: string, editorJSON: string | undefined) => editorJSON !== undefined && leaveSaves.get(pageId) === editorJSON
