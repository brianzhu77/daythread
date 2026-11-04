// What a page editor needs from where it's drawn (docs/design/peek.md §2): what scrolls it, and which part of the document is its own.
// A page on its own screen scrolls the window and has the document to itself, so nothing here changes for it. A peek gives its panel.
import { createContext } from 'react'

export interface EditorScroller {
  by(top: number, smooth?: boolean): void
  to(top: number): void
  /** Its visible edges, in the same coordinates as a rect from `getBoundingClientRect`. */
  edges(): { top: number; bottom: number }
}
export const windowScroller: EditorScroller = {
  by: (top, smooth) => window.scrollBy({ top, ...(smooth ? { behavior: 'smooth' as const } : {}) }),
  to: top => window.scrollTo({ top }),
  edges: () => ({ top: 0, bottom: window.visualViewport?.height ?? window.innerHeight }),
}
export const elementScroller = (el: HTMLElement): EditorScroller => ({
  by: (top, smooth) => el.scrollBy({ top, ...(smooth ? { behavior: 'smooth' as const } : {}) }),
  to: top => el.scrollTo({ top }),
  edges: () => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } },
})
export const EditorScrollerContext = createContext<EditorScroller>(windowScroller)

/** A page's title and body, when something else is on screen with them; the whole document when not. */
export const pageScopeOf = (el: Element | null | undefined): ParentNode => el?.closest('[data-page-scope]') ?? document
