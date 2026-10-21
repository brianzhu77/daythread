// A9a (docs/plan/a9-page-links.md §1–§2): inline `[[` links in editor content, and the identity and time of every
// reference (cards and links), so Linked from (B15), A2's Undo check and Trash all read the same thing.
import type { NoteBlock, Page, PageRefEntry, Section, Workspace } from './types.ts'

export interface InlineRef { refId: string; pageId: string; newTitle?: string }
type Inline = { type?: string; text?: string; content?: unknown; props?: Record<string, unknown> }

/** The `pageRef` nodes of one line's inline content, in order. */
export function inlineRefs(content: unknown): InlineRef[] {
  if (!Array.isArray(content)) return []
  return (content as Inline[]).flatMap((c) => {
    if (c?.type === 'pageRef') {
      const p = c.props ?? {}
      return [{ refId: String(p.refId ?? ''), pageId: String(p.pageId ?? ''), ...(p.newTitle ? { newTitle: String(p.newTitle) } : {}) }]
    }
    return c && typeof c === 'object' && 'content' in c ? inlineRefs(c.content) : []
  })
}

/** A line's words with each link read as a title (`titleOf(refId)`), for the stored `NoteBlock.text`. */
export function lineText(content: unknown, titleOf: (ref: InlineRef) => string): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Inline[]).map((c) => {
    if (!c || typeof c !== 'object') return ''
    if (c.type === 'pageRef') return titleOf({ refId: String(c.props?.refId ?? ''), pageId: String(c.props?.pageId ?? '') })
    return 'text' in c ? String(c.text) : 'content' in c ? lineText(c.content, titleOf) : ''
  }).join('')
}

/** The title a stored line used for each of its links (what `NoteBlock.text` was built from). */
export const savedTitle = (b: Pick<NoteBlock, 'refs'> | Pick<Section, 'refs'> | undefined) => (ref: InlineRef) => b?.refs?.find((r) => r.refId === ref.refId)?.title ?? ''

/** A page's title for a link, read live. */
export function liveTitle(ws: Workspace, ref: InlineRef): string {
  return ws.pages.find((p) => p.id === ref.pageId)?.title ?? ref.newTitle ?? ''
}

/**
 * Every line of a page that can hold `[[` links: headings (sections) and blocks, each with its id. Every reader of
 * references goes through this, so a link in a heading counts exactly like one in a line (Ratchet #84).
 */
export function refHolders(page: Page): { id: string; refs: PageRefEntry[] }[] {
  return page.sections.flatMap((s) => [...(s.refs?.length ? [{ id: s.id, refs: s.refs }] : []), ...s.blocks.filter((b) => b.refs?.length).map((b) => ({ id: b.id, refs: b.refs! }))])
}
/**
 * Every reference the workspace already knows, by identity (plan §2): links by `refId` + target, cards by block id +
 * target, from every page's current blocks and from the metadata that keeps deleted ones. A cut-and-paste move to
 * another line or page finds its time here, whichever page saves first.
 */
export function referenceIndex(ws: Workspace): { links: Map<string, PageRefEntry>; cards: Map<string, number> } {
  const links = new Map<string, PageRefEntry>(), cards = new Map<string, number>()
  for (const p of ws.pages) {
    for (const s of p.sections) for (const r of s.refs ?? []) links.set(`${r.refId}|${r.pageId}`, r)
    for (const b of [...Object.values(p.editorBlockMetadata ?? {}), ...p.sections.flatMap((s) => s.blocks)]) {
      for (const r of b.refs ?? []) links.set(`${r.refId}|${r.pageId}`, r)
      if (b.kind === 'reference' && b.targetPageId && b.at !== undefined) cards.set(`${b.id}|${b.targetPageId}`, b.at)
    }
  }
  return { links, cards }
}
