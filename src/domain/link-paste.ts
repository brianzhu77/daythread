// A2 plan §4: the one change Undo makes to the document a paste wrote. The server applies it to the page it holds and
// the browser to the editor's current document, so both end up with the same blocks (Ratchet df3285ef, Lead).
import type { EditorNode } from './editor-document.ts'

export interface UndoCard {
  blockId: string
  pageId: string
  url: string
  /** The line the card replaced (paragraph, bullet or numbered), so the URL comes back as the same kind of line. */
  lineType: string
}

const lineTypes = new Set(['paragraph', 'bulletListItem', 'numberedListItem'])

/** The URL line Undo puts back: same block id, same kind of line, the raw URL as a plain link. */
export function urlLine(card: UndoCard, children?: EditorNode[]): EditorNode {
  return {
    id: card.blockId,
    type: lineTypes.has(card.lineType) ? card.lineType : 'paragraph',
    content: [{ type: 'link', href: card.url, content: [{ type: 'text', text: card.url, styles: {} }] }],
    ...(children?.length ? { children } : {}),
  }
}

/**
 * Each matching card (same block id, still pointing at the same page) becomes its URL line in place, keeping its
 * nesting and children. Every other block is returned as it was.
 */
export function undoCards(doc: readonly EditorNode[], cards: readonly UndoCard[]): EditorNode[] {
  const byId = new Map(cards.map((c) => [c.blockId, c]))
  const visit = (node: EditorNode): EditorNode => {
    const card = byId.get(node.id)
    const children = node.children?.map(visit)
    if (card && node.type === 'pageLink' && String(node.props?.pageId ?? '') === card.pageId) return urlLine(card, children)
    return children ? { ...node, children } : node
  }
  return doc.map(visit)
}

/** The cards of `cards` that are still in the document as they were made. */
export function cardsPresent(doc: readonly EditorNode[], cards: readonly UndoCard[]): UndoCard[] {
  const found = new Map<string, EditorNode>()
  const visit = (n: EditorNode) => { found.set(n.id, n); n.children?.forEach(visit) }
  doc.forEach(visit)
  return cards.filter((c) => {
    const n = found.get(c.blockId)
    return n?.type === 'pageLink' && String(n.props?.pageId ?? '') === c.pageId
  })
}
