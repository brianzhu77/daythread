import type { ReactElement, ReactNode } from 'react'
import type { NoteBlock, Page, Workspace } from '../domain/types'
import { inlineText, type EditorNode } from '../domain/editor-document'
import { CalendarIcon, GlobeIcon, PagesIcon, TrashIcon } from './icons'
import { pageLabel } from './page-tree'
import { TagText } from './tag-text'

export type PageRefState = 'live' | 'trashed' | 'missing' | 'creating' | 'failed'

/** A9a (Jazz page-links-states §1): what a `[[` link to `pageId` shows now. Read live: a rename shows at once. */
export function pageRefView(workspace: Workspace | null | undefined, pageId: string, newTitle?: string): { target?: Page; state: PageRefState; label: string; icon: ReactElement } {
  const target = workspace?.pages.find(p => p.id === pageId)
  if (!target) return newTitle ? { state: 'creating', label: newTitle, icon: <PagesIcon /> } : { state: 'missing', label: 'Page not found', icon: <PagesIcon /> }
  const icon = target.trashedAt ? <TrashIcon /> : target.type === 'daily' ? <CalendarIcon /> : target.url ? <GlobeIcon /> : <PagesIcon />
  return { target, state: target.trashedAt ? 'trashed' : 'live', label: pageLabel(target), icon }
}

/** The link as read-only text (tag pages, the morning card, Trash): icon and live title, in the line's flow. */
export function PageRefLabel({ workspace, pageId, newTitle }: { workspace: Workspace | null | undefined; pageId: string; newTitle?: string }) {
  const v = pageRefView(workspace, pageId, newTitle)
  return <span className={`page-ref is-${v.state}`}><span className="page-ref-icon">{v.icon}</span><span className="page-ref-title">{v.label}</span></span>
}

/** One line's inline content as read-only nodes: words (tags tinted) and `[[` links with live titles. */
export function InlineWithRefs({ content, workspace }: { content: unknown; workspace: Workspace | null | undefined }): ReactNode {
  if (!Array.isArray(content)) return <TagText text={inlineText(content)} />
  return (content as { type?: string; text?: string; href?: string; content?: unknown; props?: Record<string, string> }[]).map((c, i) =>
    c.type === 'pageRef' ? <PageRefLabel key={i} workspace={workspace} pageId={String(c.props?.pageId ?? '')} newTitle={c.props?.newTitle || undefined} />
      : c.type === 'link' ? <a key={i} href={c.href} target="_blank" rel="noreferrer">{inlineText(c.content)}</a>
      : <TagText key={i} text={c.text ?? inlineText(c.content)} />)
}

const nodeCache = new WeakMap<Page, Map<string, EditorNode>>()
function nodeOf(page: Page, blockId: string): EditorNode | undefined {
  let byId = nodeCache.get(page)
  if (!byId) {
    byId = new Map()
    const walk = (list: EditorNode[]) => list.forEach(n => { byId!.set(n.id, n); walk(n.children ?? []) })
    try { walk(JSON.parse(page.editorJSON ?? '[]')) } catch { /* no document: the stored text */ }
    nodeCache.set(page, byId)
  }
  return byId.get(blockId)
}

/**
 * A line as shown outside the editor (Jazz: tag pages and "lines from {day}"). A line with `[[` links is drawn from
 * its editor content, so each link shows its page's current title; any other line is its stored text.
 */
export function LineText({ workspace, pageId, block }: { workspace: Workspace | null | undefined; pageId: string; block: NoteBlock }) {
  const page = block.refs?.length ? workspace?.pages.find(p => p.id === pageId) : undefined
  const node = page ? nodeOf(page, block.id) : undefined
  if (!node || !Array.isArray(node.content)) return <TagText text={block.text} />
  return <>{InlineWithRefs({ content: node.content, workspace })}</>
}
