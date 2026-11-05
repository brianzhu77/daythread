// The underline under a comment's selected words (docs/design/comments.md §3, step 3), as a view decoration only: the document and what gets saved never change.
// It checks the quoted words at their stored place in the line and never looks anywhere else, so a repeated phrase can't get the wrong one. Once they don't match, the line's mark is all that's left.
import { createExtension } from '@blocknote/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { CommentAnchor } from '../domain/comments'

export const underlineKey = new PluginKey<DecorationSet>('daythread-comment-underlines')

/** A line's text with each character's document position, a chip or link counting as one. */
function lineText(content: PMNode, start: number): { text: string; at: number[] } {
  let text = ''
  const at: number[] = []
  content.forEach((child, offset) => {
    const piece = child.isText ? child.text! : '￼'
    for (let i = 0; i < piece.length; i++) at.push(start + offset + (child.isText ? i : 0))
    text += piece
  })
  return { text, at }
}
function decorate(doc: PMNode, anchors: () => readonly CommentAnchor[]): DecorationSet {
  const wanted = anchors().filter(a => a.at !== undefined && a.quote)
  if (!wanted.length) return DecorationSet.empty
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer') return true
    // A shared line's id here is its own with the place after it.
    const here = wanted.filter(a => a.blockId === node.attrs.id || String(node.attrs.id).startsWith(`${a.blockId}:`)), content = node.firstChild
    if (!here.length || !content?.isTextblock) return true
    const { text, at } = lineText(content, pos + 2)
    for (const a of here) if (text.slice(a.at!, a.at! + a.quote.length) === a.quote) decorations.push(Decoration.inline(at[a.at!]!, at[a.at! + a.quote.length - 1]! + 1, { class: 'comment-underline' }))
    return true
  })
  return DecorationSet.create(doc, decorations)
}
export const commentUnderlines = (anchors: () => readonly CommentAnchor[]) => createExtension({
  key: 'daythreadCommentUnderlines',
  prosemirrorPlugins: [new Plugin<DecorationSet>({
    key: underlineKey,
    state: {
      init: (_, state) => decorate(state.doc, anchors),
      apply(tr, old) {
        // As with tags: redrawing under a composition can break the composed text, so it only moves along until that's done.
        if (tr.getMeta('composition') !== undefined) return old.map(tr.mapping, tr.doc)
        return tr.docChanged || tr.getMeta(underlineKey) ? decorate(tr.doc, anchors) : old
      },
    },
    props: { decorations: state => underlineKey.getState(state) },
    view: view => {
      const committed = () => setTimeout(() => { if (!view.isDestroyed && !view.composing) view.dispatch(view.state.tr.setMeta(underlineKey, true)) })
      view.dom.addEventListener('compositionend', committed)
      return { destroy: () => view.dom.removeEventListener('compositionend', committed) }
    },
  })],
})
/** The selected words of one line, with their place in it. Null with nothing selected, or a selection across lines, which goes on its first line whole. */
export function selectedWords(state: EditorState): { blockId: string; quote: string; at: number } | null {
  const { from, to, empty, $from, $to } = state.selection
  if (empty || !$from.sameParent($to) || !$from.parent.isTextblock) return null
  const container = $from.node($from.depth - 1), { text, at } = lineText($from.parent, $from.start())
  if (container?.type.name !== 'blockContainer') return null
  const inside = at.flatMap((p, i) => (p >= from && p < to ? [i] : []))
  if (!inside.length) return null
  return { blockId: String(container.attrs.id), quote: text.slice(inside[0]!, inside.at(-1)! + 1), at: inside[0]! }
}
