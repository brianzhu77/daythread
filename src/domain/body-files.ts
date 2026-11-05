// Files in a page's body (B87, docs/design/body-files.md). A block's whole record of its file is its address: it's fixed from the moment the block goes in, so
// nothing in the document changes when an upload ends, and an older tab or build, which knows `url` and `name`, keeps the block and can draw it.
import { flatNodes, pageNodes } from './editor-document.ts'
import type { Page } from './types.ts'

const pattern = /^\/api\/files\/([A-Za-z0-9_-]{8,64})(?:\?(.*))?$/

export const bodyFileUrl = (id: string, name: string, size: number) => `/api/files/${id}?name=${encodeURIComponent(name)}&size=${size}`
/** What an address in a block says, when it's one of ours; a link to the web isn't. */
export function bodyFileOf(url: unknown): { id: string; name: string; size: number | null } | null {
  const match = typeof url === 'string' ? pattern.exec(url) : null
  if (!match) return null
  const query = new URLSearchParams(match[2] ?? ''), size = Number(query.get('size'))
  return { id: match[1]!, name: query.get('name') ?? '', size: query.has('size') && Number.isFinite(size) ? size : null }
}
/** Which block a file makes. SVG can run on our origin, so it's a file. */
export const showsAsImage = (type: string) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif'].includes(type)
/** The files in a page's body, with the size each says. */
export function bodyFilesIn(page: Pick<Page, 'document'>): Array<{ id: string; name: string; size: number | null }> {
  return flatNodes(pageNodes(page)).flatMap(n => {
    if (n.type !== 'image' && n.type !== 'file') return []
    const file = bodyFileOf(n.props?.url)
    return file ? [{ ...file, name: String(n.props?.name || file.name) }] : []
  })
}
