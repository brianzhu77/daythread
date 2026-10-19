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
