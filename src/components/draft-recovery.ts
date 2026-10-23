import { mergeDraft } from '../domain/draft-merge.ts'
import { editorSeed, needsTemplateRows, pageContentKey, type EditorNode } from '../domain/editor-document.ts'
import type { Action, Page, Receipt, Workspace } from '../domain/types.ts'
import { todayIso } from './dates.ts'
import { claim, clearOwn, orphans, ownDrafts, withoutSaved, type DraftSlot } from './draft-slots.ts'

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

type Run = (action: Action, notice?: undefined, operationId?: string, options?: { inlineRefusal?: RegExp; onRefused?: () => void }) => Promise<Receipt | null>

/** Saves every kept draft (this tab's, for pages not open here; gone tabs', for any page); true when none is left. */
export async function saveKeptDrafts(refresh: () => Promise<Workspace>, run: Run, skip: Set<string>): Promise<boolean> {
  let ws = await refresh()
  // A page open here keeps its own draft in its editor (just saved by flushAllEditors); a gone tab's draft for it is
  // still saved here, since the editor only merges those as it opens (Ratchet 95eb05f4). The open editor, clean after
  // the flush, then follows the saved page.
  const kept = [
    ...ownDrafts().filter(d => !skip.has(d.pageId)).map(d => ({ ...d, key: null as string | null })),
    ...ws.pages.flatMap(p => orphans(p.id).map(o => ({ pageId: p.id, slot: o.slot, key: o.key as string | null }))),
  ]
  for (const { pageId, slot, key } of kept) {
    const page = ws.pages.find(p => p.id === pageId)
    // Its page is gone (deleted elsewhere): there's nothing to save it into, and its words aren't exported either.
    if (!page || page.trashedAt) continue
    let document: EditorNode[]
    try { document = recoveredDocument(ws, page, slot, key === null) } catch { return false }
    const receipt = await run({ type: 'save-editor', pageId, expectedContent: pageContentKey(page), document: JSON.stringify(document), ...(slot.cutTaskIds?.length ? { cutTaskIds: slot.cutTaskIds } : {}), today: todayIso() }, undefined, undefined, { inlineRefusal: /changed elsewhere|changed since/i, onRefused: () => {} })
    if (!receipt) return false
    if (key === null) clearOwn(pageId, slot.document)
    else claim(pageId, key)
    ws = await refresh()
  }
  return true
}
