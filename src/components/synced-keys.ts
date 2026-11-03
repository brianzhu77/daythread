import { createExtension } from '@blocknote/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as ProseNode, ResolvedPos } from '@tiptap/pm/model'
import { syncedBlockType } from '../domain/synced'

const isBlock = (container: ProseNode | null | undefined) => container?.firstChild?.type.name === syncedBlockType
/** The line the caret's in, and the group of lines it's one of. */
function lineAt($pos: ResolvedPos) {
  let depth = $pos.depth
  while (depth > 0 && $pos.node(depth).type.name !== 'blockContainer') depth--
  if (depth < 2) return null
  const group = depth - 1, index = $pos.index(group)
  return {
    group: $pos.node(group), index, depth,
    // The container that holds this group, when it's a synced block: this line is directly inside one.
    holder: group >= 1 && isBlock($pos.node(group - 1)) ? $pos.node(group - 1) : null,
    before: index > 0 ? $pos.node(group).child(index - 1) : null,
    after: index < $pos.node(group).childCount - 1 ? $pos.node(group).child(index + 1) : null,
    start: $pos.before(depth),
  }
}
const put = (view: EditorView, pos: number, side: 1 | -1) => view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos), side)).scrollIntoView())

/**
 * A synced block's edges hold (states §5; the experiment in docs/plan/b21-synced-block.md showed both ways they don't, on their
 * own): Backspace or Delete at an edge would spill its lines onto this page, or pull a line of this page into every other.
 * Here it stops, with the caret at the edge. Enter on its empty last line still leaves it, as the editor does already.
 * On capture, so it runs before the editor's own keys.
 */
export function syncedEdgeKey(view: EditorView, event: KeyboardEvent, onEmpty: (blockId: string) => void): boolean {
  const { selection } = view.state
  if (!selection.empty || event.isComposing) return false
  const { $from } = selection, line = lineAt($from)
  if (!line) return false
  const atStart = $from.parentOffset === 0, atEnd = $from.parentOffset === $from.parent.content.size
  const lineSize = line.group.child(line.index).nodeSize
  if (event.key === 'Backspace' && atStart && !event.metaKey) {
    if (line.holder && line.index === 0) {
      // The one exception: an empty block, if this is its only place, goes (the caller checks that).
      if (line.group.childCount === 1 && !$from.parent.content.size) onEmpty(String(line.holder.attrs.id))
      return true
    }
    if (isBlock(line.before)) { put(view, line.start, -1); return true }
  }
  if (event.key === 'Delete' && atEnd) {
    if (line.group.child(line.index).childCount > 1) return false
    if (line.holder && !line.after) return true
    if (isBlock(line.after)) { put(view, line.start + lineSize, 1); return true }
  }
  if (event.key === 'Tab') {
    // In: it would become one of the block's lines. Out: one of them would leave it.
    if (!event.shiftKey && isBlock(line.before)) return true
    if (event.shiftKey && line.holder) return true
  }
  return false
}
export const syncedKeys = (onEmpty: (blockId: string) => void) => createExtension({
  key: 'daythreadSyncedKeys',
  prosemirrorPlugins: [new Plugin({
    view: view => {
      const key = (event: KeyboardEvent) => { if (['Backspace', 'Delete', 'Tab'].includes(event.key) && syncedEdgeKey(view, event, onEmpty)) { event.preventDefault(); event.stopPropagation() } }
      view.dom.addEventListener('keydown', key, true)
      return { destroy: () => view.dom.removeEventListener('keydown', key, true) }
    },
  })],
})
