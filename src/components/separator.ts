import { createExtension, type BlockNoteEditor } from '@blocknote/core'
import { Plugin } from '@tiptap/pm/state'
import { inlineText } from '../domain/editor-document'

type AnyEditor = BlockNoteEditor<any, any, any>
type AnyBlock = ReturnType<AnyEditor['getTextCursorPosition']>['block']

/**
 * B4: a Separator in one step that ⌘Z can reverse. BlockNote turns a line into a divider with a ReplaceAround step,
 * which history can't invert for a block without text: ⌘Z skipped it and then threw, so the divider stayed (Ratchet,
 * PR #52; typed `---` did the same on main). Replacing the line with a new divider block is a plain replace. The caret
 * goes to an empty line below the divider, a new one unless the next line is already empty, so his next words never
 * land in the heading that follows. A replaced line's nested lines stay, under the divider.
 */
export function insertSeparator(editor: AnyEditor, line: AnyBlock, replaceLine: boolean) {
  editor.transact(() => {
    const divider = replaceLine ? editor.replaceBlocks([line], [{ type: 'divider', children: line.children }]).insertedBlocks[0]! : editor.insertBlocks([{ type: 'divider' }], line, 'after')[0]!
    const next = editor.getNextBlock(divider)
    const empty = next?.type === 'paragraph' && !inlineText(next.content) && !next.children.length ? next : editor.insertBlocks([{ type: 'paragraph' }], divider, 'after')[0]!
    editor.setTextCursorPosition(empty, 'start')
  })
}

/**
 * `---` typed as a whole line becomes a Separator through insertSeparator; it replaces BlockNote's own shortcut
 * (`divider-block-shortcuts`, disabled in the editor). A to-do row keeps its dashes: turning it would delete the task.
 */
export const separatorShortcut = (getEditor: () => AnyEditor) => createExtension({
  key: 'daythreadSeparatorShortcut',
  prosemirrorPlugins: [new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== '-' || from !== to) return false
        const $from = view.state.doc.resolve(from)
        if (!$from.parent.isTextblock || $from.parent.textContent !== '--' || $from.parentOffset !== 2) return false
        const editor = getEditor()
        if (editor.getTextCursorPosition().block.type === 'task') return false
        // The third dash goes in first, as typing, so ⌘Z gives back the "---" he typed.
        view.dispatch(view.state.tr.insertText(text, from, to))
        insertSeparator(editor, editor.getTextCursorPosition().block, true)
        return true
      },
    },
  })],
})
