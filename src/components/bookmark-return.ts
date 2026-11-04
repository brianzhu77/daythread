// The bookmark to come back to in the list. In memory only: the header's way back sets it again from the page it's on, which survives a reload.
let leftFrom: string | null = null
export const noteLeftBookmark = (pageId: string) => { leftFrom = pageId }
export function takeLeftBookmark(): string | null { const id = leftFrom; leftFrom = null; return id }
