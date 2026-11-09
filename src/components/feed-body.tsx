// A row's body as a Feed card reads it (feed.md §3): drawn from the stored document by an explicit list, never an editor,
// so 25 cards are 25 short trees of plain elements. Anything not listed is a link to the row and does nothing else. A tick
// is the only change a card can make: the task's own command, never a save of this clipped document.
import { useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { inlineText, pageNodes, type EditorNode } from '../domain/editor-document'
import { readMention } from '../domain/date-chip'
import { syncedBlockType } from '../domain/synced'
import type { Page, Workspace } from '../domain/types'
import { DateChipInPage } from './event-rows'
import { LineRefLabel, PageRefLabel } from './line-text'
import { displayPageTitle } from './page-title'
import { TagText } from './tag-text'
import { urlHref } from './property-values'
import { PropertyCheckbox } from './property-editors'
import { useTaskTick } from './use-day'

interface Inline { type?: string; text?: string; href?: string; content?: unknown; styles?: Record<string, unknown>; props?: Record<string, string> }

/** Bold, italics and the rest, as the editor stores them. A colour reads as the editor's does. */
function styled(text: ReactNode, styles: Record<string, unknown> | undefined, key: number): ReactNode {
  let out = text
  if (!styles) return <span key={key}>{out}</span>
  if (styles.code) out = <code>{out}</code>
  if (styles.bold) out = <strong>{out}</strong>
  if (styles.italic) out = <em>{out}</em>
  if (styles.underline) out = <u>{out}</u>
  if (styles.strike) out = <s>{out}</s>
  const colour = typeof styles.textColor === 'string' && styles.textColor !== 'default' ? styles.textColor : undefined
  const fill = typeof styles.backgroundColor === 'string' && styles.backgroundColor !== 'default' ? styles.backgroundColor : undefined
  return <span key={key} {...(colour ? { 'data-text-color': colour } : {})} {...(fill ? { 'data-background-color': fill } : {})}>{out}</span>
}

/** One line's words: styles, tags, links, `[[` links with live titles and `@date` chips, each followed on a tap. */
export function FeedInline({ content, workspace }: { content: unknown; workspace: Workspace }): ReactNode {
  if (!Array.isArray(content)) return <TagText text={inlineText(content)} />
  return (content as Inline[]).map((c, i) => {
    if (c.type === 'pageRef' && c.props?.lineId) return <LineRefLabel key={i} workspace={workspace} target={{ pageId: String(c.props.pageId ?? ''), lineId: c.props.lineId, ...(c.props.taskId ? { taskId: c.props.taskId } : {}) }} />
    if (c.type === 'pageRef') return <PageRefLabel key={i} workspace={workspace} pageId={String(c.props?.pageId ?? '')} newTitle={c.props?.newTitle || undefined} />
    const mention = readMention(c)
    if (mention) return <DateChipInPage key={i} date={mention.date} time={mention.time} />
    if (c.type === 'link') {
      const words = (Array.isArray(c.content) ? (c.content as Inline[]) : []).map((t, j) => styled(t.text ?? '', t.styles, j))
      // A stored href is drawn as live markup here, so only what a URL cell would open (http(s), mailto, tel); anything else is words.
      const href = urlHref(String(c.href ?? ''))
      return href ? <a key={i} href={href} target="_blank" rel="noreferrer">{words}</a> : <span key={i}>{words}</span>
    }
    return styled(<TagText text={c.text ?? inlineText(c.content)} />, c.styles, i)
  })
}

/** A `[[` page link as its own line: the page card, followed on a tap. */
function PageLine({ workspace, pageId, url }: { workspace: Workspace; pageId: string; url?: string }) {
  const navigate = useNavigate()
  const target = pageId ? workspace.pages.find(p => p.id === pageId) : undefined
  // A pasted link the server hasn't made a page for yet (A2): its address.
  const href = !pageId && url ? urlHref(url) : null
  if (href) return <p className="feed-line"><a href={href} target="_blank" rel="noreferrer">{url}</a></p>
  if (!target) return <p className="feed-line is-quiet">Page not found</p>
  return <p className="feed-line"><button type="button" className="feed-link" onClick={() => void navigate({ to: '/pages', search: { page: pageId } })}><PageRefLabel workspace={workspace} pageId={pageId} /></button></p>
}

/** A to-do: its box and words. The tick is its task's command, as a table's is, so every place showing it agrees and one Undo takes it back. */
function FeedTask({ node, workspace }: { node: EditorNode; workspace: Workspace }) {
  const taskId = typeof node.props?.taskId === 'string' ? node.props.taskId : undefined
  const tick = useTaskTick(workspace.tasks.some(t => t.id === taskId) ? taskId : undefined)
  return <p className={`feed-line feed-task${tick.status === 'done' ? ' is-done' : ''}`}>
    <PropertyCheckbox checked={tick.status === 'done'} disabled={!tick.status || tick.status === 'cancelled'} label={`Done: ${inlineText(node.content) || 'To-do'}`}
      onToggle={() => tick.toggle((to, r) => ({ text: to === 'done' ? 'Done' : 'Reopened', undoOperationId: r.operationId }))} />
    <span className="feed-task-words"><FeedInline content={node.content} workspace={workspace} /></span>
  </p>
}

/** An image, loaded when near the screen and held at its height so nothing moves when it arrives. A failed one leaves no frame. */
function FeedImage({ url, caption }: { url: string; caption: string }) {
  const [failed, setFailed] = useState(false)
  if (failed || !url) return null
  return <figure className="feed-image"><img src={url} alt={caption} loading="lazy" decoding="async" onError={() => setFailed(true)} />{caption && <figcaption>{caption}</figcaption>}</figure>
}

const blockNames: Record<string, string> = { file: 'File', table: 'Table', video: 'Video', audio: 'Audio', codeBlock: 'Code', sourceChecklist: 'To-dos', button: 'Button' }

/** The body of `row`, read only. `openRow` is where anything not listed leads. */
export function FeedBody({ workspace, row, openRow }: { workspace: Workspace; row: Page; openRow: () => void }) {
  const toRow = (label: string, key: string) => <p key={key} className="feed-line"><button type="button" className="feed-link is-quiet" onClick={openRow}>{label}</button></p>
  const render = (list: readonly EditorNode[]): ReactNode[] => {
    let number = 0
    return list.map(n => {
      number = n.type === 'numberedListItem' ? (number ? number + 1 : Number(n.props?.start ?? 1) || 1) : 0
      // A toggle's lines are folded away on the page, so a card leaves them out too: its words, and the row has the rest.
      const folded = n.type === 'toggleListItem' || (n.type === 'heading' && Boolean(n.props?.isToggleable))
      const children = n.children?.length && !folded ? <div className="feed-children">{render(n.children)}</div> : null
      const words = <FeedInline content={n.content} workspace={workspace} />
      const line = (() => {
        switch (n.type) {
          case 'paragraph': return Array.isArray(n.content) && n.content.length ? <p className="feed-line">{words}</p> : <p className="feed-line is-blank" aria-hidden="true" />
          case 'heading': return <p className={`feed-heading level-${Number(n.props?.level ?? 2)}`}>{folded && n.children?.length ? <span className="feed-marker" aria-hidden="true">▸ </span> : null}{words}</p>
          case 'toggleListItem': return <p className="feed-line feed-item"><span className="feed-marker" aria-hidden="true">▸</span><span>{words}</span></p>
          case 'bulletListItem': return <p className="feed-line feed-item"><span className="feed-marker" aria-hidden="true">•</span><span>{words}</span></p>
          case 'numberedListItem': return <p className="feed-line feed-item"><span className="feed-marker" aria-hidden="true">{number}.</span><span>{words}</span></p>
          case 'checkListItem': return <p className={`feed-line feed-item${n.props?.checked ? ' is-done' : ''}`}><span className="feed-marker" aria-hidden="true">{n.props?.checked ? '☑' : '☐'}</span><span>{words}</span></p>
          case 'quote': return <blockquote className="feed-quote">{words}</blockquote>
          case 'divider': return <hr className="feed-rule" />
          case 'task': return <FeedTask node={n} workspace={workspace} />
          case 'image': return <FeedImage url={String(n.props?.url ?? '')} caption={String(n.props?.caption ?? '')} />
          case 'pageLink': return <PageLine workspace={workspace} pageId={String(n.props?.pageId ?? '')} url={typeof n.props?.url === 'string' ? n.props.url : undefined} />
          // A view's rows aren't drawn in a card, so a feed can't nest views or get expensive: its name, linking to its database.
          case 'database': { const db = workspace.pages.find(p => p.id === n.props?.pageId); return db ? <PageLine workspace={workspace} pageId={db.id} /> : null }
          case syncedBlockType: {
            const record = workspace.synced?.find(r => r.id === n.props?.syncId)
            return record ? <div className="feed-synced">{render(pageNodes({ document: record.lines }))}</div> : null
          }
          default: return toRow(n.type === 'button' ? String(n.props?.label || 'Button') : blockNames[n.type] ?? 'Open to see', n.id)
        }
      })()
      return <div key={n.id} className="feed-block">{line}{children}</div>
    })
  }
  return <div className="feed-body" aria-label={`${displayPageTitle(row)}'s page`}>{render(pageNodes(row))}</div>
}
