import { createExtension } from '@blocknote/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findTags } from '../domain/tags'

const key = new PluginKey<DecorationSet>('daythread-tags')

// Tints exactly the text tagIndex counts, as view decorations only: the document and what gets saved never change.
// `counts(blockId)` says whether a block is one the index reads (paragraph or task text, not event or link rows).
function decorate(doc: PMNode, counts: (blockId: string) => boolean): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer') return true
    const content = node.firstChild
    if (!content?.isTextblock || content.type.name === 'heading' || !counts(String(node.attrs.id))) return true
    // Rebuild the block's text the way the index sees it (a hard break reads as a newline), keeping each
    // character's document position so a match maps straight back onto the editor.
    let text = ''
    const at: number[] = []
    const start = pos + 2
    content.forEach((child, offset) => {
      const piece = child.isText ? child.text! : child.isLeaf ? '\n' : child.textContent
      for (let i = 0; i < piece.length; i++) at.push(start + offset + Math.min(i, child.nodeSize - 1))
      text += piece
    })
    for (const m of findTags(text)) {
      decorations.push(Decoration.inline(at[m.start]!, at[m.start]! + 1, { class: 'tag-mark' }))
      decorations.push(Decoration.inline(at[m.start + 1]!, at[m.end - 1]! + 1, { class: 'tag-ink' }))
    }
    return true
  })
  return DecorationSet.create(doc, decorations)
}

export const tagDecorations = (counts: (blockId: string) => boolean) => createExtension({
  key: 'daythreadTags',
  prosemirrorPlugins: [new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => decorate(state.doc, counts),
      apply(tr, old) {
        // While an input method is composing, only move the existing tint along; redrawing it under the
        // composition can break the composed text. The tint catches up once the text is committed.
        if (tr.getMeta('composition') !== undefined) return old.map(tr.mapping, tr.doc)
        return tr.docChanged || tr.getMeta(key) ? decorate(tr.doc, counts) : old
      },
    },
    props: { decorations: state => key.getState(state) },
    view: view => {
      const committed = () => setTimeout(() => { if (!view.isDestroyed && !view.composing) view.dispatch(view.state.tr.setMeta(key, true)) })
      view.dom.addEventListener('compositionend', committed)
      return { destroy: () => view.dom.removeEventListener('compositionend', committed) }
    },
  })],
})
