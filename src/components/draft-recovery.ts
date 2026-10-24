import { mergeDraft } from '../domain/draft-merge.ts'
import { editorSeed, needsTemplateRows, pageContentKey, type EditorNode } from '../domain/editor-document.ts'
import type { Action, Page, Receipt, Workspace } from '../domain/types.ts'
import { todayIso } from './dates.ts'
import { claim, clearOwn, orphans, ownDrafts, release, take, withoutSaved, type DraftSlot } from './draft-slots.ts'
import { openEditorPages } from './editor-flush.ts'

/**
 * B3 export (Bumblebee option 1, Lead 934743fe, ff82e7c8): text kept as a draft because its save failed (this tab's
 * editor closed or the tab reloaded, or a tab that's gone) is saved before an export, the way opening its page would:
 * this tab's own draft as it is when the page hasn't changed since; otherwise merged into the latest page (B35's merge
 * for a gone tab's draft, Load latest's for a conflict). A live tab's draft is never taken.
 */
export function recoveredDocument(ws: Workspace, page: Page, slot: DraftSlot, own: boolean, today = todayIso()): EditorNode[] {
  const draft = JSON.parse(slot.document) as EditorNode[]
  if (own && slot.base === pageContentKey(page)) return draft
  const [baseSections, baseJSON] = JSON.parse(slot.base) as [Page['sections'], string | null]
  const started = { ...page, sections: baseSections, editorJSON: baseJSON ?? undefined, editorSections: JSON.stringify(baseSections) } as Page
  const seed = (p: Page) => editorSeed(p, ws, { templateRows: needsTemplateRows(p, today) }) as EditorNode[]
  const latest = seed(page)
  return mergeDraft(seed(started), withoutSaved(draft, latest), latest, new Set(ws.tasks.map(t => t.id))).document
}

type Run = (action: Action, notice?: undefined, operationId?: string, options?: { inlineRefusal?: RegExp; onRefused?: () => void; onFailure?: (message: string) => void; quiet?: boolean }) => Promise<Receipt | null>

/** A failure the network will fix by itself (offline, a timeout, a gateway), as opposed to a refusal. */
export function isNetworkFailure(message: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return /failed to fetch|networkerror|network error|load failed|fetch failed|timed? ?out|unavailable|bad gateway|gateway|\b50[234]\b|connection/i.test(message)
}

/**
 * B40 (Roadbuster's conditions 1 and 5): one save of kept drafts at a time, across this browser's tabs and with Export,
 * so a gone tab's draft held by two tabs is saved once. Without Web Locks, one at a time within this tab.
 */
let chain: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: { request: (name: string, cb: () => Promise<T>) => Promise<T> } }).locks : undefined
  if (locks) return locks.request('daythread-kept-drafts', work)
  const next = chain.then(work, work)
  chain = next.catch(() => undefined)
  return next
}

// The page whose kept draft is being saved right now in this tab: an editor opening on it waits (continuous-page).
const saving = new Map<string, Promise<void>>()
export const keptSaveFor = (pageId: string): Promise<void> | undefined => saving.get(pageId)

// A closed tab's text saved without its page open: "Added unsaved text from another tab" once, when it next opens
// here (Bumblebee, Lead a0173c36). An editor already open on it hears it at once.
const noticeKey = 'daythread:recovered-notice'
export const recoveredEvent = 'daythread:recovered-text'
function noteRecovered(pageId: string) {
  try { const ids = new Set(JSON.parse(sessionStorage.getItem(noticeKey) ?? '[]') as string[]); ids.add(pageId); sessionStorage.setItem(noticeKey, JSON.stringify([...ids])) } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(recoveredEvent, { detail: pageId }))
}
/** True (once) when a closed tab's text was saved into this page since it was last open here. */
export function takeRecoveredNotice(pageId: string): boolean {
  try {
    const ids = new Set(JSON.parse(sessionStorage.getItem(noticeKey) ?? '[]') as string[])
    if (!ids.delete(pageId)) return false
    sessionStorage.setItem(noticeKey, JSON.stringify([...ids]))
    return true
  } catch { return false }
}

export interface KeptFailure { pageId: string; message: string }

/**
 * Saves every kept draft (this tab's, for pages not open here; gone tabs', for any page); true when none is left.
 * `quiet` (the background retry) keeps a failure out of the header; `onFailure` hears which page failed and why.
 */
export function saveKeptDrafts(refresh: () => Promise<Workspace>, run: Run, skip: Set<string>, options: { quiet?: boolean; leaveOpenPages?: boolean; onFailure?: (failure: KeptFailure) => void } = {}): Promise<boolean> {
  return oneAtATime(async () => {
    let ws = await refresh()
    // A page open here keeps its own draft in its editor (just saved by flushAllEditors); a gone tab's draft for it is
    // still saved by Export, since the editor only merges those as it opens (Ratchet 95eb05f4), and the open editor,
    // clean after the flush, then follows the saved page. The background retry (`leaveOpenPages`) has flushed nothing:
    // an editor open there may be mid-typing, and saving under it would give him a conflict of our own making
    // (Roadbuster 6958aa41). That draft waits until he leaves the page, or for Export.
    const leave = (pageId: string) => options.leaveOpenPages && (skip.has(pageId) || openEditorPages().has(pageId))
    const kept = [
      ...ownDrafts().filter(d => !skip.has(d.pageId)).map(d => ({ ...d, key: null as string | null })),
      ...ws.pages.filter(p => !leave(p.id)).flatMap(p => orphans(p.id).map(o => ({ pageId: p.id, slot: o.slot, key: o.key as string | null }))),
    ]
    for (const { pageId, slot, key } of kept) {
      const page = ws.pages.find(p => p.id === pageId)
      // Its page is gone (deleted elsewhere): there's nothing to save it into, and its words aren't exported either.
      if (!page || page.trashedAt) continue
      // An editor started opening on this page meanwhile: its own draft is the editor's now (Roadbuster condition 5).
      if ((key === null || leave(pageId)) && openEditorPages().has(pageId)) continue
      // Another tab (or that page's editor here) merged this gone tab's draft while we waited for the lock; else it's ours
      // until the save is done, so an editor opening the page elsewhere doesn't merge it too.
      if (key !== null && !take(pageId, key)) continue
      let document: EditorNode[]
      try { document = recoveredDocument(ws, page, slot, key === null) } catch { if (key !== null) release(pageId, key); return false }
      let failure = ''
      let done!: () => void
      saving.set(pageId, new Promise<void>(resolve => { done = resolve }))
      try {
        const receipt = await run({ type: 'save-editor', pageId, expectedContent: pageContentKey(page), document: JSON.stringify(document), ...(slot.cutTaskIds?.length ? { cutTaskIds: slot.cutTaskIds } : {}), today: todayIso() }, undefined, undefined, { inlineRefusal: /changed elsewhere|changed since/i, onRefused: () => { failure = 'changed elsewhere' }, onFailure: m => { failure = m }, quiet: options.quiet })
        if (!receipt) { if (key !== null) release(pageId, key); options.onFailure?.({ pageId, message: failure || 'not saved' }); return false }
        if (key === null) clearOwn(pageId, slot.document)
        // Its owner came back and wrote newer text while this save was out: the slot stays its own, unmarked. When the
        // page held only the owner's own text, the owner learns what it became and saves on from there.
        else if (claim(pageId, key, slot.document, slot.base === pageContentKey(page) ? JSON.stringify(document) : undefined)) noteRecovered(pageId)
        ws = await refresh()
      } finally { saving.delete(pageId); done() }
    }
    return true
  })
}
