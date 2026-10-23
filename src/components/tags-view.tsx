import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { lastUsed, tagIndex, type TagEntry, type TagOccurrence } from '../domain/tags'
import { LineText } from './line-text'
import type { LocalDate } from '../domain/types'
import { addDays, fromIso, longLabel, todayIso } from './dates'
import { ChevronRightIcon } from './icons'
import { TagText } from './tag-text'
import { useWorkspace } from './use-day'

function TagName({ tag }: { tag: string }) {
  return <><span className="tag-mark">#</span><span className="tag-ink">{tag}</span></>
}

/** "Today" / "Yesterday" / "Thu, Oct 16": when a tag was last used. */
function dayWord(date: LocalDate, today: LocalDate) {
  return date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : longLabel(date)
}

/** Every tag Brian has written, most recently used first. A main navigation destination of its own. */
export function TagsScreen() {
  const { workspace } = useWorkspace()
  const [today] = useState(todayIso)
  if (!workspace) return <p className="loading">Loading tags…</p>
  const tags = tagIndex(workspace)
  return (
    <div className="list-screen tags-screen">
      <h1 className="large-title">Tags</h1>
      {tags.length === 0 ? (
        // The only place the app explains tags and where one ends.
        <div className="empty-box tags-empty"><span className="tags-empty-mark" aria-hidden="true">#</span><strong>No tags yet</strong><p>Type # and a word anywhere in a note, like <TagName tag="work" />. A tag ends at a space or punctuation.</p></div>
      ) : (
        <ul className="plain card-list">
          {tags.map(t => {
            const last = lastUsed(t)
            return (
              <li key={t.key}>
                <Link to="/tags/$tag" params={{ tag: t.key }} className="card-row">
                  <span className="card-row-title wraps"><span className="tag-plain-mark">#</span>{t.tag}<span className="card-row-detail">{plural(t.occurrences.length, 'block')}{last ? ` · ${dayWord(last, today)}` : ''}</span></span>
                  <ChevronRightIcon />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** One tag: its blocks grouped by day, newest first. A row opens the block where it was written. */
export function TagScreen({ tagKey }: { tagKey: string }) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const [today] = useState(todayIso)
  if (!workspace) return <p className="loading">Loading tags…</p>
  const entry = tagIndex(workspace).find(t => t.key === tagKey)
  const back = <Link to="/tags" className="back-link">‹ Tags</Link>
  if (!entry) return <div className="list-screen tag-screen">{back}<h1 className="large-title"><span className="tag-plain-mark">#</span>{tagKey}</h1><p className="quiet">No blocks have this tag any more.</p></div>
  const days = new Set(entry.occurrences.map(o => o.date).filter(Boolean)).size
  const open = (o: TagOccurrence) => void navigate({ href: o.date ? `/day/${o.date}?block=${encodeURIComponent(o.blockId)}` : `/pages?page=${encodeURIComponent(o.pageId)}&block=${encodeURIComponent(o.blockId)}&from=tags` })
  return (
    <div className="list-screen tag-screen">
      {back}
      <div>
        <h1 className="large-title"><span className="tag-plain-mark">#</span>{entry.tag}</h1>
        <p className="tag-summary">{plural(entry.occurrences.length, 'block')}{days ? ` · ${plural(days, 'day')}` : ''}</p>
      </div>
      {groupByPage(entry).map(g => (
        <section key={g.pageId} className="card-section">
          <h2 className="tag-day-label">{g.date ? <DayHeading date={g.date} today={today} /> : g.title}</h2>
          <ul className="plain card-list">
            {g.occurrences.map(o => {
              const task = o.taskId ? workspace.tasks.find(t => t.id === o.taskId) : undefined
              return (
                <li key={o.blockId}>
                  <button type="button" className="tag-block" onClick={() => open(o)}>
                    {task && <input type="checkbox" className="check" checked={task.status === 'done'} readOnly disabled tabIndex={-1} aria-label={task.status === 'done' ? 'Done' : 'Open'} />}
                    <span className="tag-block-text">{(() => { const b = workspace.pages.find(p => p.id === o.pageId)?.sections.flatMap(s => s.blocks).find(x => x.id === o.blockId); return b ? <LineText workspace={workspace} pageId={o.pageId} block={b} /> : <TagText text={o.text} /> })()}</span>
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

/** "Today Sun, Oct 18" / "Thu Oct 16": the day word in ink, the date in grey, as in the mock. */
function DayHeading({ date, today }: { date: LocalDate; today: LocalDate }) {
  const relative = date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : null
  const d = fromIso(date)
  return relative
    ? <><strong>{relative}</strong> <span>{longLabel(date)}</span></>
    : <><strong>{d.toLocaleDateString('en-US', { weekday: 'short' })}</strong> <span>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></>
}

function groupByPage(entry: TagEntry) {
  const groups: { pageId: string; date: LocalDate | null; title: string; occurrences: TagOccurrence[] }[] = []
  for (const o of entry.occurrences) {
    const last = groups.at(-1)
    if (last?.pageId === o.pageId) last.occurrences.push(o)
    else groups.push({ pageId: o.pageId, date: o.date, title: o.pageTitle, occurrences: [o] })
  }
  return groups
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
