import { useState } from 'react'
import type { LocalDate, NoteBlock, Page, Section, Workspace } from '../domain/types'
import { weekday } from './dates'
import { RowMenu } from './row-menu'
import { TaskRow, notTodayText } from './task-row'
import { useWorkspace } from './use-day'

const URL_ONLY = /^https?:\/\/\S+$/i
const TASK_PREFIX = /^(?:\[\]|\/task)\s+(.+)$/i
// In plan sections a line is a task by default; "- " or "> " keeps it as prose.
const PROSE_PREFIX = /^[->]\s/

/** The day's one editable document (01 §3.2). Sections are ordinary headings Brian can change. */
export function DayPage({ page, workspace, today }: { page: Page; workspace: Workspace; today: LocalDate }) {
  const { run } = useWorkspace()
  const [newSection, setNewSection] = useState('')
  const isPast = page.date !== null && page.date < today

  return (
    <article className="day-page" aria-label="Day page">
      {isPast && <p className="past-note">Text as saved. Task rows show their current status.</p>}
      {page.sections.map(section => (
        <PageSection key={section.id} page={page} section={section} workspace={workspace} today={today} isPast={isPast} />
      ))}
      {!isPast && (
        <form
          className="add-section"
          onSubmit={e => {
            e.preventDefault()
            if (!newSection.trim()) return
            void run({ type: 'add-section', pageId: page.id, title: newSection.trim() })
            setNewSection('')
          }}
        >
          <input value={newSection} onChange={e => setNewSection(e.target.value)} placeholder="+ New section" aria-label="New section name" />
        </form>
      )}
    </article>
  )
}

function PageSection({ page, section, workspace, today, isPast }: { page: Page; section: Section; workspace: Workspace; today: LocalDate; isPast: boolean }) {
  const { run } = useWorkspace()
  const [title, setTitle] = useState(section.title)
  const isMaterial = section.kind === 'good-stuffs'

  return (
    <section className={`page-section kind-${section.kind}`} aria-label={section.title}>
      <header className="section-head">
        <h2>
          <input
            className="section-title"
            value={title}
            readOnly={isPast}
            aria-label="Section name"
            onChange={e => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== section.title && run({ type: 'rename-section', pageId: page.id, sectionId: section.id, title: title.trim() })}
          />
        </h2>
        {!isPast && (
          <RowMenu
            label={`Section ${section.title}`}
            groups={[
              {
                items: [
                  {
                    label: 'Remove section',
                    danger: true,
                    onSelect: () =>
                      run({ type: 'remove-section', pageId: page.id, sectionId: section.id }, r => ({
                        text: isMaterial ? 'Section removed · links will now be saved only through capture or Save' : 'Section removed',
                        undoOperationId: r.operationId,
                      })),
                  },
                ],
              },
            ]}
          />
        )}
      </header>
      <div className="blocks">
        {section.blocks.map(block => (
          <BlockView key={block.id} block={block} page={page} section={section} workspace={workspace} today={today} isPast={isPast} />
        ))}
      </div>
      {!isPast && <NewLine page={page} section={section} today={today} />}
    </section>
  )
}

function BlockView({ block, page, section, workspace, today, isPast }: { block: NoteBlock; page: Page; section: Section; workspace: Workspace; today: LocalDate; isPast: boolean }) {
  const { run } = useWorkspace()
  const from = block.sourcePageId ? workspace.pages.find(p => p.id === block.sourcePageId)?.date : null
  const fromTag = from ? <span className="from">from {weekday(from)}</span> : null

  switch (block.kind) {
    case 'task': {
      const task = workspace.tasks.find(t => t.id === block.taskId)
      if (!task) return <p className="missing">Original removed</p>
      const planSection = section.kind === 'top3' ? 'top3' : 'other'
      return (
        <div className="block">
          <TaskRow
            task={task}
            pageDate={page.date ?? today}
            today={today}
            variant={isPast ? 'past' : section.kind === 'top3' || section.kind === 'other' ? 'plan' : 'ref'}
            section={planSection}
            onEditTitle={t => run({ type: 'edit-block', pageId: page.id, blockId: block.id, text: t })}
            onDeleteRow={() =>
              run({ type: 'remove-blocks', pageId: page.id, blockIds: [block.id], bulk: false, today }, r => ({
                text: notTodayText(task, today, today),
                undoOperationId: r.operationId,
                // Keep planned: restore the plan, then remove only this row, in one checked command.
                extra: {
                  label: 'Keep planned',
                  run: () =>
                    void run({ type: 'keep-planned', targetOperationId: r.operationId, pageId: page.id, blockId: block.id }, {
                      text: 'Kept on today’s plan · not in note',
                    }),
                },
              }))
            }
          />
          {fromTag}
        </div>
      )
    }
    case 'event': {
      const event = workspace.events.find(e => e.id === block.eventId)
      return (
        <div className="block event-row">
          <span className="event-title">{event?.title ?? block.text}</span>
          {event?.time && <span className="tag">{event.time}</span>}
        </div>
      )
    }
    case 'material':
      return <MaterialLine block={block} workspace={workspace} fromTag={fromTag} readOnly={isPast} today={today} />
    case 'reference': {
      const target = workspace.pages.find(p => p.id === block.targetPageId)
      return (
        <div className="block">
          {target ? (
            <a className="reference" href={target.date ? `/day/${target.date}` : '#'}>
              {target.title || block.text} <span className="quiet">Open</span>
            </a>
          ) : (
            <span className="reference missing">Original removed</span>
          )}
        </div>
      )
    }
    default:
      return <Paragraph block={block} page={page} readOnly={isPast} fromTag={fromTag} />
  }
}

function Paragraph({ block, page, readOnly, fromTag }: { block: NoteBlock; page: Page; readOnly: boolean; fromTag: React.ReactNode }) {
  const { run } = useWorkspace()
  const [text, setText] = useState(block.text)
  return (
    <div className="block paragraph">
      <textarea
        value={text}
        readOnly={readOnly}
        rows={1}
        aria-label="Note text"
        onChange={e => setText(e.target.value)}
        onBlur={() => text !== block.text && run({ type: 'edit-block', pageId: page.id, blockId: block.id, text })}
      />
      {fromTag}
    </div>
  )
}

function MaterialLine({ block, workspace, fromTag, readOnly, today }: { block: NoteBlock; workspace: Workspace; fromTag: React.ReactNode; readOnly: boolean; today: LocalDate }) {
  const { run } = useWorkspace()
  const material = workspace.materials.find(m => m.id === block.materialId)
  if (!material) return <p className="block missing">Original removed</p>
  const savedBefore = material.sources.length > 1
  return (
    <div className="block material-row">
      <a href={material.url} target="_blank" rel="noreferrer" className="material-title" onClick={() => void run({ type: 'open-material', materialId: material.id, date: today })}>
        {displayTitle(material.title, material.url)}
      </a>
      {savedBefore && <span className="tag quiet">Saved before</span>}
      {!material.resurface && <span className="tag quiet">Won’t be suggested</span>}
      {fromTag}
      {!readOnly && (
        <RowMenu
          label={`Actions for ${material.title}`}
          groups={[
            {
              items: [
                { label: 'Open', onSelect: () => { void run({ type: 'open-material', materialId: material.id, date: today }); window.open(material.url, '_blank', 'noreferrer') } },
                material.resurface
                  ? {
                      label: 'Don’t resurface',
                      onSelect: () =>
                        run({ type: 'material-resurface', materialId: material.id, enabled: false }, r => ({
                          text: 'Won’t suggest this again',
                          undoOperationId: r.operationId,
                        })),
                    }
                  : { label: 'Suggest again', onSelect: () => run({ type: 'material-resurface', materialId: material.id, enabled: true }) },
              ],
            },
          ]}
        />
      )}
    </div>
  )
}

/** The trailing line of each section: type to add. Links in the material section save as material (01 §6.1). */
function NewLine({ page, section, today }: { page: Page; section: Section; today: LocalDate }) {
  const { run } = useWorkspace()
  const [text, setText] = useState('')
  const isMaterial = section.kind === 'good-stuffs'
  const isPlan = section.kind === 'top3' || section.kind === 'other'

  const commit = () => {
    const value = text.trim()
    if (!value) return
    const taskMatch = value.match(TASK_PREFIX)
    if (isMaterial && URL_ONLY.test(value)) {
      // The domain turns a link line in the material section into saved material.
      void run({ type: 'add-text', pageId: page.id, sectionId: section.id, text: value }, r => ({ text: r.message.startsWith('Link saved') ? 'Saved to Good Stuffs' : r.message }))
    } else if (taskMatch || (isPlan && !PROSE_PREFIX.test(value))) {
      void run({ type: 'add-task', pageId: page.id, sectionId: section.id, title: taskMatch ? taskMatch[1] : value, plannedOn: page.date ?? today })
    } else {
      void run({ type: 'add-text', pageId: page.id, sectionId: section.id, text: value })
    }
    setText('')
  }

  return (
    <input
      className="new-line"
      value={text}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), commit())}
      onBlur={commit}
      placeholder={isMaterial ? 'Paste a link to keep' : isPlan ? 'Add a task' : 'Write…  ([] for a task)'}
      aria-label={`Add to ${section.title}`}
    />
  )
}

/** Links saved without a fetched title show host + path instead of the raw URL. */
export function displayTitle(title: string, url: string): string {
  if (title && title !== url) return title
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    return `${u.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}
