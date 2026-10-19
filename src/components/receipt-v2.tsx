import { useState } from 'react'
import type { Capture, GroundingFlag, LocalDate, ProposalItem, Workspace } from '../domain/types'
import { addDays, fromIso, todayIso } from './dates'
import { RowMenu, type MenuItem } from './row-menu'
import { useWorkspace } from './use-day'

// Capture receipt v2 (Jazz, docs/design/capture-receipt-v2.md 283697c; check list 09387e2) for model captures:
// every item fixable in one tap, held items in "Needs a look", updates wait for Apply, his text always first.

const typeLabel: Record<ProposalItem['kind'], string> = {
  'create-task': 'Task', 'create-event': 'Event', 'create-material': 'Saved link', 'add-note': 'Note', 'update-task': 'Update',
}
const flagCopy: Record<GroundingFlag, string> = {
  'time-not-in-text': 'Time not in your text', 'url-not-in-text': 'Link not in your text', 'title-not-grounded': 'Title not in your text',
  'task-not-named': 'Task not in your text', 'date-missing': 'Date missing', 'date-role-missing': 'Date unclear',
}
const roleWord = { do: 'Do', due: 'Due', start: 'Start' } as const

function dayLabel(date: LocalDate, today: LocalDate): string {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  return fromIso(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
/** "Do Fri, Oct 31" / "Due …" for tasks and updates, "Mon, Oct 26 · 12:30" for events, the host for a link. */
function dateText(item: ProposalItem, today: LocalDate): string | null {
  if (item.kind === 'create-material') { try { return new URL(item.url ?? '').host } catch { return null } }
  if (item.kind === 'add-note') return null
  if (!item.date) return 'No date'
  const day = dayLabel(item.date, today)
  if (item.kind === 'create-event') return item.time ? `${day} · ${item.time}` : item.partOfDay ? `${day} · ${item.partOfDay}` : day
  return `${roleWord[item.dateRole ?? 'do']} ${day}`
}

export function ReceiptV2({ capture, workspace }: { capture: Capture; workspace: Workspace }) {
  const { run, retryCapture, model } = useWorkspace()
  const [showOriginal, setShowOriginal] = useState(false)
  const items = capture.proposals ?? []
  const held = items.filter(x => !x.state && x.kind !== 'update-task')
  const saved = items.filter(x => x.state === 'applied')
  const updates = items.filter(x => !x.state && x.kind === 'update-task')
  const waiting = held.length + updates.length
  const quote = `“${capture.text.length > 80 ? `${capture.text.slice(0, 80)}…` : capture.text}”`
  const fromPage = workspace.pages.find(p => p.id === capture.pageId)
  const send = (action: Parameters<typeof run>[0], undoable = true) => run(action, undoable ? r => ({ text: r.message, undoOperationId: r.operationId }) : null)

  return (
    <section className={`app-card receipt receipt-v2 status-${capture.status}`} aria-label="Capture result">
      {/* His words come first in every state: they're saved before anything else happens. */}
      <header className="card-head receipt-head">
        <p className="receipt-source">
          {capture.status === 'organizing' ? 'Saved' : capture.status === 'failed' ? 'From' : waiting ? `${waiting} waiting for you · from` : capture.status === 'discarded' ? 'Undone · your text is kept ·' : 'Saved from'} {quote}
          {fromPage?.date && <span className="quiet"> · {dayLabel(fromPage.date, todayIso())}</span>}
        </p>
        {capture.status === 'organizing' && <span className="model-tag"><span className="spinner" aria-hidden="true" />Organizing…</span>}
        {model.costUnknown.includes(capture.id) && <span className="cost-unknown">Cost unknown</span>}
      </header>

      {capture.status === 'failed' && (
        <div className="model-state" role="status">
          <p className="warn-text">{capture.error ?? 'Model unavailable · text saved'}</p>
          {capture.failure !== 'budget' && capture.failure !== 'paused' && model.state !== 'paused' && <button type="button" className="secondary" onClick={() => void retryCapture(capture.id)}>Retry</button>}
        </div>
      )}

      {held.length > 0 && (
        <div className="receipt-group">
          <p className="group-title">Needs a look</p>
          <ul className="receipt-rows">
            {held.map(item => <ItemRow key={item.id} item={item} capture={capture} send={send} held />)}
          </ul>
        </div>
      )}

      {saved.length > 0 && (
        <ul className="receipt-rows">
          {saved.map(item => <ItemRow key={item.id} item={item} capture={capture} send={send} />)}
        </ul>
      )}

      {updates.length > 0 && (
        <div className="receipt-group">
          <ul className="receipt-rows">
            {updates.map(item => <UpdateRow key={item.id} item={item} capture={capture} send={send} />)}
          </ul>
        </div>
      )}

      {capture.error && capture.status !== 'failed' && (
        <p className="quiet unreadable">
          {capture.error} ·{' '}
          <button type="button" className="app-link" onClick={() => setShowOriginal(true)}>See your text</button>
        </p>
      )}

      <p className="card-meta">
        {saved.length > 0 && <><button type="button" className="app-link" onClick={() => void send({ type: 'undo-capture', captureId: capture.id })}>Undo all</button> · </>}
        {capture.contextLine && capture.status !== 'organizing' && capture.status !== 'failed' && <span>{capture.contextLine} · </span>}
        <button type="button" className="app-link" onClick={() => setShowOriginal(s => !s)}>{showOriginal ? 'Hide original' : 'Show original'}</button>
      </p>
      {showOriginal && <blockquote className="original">{capture.text}</blockquote>}
    </section>
  )
}

/**
 * The date chip's menu for a task, an event or a waiting update (spec 4e8c2f1+): KIND OF DATE, DAY and, for an event,
 * TIME; the current choice carries a check mark.
 */
function dateMenuGroups(item: ProposalItem, edit: (patch: Record<string, unknown>) => void, today: LocalDate, setTime: () => void) {
  const days = [0, 1, 2, 3, 4, 5, 6, 7].map(n => addDays(today, n))
  const withRole = item.kind === 'create-task' || item.kind === 'update-task'
  const role = item.date ? item.dateRole ?? 'do' : null
  const groups: { title?: string; items: MenuItem[] }[] = []
  if (withRole) groups.push({ title: 'Kind of date', items: (['do', 'start', 'due'] as const).map(r => ({ label: roleWord[r], checked: role === r, onSelect: () => edit({ dateRole: r, ...(item.date ? {} : { date: today }) }) })) })
  groups.push({ title: 'Day', items: [
    ...(item.date && !days.includes(item.date) ? [{ label: dayLabel(item.date, today), checked: true, onSelect: () => undefined }] : []),
    ...days.map(d => ({ label: dayLabel(d, today), checked: item.date === d, onSelect: () => edit({ date: d }) })),
    ...(item.kind === 'create-task' ? [{ label: 'No date', checked: !item.date, onSelect: () => edit({ date: null }) }] : []),
  ] })
  // An invented time is cleared, or replaced, in one step; the day stays (Bumblebee d26b1d5c, Jazz spec TIME group).
  if (item.kind === 'create-event') groups.push({ title: 'Time', items: [
    ...(item.time ? [{ label: item.time, checked: true, onSelect: () => undefined }] : []),
    { label: 'No time', checked: !item.time, onSelect: () => edit({ time: null }) },
    { label: 'Set time…', onSelect: setTime },
  ] })
  return groups
}

function TimeInput({ value, onSave, onCancel }: { value: string | null; onSave: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value ?? '')
  const done = (save: boolean) => { if (save && /^\d{2}:\d{2}$/.test(v) && v !== value) onSave(v); else onCancel() }
  return <input type="time" className="date-chip time-input" autoFocus value={v} aria-label="Event time" onChange={e => setV(e.target.value)} onBlur={() => done(true)}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); done(true) } else if (e.key === 'Escape') { e.preventDefault(); done(false) } }} />
}

type Send = (action: Parameters<ReturnType<typeof useWorkspace>['run']>[0], undoable?: boolean) => Promise<unknown>

function ItemRow({ item, capture, send, held = false }: { item: ProposalItem; capture: Capture; send: Send; held?: boolean }) {
  const today = todayIso()
  const [settingTime, setSettingTime] = useState(false)
  const edit = (patch: Record<string, unknown>) => void send({ type: 'edit-capture-item', captureId: capture.id, itemId: item.id, ...patch } as never, !held)
  const typeMenu: MenuItem[] = (['create-task', 'create-event', 'add-note'] as const).filter(k => k !== item.kind).map(k => ({ label: typeLabel[k], onSelect: () => edit({ kind: k }) }))
  const changeable = item.kind === 'create-task' || item.kind === 'create-event' || item.kind === 'add-note'
  const dated = item.kind === 'create-task' || item.kind === 'create-event'
  const date = dateText(item, today)
  return (
    <li className={`receipt-row ${held ? 'held' : ''}`}>
      {changeable
        ? <RowMenu label={`Change type of ${item.title}`} groups={[{ items: typeMenu }]} trigger={typeLabel[item.kind]} triggerClass="app-chip chip-button" />
        : <span className="app-chip">{typeLabel[item.kind]}</span>}
      <EditableTitle title={item.kind === 'create-material' ? item.note || item.title : item.title} editable={item.kind !== 'create-material'} onSave={title => edit({ title })} />
      <span className="receipt-chips">
        {item.flags?.map(f => <span key={f} className="reason-chip">{flagCopy[f]}</span>)}
        {settingTime
          ? <TimeInput value={item.time ?? null} onSave={time => { setSettingTime(false); edit({ time }) }} onCancel={() => setSettingTime(false)} />
          : date && (dated
            ? <RowMenu label={`Change date of ${item.title}`} groups={dateMenuGroups(item, edit, today, () => setSettingTime(true))} trigger={date} triggerClass={`date-chip chip-button ${item.date ? '' : 'no-date'}`} />
            : <span className="date-chip">{date}</span>)}
      </span>
      {held
        ? <span className="row-actions">
            <button type="button" className="secondary" onClick={() => void send({ type: 'save-capture-item', captureId: capture.id, itemId: item.id })}>Save</button>
            <button type="button" className="ghost" onClick={() => void send({ type: 'remove-capture-item', captureId: capture.id, itemId: item.id }, false)}>Remove</button>
          </span>
        : <RowMenu label={`More for ${item.title}`} groups={[{ items: [
            { label: 'Remove', onSelect: () => void send({ type: 'remove-capture-item', captureId: capture.id, itemId: item.id }) },
            ...(item.kind === 'create-task' && item.entityId ? [{ label: 'Open', onSelect: () => { window.location.assign(item.date && item.dateRole !== 'due' ? `/day/${item.date}` : '/tasks') } }] : []),
            ...(item.kind === 'create-event' && item.date ? [{ label: 'Open', onSelect: () => { window.location.assign(`/day/${item.date}`) } }] : []),
            ...(item.kind === 'create-material' && item.url ? [{ label: 'Open', onSelect: () => { window.open(item.url, '_blank', 'noopener') } }] : []),
          ] }]} />}
    </li>
  )
}

function UpdateRow({ item, capture, send }: { item: ProposalItem; capture: Capture; send: Send }) {
  const today = todayIso()
  // A date-moving update shows its target as the same date chip as a task; role and day are one tap to fix before
  // Apply (Bumblebee d26b1d5c, spec). "→ done" has no chip.
  const edit = (patch: Record<string, unknown>) => void send({ type: 'edit-capture-item', captureId: capture.id, itemId: item.id, ...patch } as never, false)
  const moves = item.status !== 'done' && !!item.date
  return (
    <li className="receipt-row update">
      <span className="app-chip update-chip">Update</span>
      <span className="receipt-title">{item.title} → {item.status === 'done' ? 'done' : moves ? '' : 'change'}</span>
      {moves && (
        <span className="receipt-chips">
          <RowMenu label={`Change date of ${item.title}`} groups={dateMenuGroups(item, edit, today, () => undefined)} trigger={dateText(item, today)} triggerClass="date-chip chip-button" />
        </span>
      )}
      <span className="row-actions">
        <button type="button" className="primary" onClick={() => void send({ type: 'save-capture-item', captureId: capture.id, itemId: item.id })}>Apply</button>
        <button type="button" className="ghost" onClick={() => void send({ type: 'remove-capture-item', captureId: capture.id, itemId: item.id }, false)}>Discard</button>
      </span>
    </li>
  )
}

/** The title is the field: tap to edit in place, Enter or blur saves, Esc puts it back (Jazz). */
function EditableTitle({ title, editable, onSave }: { title: string; editable: boolean; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  if (!editable) return <span className="receipt-title">{title}</span>
  const start = () => { setValue(title); setEditing(true) }
  // A span, not a <button>: Chromium ignores line-clamp inside buttons, so long titles were cut to one line.
  if (!editing) return <span role="button" tabIndex={0} className="receipt-title as-text" onClick={start} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start() } }}>{title}</span>
  const done = (save: boolean) => { setEditing(false); if (save && value.trim() && value.trim() !== title) onSave(value.trim()) }
  return <input className="receipt-title" autoFocus value={value} aria-label="Item title" onChange={e => setValue(e.target.value)} onBlur={() => done(true)}
    onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); done(true) } else if (e.key === 'Escape') { e.preventDefault(); done(false) } }} />
}
