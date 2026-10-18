import { Link, useNavigate } from '@tanstack/react-router'
import { tagIndex, type TagEntry, type TagOccurrence } from '../domain/tags'
import type { Workspace } from '../domain/types'
import { longLabel } from './dates'
import { TagText } from './tag-text'
import { useWorkspace } from './use-day'

const sidebarLimit = 8

export function TagName({ tag }: { tag: string }) {
  return <><span className="tag-mark">#</span><span className="tag-ink">{tag}</span></>
}

/** Shown until Brian writes his first tag: the only place the app explains tags and the space rule. */
function TagsEmpty() {
  return <div className="tags-empty"><p>No tags yet</p><p className="tags-hint">Type # and a word anywhere in a note, like <TagName tag="work" />. A tag ends at a space or punctuation.</p></div>
}

/** The sidebar's Tags group (laptop), below Pages. */
export function SidebarTags({ path }: { path: string }) {
  const { workspace } = useWorkspace()
  if (!workspace) return null
  const tags = tagIndex(workspace)
  return (
    <div className="side-group">
      <p className="side-label">Tags</p>
      {tags.length === 0 && <TagsEmpty />}
      {tags.slice(0, sidebarLimit).map(t => (
        <Link key={t.key} to="/tags/$tag" params={{ tag: t.key }} className="side-row small tag-row" aria-current={path === `/tags/${encodeURIComponent(t.key)}` ? 'page' : undefined}>
          <span className="tag-row-name"><TagName tag={t.tag} /></span><span className="tag-row-count">{t.occurrences.length}</span>
        </Link>
      ))}
      {tags.length > sidebarLimit && <Link to="/pages" className="side-row small">All tags ›</Link>}
    </div>
  )
}

/** Every tag, as a grouped list on the Pages screen (the phone's way in, and "All tags" on laptop). */
export function TagList({ workspace }: { workspace: Workspace }) {
  const tags = tagIndex(workspace)
  return (
    <section className="tag-list">
      <h2 className="side-label">Tags</h2>
      {tags.length === 0 ? <TagsEmpty /> : (
        <ul className="plain tag-group">
          {tags.map(t => <li key={t.key}><Link to="/tags/$tag" params={{ tag: t.key }} className="tag-group-row"><span className="tag-row-name"><TagName tag={t.tag} /></span><span className="tag-row-count">{t.occurrences.length}</span></Link></li>)}
        </ul>
      )}
    </section>
  )
}

/** One tag: its blocks grouped by day, newest first. A row opens the block where it was written. */
export function TagScreen({ tagKey }: { tagKey: string }) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  if (!workspace) return <p className="loading">Loading tags…</p>
  const entry = tagIndex(workspace).find(t => t.key === tagKey)
  const back = <Link to="/pages" className="tag-back">‹ Pages</Link>
  if (!entry) return <div className="list-screen tag-screen">{back}<h1 className="large-title">#{tagKey}</h1><p className="quiet">No blocks have this tag any more.</p></div>
  const groups = groupByPage(entry)
  const days = new Set(entry.occurrences.map(o => o.date).filter(Boolean)).size
  const open = (o: TagOccurrence) => void navigate({ href: o.date ? `/day/${o.date}?block=${encodeURIComponent(o.blockId)}` : `/pages?page=${encodeURIComponent(o.pageId)}&block=${encodeURIComponent(o.blockId)}` })
  return (
    <div className="list-screen tag-screen">
      {back}
      <h1 className="large-title"><span className="tag-title-mark">#</span>{entry.tag}</h1>
      <p className="tag-summary">{plural(entry.occurrences.length, 'block')}{days ? ` · ${plural(days, 'day')}` : ''}</p>
      {groups.map(g => (
        <section key={g.pageId} className="tag-day">
          <h2 className="tag-day-label">{g.label}</h2>
          <ul className="plain">
            {g.occurrences.map(o => {
              const task = o.taskId ? workspace.tasks.find(t => t.id === o.taskId) : undefined
              return (
                <li key={o.blockId}>
                  <button type="button" className="tag-block" onClick={() => open(o)}>
                    {task && <input type="checkbox" className="check" checked={task.status === 'done'} readOnly disabled tabIndex={-1} aria-label={task.status === 'done' ? 'Done' : 'Open'} />}
                    <span className="tag-block-text"><TagText text={o.text} /></span>
                    <span className="tag-block-section">{o.sectionTitle}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function groupByPage(entry: TagEntry) {
  const groups: { pageId: string; label: string; occurrences: TagOccurrence[] }[] = []
  for (const o of entry.occurrences) {
    const last = groups.at(-1)
    if (last?.pageId === o.pageId) last.occurrences.push(o)
    else groups.push({ pageId: o.pageId, label: o.date ? longLabel(o.date) : o.pageTitle, occurrences: [o] })
  }
  return groups
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
