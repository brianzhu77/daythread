// ↑/↓ across task rows (Brian 967fd04b). A task row starts with a non-editable checkbox, and the browser's own
// vertical caret movement can't always cross it: from an empty row, ↑ stayed put in Chrome. Before, ProseMirror's gap
// cursor caught those cases and drew a blinking 20 px line beside the row. At the top or bottom line of a task row (or
// moving into one), this moves the caret to the neighbouring row's text at the same horizontal position, as the
// browser does between ordinary lines.
import { createExtension } from '@blocknote/core'
import { Plugin, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'

const isRow = (node: Node) => node.type.name === 'task' || node.type.name === 'sourceChecklist'
/** A suggestion menu (#, [[), a row menu or a picker handles its own arrows. */
const menuOpen = () => !!document.querySelector('.bn-suggestion-menu, [role="menu"], [role="listbox"], [role="dialog"]')

export function moveVertically(view: EditorView, dir: -1 | 1): boolean {
  const { selection, doc } = view.state
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const $from = selection.$from
  if (!$from.parent.isTextblock || !view.endOfTextblock(dir < 0 ? 'up' : 'down')) return false
  const target = Selection.findFrom(doc.resolve(dir < 0 ? $from.before() : $from.after()), dir, true)
  if (!(target instanceof TextSelection)) return false
  if (!isRow($from.parent) && !isRow(target.$from.parent)) return false
  const start = target.$from.start(), end = target.$from.end()
  let pos = dir < 0 ? end : start
  const x = view.coordsAtPos($from.pos).left
  const dom = view.domAtPos(start).node
  const line = (dom instanceof Element ? dom : dom.parentElement)?.closest('.bn-inline-content')?.getBoundingClientRect()
  if (line) {
    const hit = view.posAtCoords({ left: x, top: dir < 0 ? line.bottom - 4 : line.top + 4 })
    if (hit && hit.pos >= start && hit.pos <= end) pos = hit.pos
  }
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, pos)).scrollIntoView())
  return true
}

export const rowArrows = () => createExtension({
  key: 'daythreadRowArrows',
  prosemirrorPlugins: [new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || view.composing || menuOpen()) return false
        return moveVertically(view, event.key === 'ArrowUp' ? -1 : 1)
      },
    },
  })],
})
