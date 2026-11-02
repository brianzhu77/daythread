import { createExtension } from '@blocknote/core'
import { Plugin } from '@tiptap/pm/state'

const isField = (el: Element | null): boolean => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
/** A key on a database block's cell, not in one of its fields (design §10). */
export const onDatabaseCell = (el: Element | null): boolean => Boolean(el?.closest?.('.database-block')) && !isField(el)

/**
 * The browser would edit the page from a cell. A cell has the focus, but the page's selection can still hold the block or a
 * line: Esc selects the block whole, and Enter comes back to a cell. The editor leaves a button's keys alone, so the browser
 * acted on that selection: Backspace or a letter on a cell replaced the block and joined the lines around it, which the
 * editor then took in as a change. It's stopped here, where any edit asks first; the cell still gets its keys. With the
 * block selected whole the focus is the editor's, and Backspace still deletes it.
 */
export const databaseKeys = () => createExtension({
  key: 'daythreadDatabaseKeys',
  prosemirrorPlugins: [new Plugin({
    view: view => {
      const hold = (event: Event) => { if (onDatabaseCell(document.activeElement)) event.preventDefault() }
      view.dom.addEventListener('beforeinput', hold)
      return { destroy: () => view.dom.removeEventListener('beforeinput', hold) }
    },
  })],
})
