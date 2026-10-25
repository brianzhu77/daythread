// B27 (plan §4, Jazz b27-at-date-states §3): a day's events drawn under its Events heading, read live and never part
// of the document. One ProseMirror widget holds them; React renders into it through a portal. The widget has no
// position in the text, so it can't be typed into, selected, copied or saved.
import { createExtension } from '@blocknote/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useNavigate } from '@tanstack/react-router'
import type { DayEvent } from '../domain/chip-events'
import type { LocalDate, Page, Workspace } from '../domain/types'
import { displayPageTitle } from './page-title'
import { createContext, useContext } from 'react'
import { useComponentsContext, type DefaultReactSuggestionItem, type SuggestionMenuProps } from '@blocknote/react'
import { addDays, fromIso, todayIso } from './dates'
import { CalendarIcon } from './icons'
import { LineRefChip } from './line-ref-chip'

const key = new PluginKey<DecorationSet>('daythread-event-rows')
/** Where the rows go: after this heading's block, at the page's end (`null`: no Events heading), or nowhere. */
export type RowsAnchor = { headingId: string | null } | undefined

function place(doc: PMNode, anchor: RowsAnchor, host: HTMLElement): DecorationSet {
  if (!anchor) return DecorationSet.empty
  let at = -1
  if (anchor.headingId) doc.descendants((node, pos) => {
    if (at >= 0) return false
    if (node.type.name === 'blockContainer' && node.attrs.id === anchor.headingId) { at = pos + node.nodeSize; return false }
    return true
  })
  // No Events heading in the document (removed, or not there yet): the end of the page, inside its block group.
  if (at < 0) at = doc.content.size - 1
  host.classList.toggle('is-page-end', !anchor.headingId || at === doc.content.size - 1)
  return DecorationSet.create(doc, [Decoration.widget(at, host, { key: 'event-rows', side: -1, ignoreSelection: true, stopEvent: () => true })])
}

/** `anchor()` is read on every document change and when `refreshEventRows` asks (the workspace changed). */
export const eventRows = (host: HTMLElement, anchor: () => RowsAnchor) => createExtension({
  key: 'daythreadEventRows',
  prosemirrorPlugins: [new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => place(state.doc, anchor(), host),
      apply: (tr, old) => tr.docChanged || tr.getMeta(key) ? place(tr.doc, anchor(), host) : old,
    },
    props: { decorations: state => key.getState(state) },
  })],
})
/** Chips cut from this tab (by id), so pasting them back is a move that keeps the event (Ratchet 26291155). */
const cutChips = new Set<string>()
const chipIds = (frag: Fragment, into: string[] = []) => { frag.forEach(n => { if (n.type.name === 'dateMention' && n.attrs.eventId) into.push(String(n.attrs.eventId)); else chipIds(n.content, into) }); return into }
/**
 * B27: a pasted `@date` chip is a new event unless it's a move. Covers every paste that goes through ProseMirror
 * (text selections, BlockNote's HTML, drag and drop); the app's own whole-block clipboard handles its own (page-editor).
 * A move keeps the id: a drag that moves, or a paste of chips cut from this tab that the document no longer holds.
 */
export const dateChipPaste = () => createExtension({
  key: 'daythreadDateChipPaste',
  prosemirrorPlugins: [new Plugin({
    props: {
      transformPasted: (slice, view) => {
        if (!chipIds(slice.content).length) return slice
        const moving = Boolean((view as unknown as { dragging?: { move?: boolean } }).dragging?.move)
        const held = new Set(chipIds(view.state.doc.content))
        const remap = (frag: Fragment): Fragment => {
          const nodes: PMNode[] = []
          frag.forEach(n => {
            if (n.type.name === 'dateMention') {
              const id = String(n.attrs.eventId ?? '')
              const keep = moving || (cutChips.has(id) && !held.has(id))
              if (keep) cutChips.delete(id)
              nodes.push(keep ? n : n.type.create({ ...n.attrs, eventId: crypto.randomUUID() }, n.content, n.marks))
            } else nodes.push(n.isLeaf ? n : n.copy(remap(n.content)))
          })
          return Fragment.fromArray(nodes)
        }
        return new Slice(remap(slice.content), slice.openStart, slice.openEnd)
      },
      handleDOMEvents: {
        cut: view => { for (const id of chipIds(view.state.selection.content().content)) cutChips.add(id); return false },
      },
    },
  })],
})

export const refreshEventRows = (view: { state: { tr: import('@tiptap/pm/state').Transaction }; dispatch: (tr: import('@tiptap/pm/state').Transaction) => void; isDestroyed?: boolean }) => {
  if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false))
}

/**
 * The rows a page shows: the day's events, less any whose chip sits under this same page's Events heading (that line
 * already is the row, Jazz §3).
 */
export function rowsFor(page: Page, events: DayEvent[]): DayEvent[] {
  const own = new Set(page.sections.filter(s => s.kind === 'events').flatMap(s => s.blocks.map(b => b.id)))
  return events.filter(e => !(e.line && e.line.pageId === page.id && own.has(e.line.lineId)))
}

/** "3 PM", "3:30 PM": the chip's and the strip's time. */
export const shortTime = (time: string) => {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}
export const rowTime = (time: string | null) => {
  if (!time) return 'All day'
  const [h, m] = time.split(':').map(Number) as [number, number]
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** The row's link back (Jazz §3): "↗ Thu, Oct 22 · Notes", "↗ Trip notes" on a document page, "↗ in Notes" here. */
function backLabel(ws: Workspace, page: Page | null, line: NonNullable<DayEvent['line']>): string {
  const from = ws.pages.find(p => p.id === line.pageId)
  const section = from?.sections.find(s => s.blocks.some(b => b.id === line.lineId))?.title.trim()
  if (page && from?.id === page.id) return section ? `in ${section}` : 'on this page'
  const where = from?.type === 'daily' && from.date ? fromIso(from.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : from ? displayPageTitle(from) : ''
  return section && from?.type === 'daily' ? `${where} · ${section}` : where
}

export function EventRows({ rows, page, workspace, pageEnd }: { rows: DayEvent[]; page: Page | null; workspace: Workspace; pageEnd: boolean }) {
  if (!rows.length) return null
  return (
    <div className="event-rows-list" role="list" aria-label="Events">
      {pageEnd && <div className="event-rows-label">Events</div>}
      {rows.map(e => {
        const here = Boolean(page && e.line?.pageId === page.id)
        return (
          <div key={e.id} className={`day-event${here ? ' is-here' : ''}`} role="listitem">
            <span className={`day-event-time${e.time ? '' : ' is-all-day'}`}>{rowTime(e.time)}</span>
            <span className="day-event-body">
              <span className={`day-event-title${e.title ? '' : ' is-untitled'}`}>{e.title || 'Untitled event'}</span>
              {e.line && <LineRefChip target={e.line} label={backLabel(workspace, page, e.line)} />}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** The picker's date (Jazz §1): "Thu, Nov 20", with the year when it isn't the page's (or today's) year. */
export function pickerLabel(date: LocalDate, yearOf: LocalDate): string {
  return fromIso(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(yearOf.slice(0, 4) === date.slice(0, 4) ? {} : { year: 'numeric' }) })
}
/** The picker's quiet right label for a suggested day: "Today", "Tomorrow", "in 3 days", "2 days ago". */
export function relativeDay(date: LocalDate, today: LocalDate): string {
  const n = Math.round((fromIso(date).getTime() - fromIso(today).getTime()) / 86_400_000)
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`
}
/** The chip's own label (Jazz §2): "Thu, Nov 20 · 3 PM", "Today", "Tomorrow"; the year only off the page's year. */
export function chipLabel(date: LocalDate, time: string | null, today: LocalDate, pageDate: LocalDate | null): string {
  const d = fromIso(date)
  const day = date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow'
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(pageDate?.slice(0, 4) === date.slice(0, 4) || (!pageDate && today.slice(0, 4) === date.slice(0, 4)) ? {} : { year: 'numeric' }) })
  if (!time) return day
  const [h, m] = time.split(':').map(Number) as [number, number]
  return `${day} · ${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

/** The date of the day page the editor is showing (null on a document page), for the chip's year rule. */
export const ChipPageDate = createContext<LocalDate | null>(null)
export function DateChipInPage({ date, time }: { date: string; time: string | null }) {
  const pageDate = useContext(ChipPageDate)
  return <DateChip date={date} time={time} today={todayIso()} pageDate={pageDate} />
}
export function DateChip({ date, time, today, pageDate }: { date: LocalDate; time: string | null; today: LocalDate; pageDate: LocalDate | null }) {
  const navigate = useNavigate()
  return <span className="page-ref date-ref" contentEditable={false} role="link" tabIndex={-1}
    onMouseDown={e => e.preventDefault()} onClick={() => void navigate({ to: '/day/$date', params: { date } })}>
    <span className="page-ref-icon"><CalendarIcon /></span>
    <span className="page-ref-title">{chipLabel(date, time, today, pageDate)}</span>
  </span>
}

/** A row of the `@` list; `hint` is the "Keep typing a date" row, which isn't a choice (Jazz 2cf1591a). */
export type DateMenuItem = DefaultReactSuggestionItem & { hint?: boolean }
/**
 * The `@` list: BlockNote's own menu parts (same look and keys as the `[[` list), with the right label as quiet text
 * rather than a pill, and the hint row drawn as plain text that never looks picked.
 */
export function DateMenu({ items, selectedIndex, onItemClick }: SuggestionMenuProps<DateMenuItem>) {
  const Components = useComponentsContext()!
  return (
    <Components.SuggestionMenu.Root id="bn-suggestion-menu" className="bn-suggestion-menu date-menu">
      {items.map((item, i) => item.hint
        ? <div key="hint" className="date-menu-hint" role="presentation"><div className="date-menu-hint-title">{item.title}</div><div className="date-menu-hint-sub">{item.subtext}</div></div>
        : <Components.SuggestionMenu.Item key={item.title} className="bn-suggestion-menu-item date-menu-item" item={item} id={`bn-suggestion-menu-item-${i}`} isSelected={i === selectedIndex} onClick={() => onItemClick?.(item)} />)}
    </Components.SuggestionMenu.Root>
  )
}
