// B76 (Jazz docs/design/day-draft-states.md, Lead 5a15305c): a new day's draft shown on the page itself. Each suggestion
// is a band after its anchor block, drawn by a ProseMirror widget like the Events rows, so it is never part of the
// document until he applies it. The data side (the hidden draft page, draftView, apply-draft / skip-draft) is
// Roadbuster's; `useDayDraft` is the seam between the two.
import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { type Node as PMNode } from '@tiptap/pm/model'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { inlineText, type EditorNode } from '../domain/editor-document'
import type { LocalDate, Page, Workspace } from '../domain/types'
import { Button, toast } from '@heroui/react'
import { addDays, anotherDayOptions, shortLabel, todayIso } from './dates'
import { appliedNotice as appliedWords, draftLineWords, draftWords, skippedLabel, skippedNotice } from './draft-words'
import { NoticeRow } from './notice-row'
import { noticeDate, pickDate } from './row-actions'
import { useDayDraft as useRealDayDraft, type DecisionHooks, type DecisionOutcome, type DraftTicket } from './use-day-draft'
import { HOLD_MS as TICK_HOLD_MS } from './task-ticks'

export type DraftState = 'none' | 'preparing' | 'ready' | 'failed' | 'offline'
export type DraftItem = {
  id: string
  /** Already resolved by the data side: a fill whose anchor has text arrives as 'after'. */
  kind: 'fill' | 'after'
  /** A block of the day page; a gone anchor arrives already moved to the end of the planning part. */
  anchorId: string
  /** What applying inserts. A carried to-do carries `props.taskId`; its title is read live from the task. */
  block: EditorNode
  /** Carried to-dos only: the day it was first planned, shown as its age. */
  since?: LocalDate
  /** Carried to-dos only: the earlier days he skipped it, oldest first; then the row offers Another day (#377). */
  skipped?: LocalDate[]
}
export type OpenTask = { taskId: string; title: string; since: LocalDate }
/** `gone`: only a refusal's note is left in the item's place (§2.1.4). */
export type ShownBand = { item: DraftItem; look: BandLook | 'gone'; note?: string }
export interface DayDraft {
  state: DraftState
  /** Pending and still eligible, in page order. */
  items: DraftItem[]
  pageId: string
  /** What the page shows for the draft, in page order: each item's look (tap feedback §2), a skipped one through its hold, a refusal's note. */
  bands: ShownBand[]
  moreOpen: OpenTask[]
  /** Where a band whose anchor is gone goes: under the planning heading, after his planned rows. */
  planningEndId: string | null
  /** "N more open" sits after this block: the end of the planning part. Optional for check-script stand-ins. */
  moreOpenAfterId?: string | null
  /** Tap feedback §2: decided on this device and not answered yet (from the stored change), by item. */
  decided: Record<string, 'apply' | 'skip'>
  /** Held by the server (the draft changed since): said on the band until Keep mine or Discard in the banner. */
  held: Record<string, { kind: 'apply' | 'skip' | 'move'; operationId: string; /** One decision on several items (Apply all, Dismiss): said once, under the draft line (B109). */ batch: boolean }>
  apply(itemIds: string[], edits?: Record<string, string>, hooks?: DecisionHooks): Promise<DecisionOutcome & { applied: string[]; dropped: string[] }>
  /** The notice's ticket for Move to and its second Undo (use-day-draft.ts), or null when nothing was skipped. */
  skip(itemIds: string[], hooks?: DecisionHooks<DraftTicket>): Promise<DraftTicket | null>
  /** The Applied notice's Undo, before or after the apply has landed (§2.4a). */
  undoApply(operationId: string): Promise<'done' | 'refused' | 'failed'>
  /** Move to: the ticket's to-dos planned on `date`, kept skipped here; one planned elsewhere since stays (`dropped`). */
  snooze(ticket: DraftTicket, date: LocalDate): Promise<{ status: 'done' | 'refused' | 'failed'; moved: string[]; dropped: string[]; operationId: string; reason?: string }>
  /** Undo on `Moved to …`: takes back only the move. */
  undoMove(operationId: string): Promise<'done' | 'refused' | 'failed'>
  /** The skip notice's Undo after Undo move: reopens what that skip left, or 'refused' if it was changed since. */
  reopen(ticket: DraftTicket): Promise<'done' | 'refused' | 'failed'>
  /** The row's Another day (#377): skipped here and planned on `date` in one write; its Undo is `undoApply`'s. */
  move(itemId: string, date: LocalDate, hooks?: DecisionHooks): Promise<DecisionOutcome & { reason?: string }>
  addOpen(taskId: string): Promise<boolean>
  retry(): void
}

// ---------- The seam: Roadbuster's hook (use-day-draft.ts); a check script's store (`window.__daythreadDraft`) overrides it. ----------

type MockDraft = Pick<DayDraft, 'state' | 'items' | 'moreOpen' | 'planningEndId' | 'moreOpenAfterId'>
type MockWindow = Window & { __daythreadDraft?: Record<string, MockDraft>; __daythreadDraftLog?: unknown[] }
const listeners = new Set<() => void>()
let version = 0
const bump = () => { version++; listeners.forEach(l => l()) }
if (typeof window !== 'undefined') (window as MockWindow & { __daythreadDraftBump?: () => void }).__daythreadDraftBump = bump
const mockOf = (pageId: string): MockDraft | undefined => typeof window === 'undefined' ? undefined : ((window as MockWindow).__daythreadDraft?.[pageId] ?? (window as MockWindow).__daythreadDraft?.['*'])
const log = (entry: unknown) => { const w = window as MockWindow; (w.__daythreadDraftLog ??= []).push(entry) }

export function useDayDraft(page: Page): DayDraft {
  useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => version, () => 0)
  const real = useRealDayDraft(page)
  // A decision the server held, now or after a send from the outbox: its own notice closes (newer ones stay), and the
  // band stops showing it as decided (Ratchet 34690a2c).
  const heldKey = Object.values(real.held).map(h => h.operationId).sort().join(',')
  useEffect(() => { if (heldKey) settleHeld(real.held) }, [heldKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const mock = mockOf(page.id)
  // The real draft (use-day-draft.ts) unless a check script set a stand-in for this page.
  if (!mock) {
    const items: DraftItem[] = real.items.map(i => ({ id: i.id, kind: i.kind, anchorId: i.anchorId ?? real.planningEndId ?? '', block: i.block, ...(i.since ? { since: i.since } : {}), ...(i.skipped?.length ? { skipped: i.skipped } : {}) }))
    return { ...real, pageId: page.id, items, bands: bandsOf(page.id, items, real.decided, real.held) }
  }
  const edit = (ids: string[]) => { if (mock) { mock.items = mock.items.filter(i => !ids.includes(i.id)); bump() } }
  return {
    state: mock?.state ?? 'none',
    items: mock?.items ?? [],
    pageId: page.id,
    bands: bandsOf(page.id, mock?.items ?? [], {}, {}),
    held: {},
    moreOpen: mock?.moreOpen ?? [],
    planningEndId: mock?.planningEndId ?? null,
    moreOpenAfterId: mock?.moreOpenAfterId ?? null,
    decided: {},
    apply: async (ids, edits, hooks) => { log({ apply: ids, edits }); hooks?.onStored?.('mock-apply'); edit(ids); return { applied: ids, dropped: [], operationId: 'mock-apply', stored: true, landed: true, refused: false, held: false, failed: false } },
    skip: async (ids, hooks) => { log({ skip: ids }); const ticket = { itemIds: ids, skippedBy: 'mock-skip', seen: {} }; hooks?.onStored?.(ticket); edit(ids); return ticket },
    undoApply: async operationId => { log({ undoApply: operationId }); return 'done' },
    snooze: async (ticket, date) => { log({ snooze: ticket.itemIds, date }); return { status: 'done', moved: ticket.itemIds, dropped: [], operationId: 'mock-move' } },
    undoMove: async operationId => { log({ undoMove: operationId }); return 'done' },
    reopen: async ticket => { log({ reopen: ticket.itemIds }); return 'done' },
    move: async (itemId, date, hooks) => { log({ move: itemId, date }); hooks?.onStored?.('mock-move'); edit([itemId]); return { operationId: 'mock-move', stored: true, landed: true, refused: false, held: false, failed: false } },
    addOpen: async taskId => { log({ addOpen: taskId }); if (mock) { mock.moreOpen = mock.moreOpen.filter(t => t.taskId !== taskId); bump() } return true },
    retry: () => { log({ retry: true }); if (mock) { mock.state = 'preparing'; bump() } },
  }
}

// ---------- The notice after ✕ or Dismiss: Skipped, and a day to move its to-dos to (B100, Jazz 7fd3eaa9, Lead d2d043f0) ----------

/** Longer than other notices (8 s): there's a choice to make in it. Swiping or ✕ closes it sooner. */
const SKIPPED_MS = 10_000
const NOTICE_MS = 8000
const REFUSAL_MS = 6000

/**
 * `Skipped · Undo`, and when there are to-dos, `Move to  Sat 11/21  Mon 11/23  Pick…` under it. A line the model wrote
 * has no day, so a notice for lines only has no row, and on a mix the row says how many to-dos move. Undo puts back
 * what this skip set aside (reopen: it refuses what was decided since, here or in another tab).
 */
function showSkipped(draft: DayDraft, ticket: DraftTicket): string {
  const day = todayIso(), n = ticket.itemIds.length, todos = Object.keys(ticket.seen).length
  const title = skippedNotice(n)
  const label = todos === n ? 'Move to' : todos === 1 ? 'Move the to-do to' : `Move ${todos} to-dos to`
  // The choices "Another day" offers, less Tomorrow: a plain ✕ already brings it back tomorrow.
  const days = anotherDayOptions(day).map(o => o.date).filter(d => d !== addDays(day, 1))
  let key = ''
  const move = (date: LocalDate) => { toast.close(key); void moveTo(draft, ticket, date) }
  const options = (timeout: number) => ({
    timeout,
    actionProps: { children: 'Undo', onPress: () => { toast.close(key); forget(ticket.itemIds); void draft.reopen(ticket).then(r => { if (r === 'refused') toast(draftWords.cantUndo, { timeout: REFUSAL_MS }) }) } },
    description: todos ? (
      <NoticeRow label={label}>
        {days.map(d => <Button key={d} size="sm" variant="ghost" className="toast-row-button" aria-label={`${label} ${noticeDate(d)}`} onPress={() => move(d)}>{shortLabel(d)}</Button>)}
        {/* The native picker can stay open a while: the notice waits for it instead of leaving under it. */}
        <Button size="sm" variant="ghost" className="toast-row-button" aria-label={`${label} another day`} onPress={e => { toast.update(key, title, options(0)); pickDate(addDays(day, 1), move, { at: e.target as Element }) }}>Pick…</Button>
      </NoticeRow>
    ) : undefined,
  })
  key = toast(title, options(SKIPPED_MS))
  noticeOf.set(ticket.skippedBy, key)
  return key
}

/** `Moved to Mon, Nov 23 · Undo`. Its Undo takes back only the move and brings the Skipped notice back, same ticket. */
async function moveTo(draft: DayDraft, ticket: DraftTicket, date: LocalDate) {
  const r = await draft.snooze(ticket, date)
  // A day that isn't later than this one is refused for that, not for a change elsewhere: say which.
  if (r.status === 'refused') { toast(/later day/i.test(r.reason ?? '') ? 'Not moved · pick a later day' : 'Not moved · changed elsewhere', { timeout: REFUSAL_MS }); return }
  // 'failed': nothing was stored, and the save bar already says so.
  if (r.status !== 'done') return
  const moved = r.moved.length, left = Object.keys(ticket.seen).length - moved
  const text = `${moved > 1 ? `Moved ${moved} to` : 'Moved to'} ${noticeDate(date)}${left > 0 ? ` · ${left} changed elsewhere` : ''}`
  const key: string = toast(text, {
    timeout: NOTICE_MS,
    actionProps: { children: 'Undo', onPress: () => { toast.close(key); void draft.undoMove(r.operationId).then(u => { if (u === 'done') showSkipped(draft, ticket); else if (u === 'refused') toast(draftWords.cantUndo, { timeout: REFUSAL_MS }) }) } },
  })
}

// ---------- Tap feedback §2: what he decided shows at once (docs/design/tap-feedback.md, Jazz 59fc33b8) ----------
//
// The decided look comes from the change stored on the device (`draft.decided`, read from the outbox), so a reload or
// a spell offline shows it the same (§2.6). What's kept here is only timing: when a skip was stored (its 1 s hold, then
// it closes), a decision still waiting to be stored (a working spinner if that takes long), and a refusal's 4 s note.

export type BandLook = 'open' | 'applied' | 'skipped' | 'closing' | 'working'
/** The tick's hold: a skipped band stays in place this long, so the next one doesn't slide under his finger. */
const SKIP_HOLD_MS = TICK_HOLD_MS
const CLOSE_MS = 150
const NOTE_MS = 4000
/** Not stored on the device by then (no store here, or his typing is being saved first): the band shows it's working. */
const WORKING_AFTER_MS = 200
/** `until`: a skip by the row's Another day (#377), with the day it moves to; the band says so through its hold. */
type Local = { kind: 'apply' | 'skip'; item: DraftItem; pageId: string; working: boolean; storedAt?: number; until?: LocalDate; height?: number }
const local = new Map<string, Local>()
type Note = { text: string; item: DraftItem; pageId: string; until: number }
const notes = new Map<string, Note>()
let appliedNotice: string | null = null
/** Each decision's own notice, by its operation, so a held one closes its own and no newer one. */
const noticeOf = new Map<string, string>()
/** Every item a band has shown, so a held one whose band is no longer offered can still say so in its place. */
const known = new Map<string, DraftItem>()
function settleHeld(held: DayDraft['held']) {
  for (const [id, h] of Object.entries(held)) {
    const key = noticeOf.get(h.operationId)
    if (key) { toast.close(key); noticeOf.delete(h.operationId); if (appliedNotice === key) appliedNotice = null }
    local.delete(id); notes.delete(id)
  }
  bump()
}
const later = (ms: number) => { setTimeout(bump, ms) }
/** His Undo of a skip: the band reopens now, from the stored reopen, not after its hold. */
const forget = (ids: string[]) => { for (const id of ids) local.delete(id); bump() }

function lookOf(id: string, decided: DayDraft['decided'], now: number): BandLook | null {
  const l = local.get(id)
  if (l?.working) return 'working'
  if (decided[id] === 'apply') return 'applied'
  // A skip stored before this page was shown (a reload) has had its hold: it's closed.
  const skippedAt = l?.kind === 'skip' && l.storedAt !== undefined ? l.storedAt : decided[id] === 'skip' ? 0 : undefined
  if (skippedAt === undefined) return 'open'
  const age = now - skippedAt
  return age < SKIP_HOLD_MS ? 'skipped' : age < SKIP_HOLD_MS + CLOSE_MS ? 'closing' : null
}

/** The page order bands were last shown in, so one kept through its hold stays in its place. */
const lastOrder = new Map<string, string[]>()
function bandsOf(pageId: string, items: DraftItem[], decided: DayDraft['decided'], held: DayDraft['held']): ShownBand[] {
  const now = Date.now(), out: ShownBand[] = [], seen = new Set<string>()
  for (const item of items) known.set(item.id, item)
  // Held: said for as long as it's held, not 4 s (Jazz 93fbd48f); a refusal's note lasts 4 s. A batch's rows say
  // nothing: they show as open again, and the draft line says it once (B109, Jazz e28c328e).
  const heldNote = (id: string) => held[id] && !held[id].batch ? (held[id].kind === 'apply' ? draftWords.notApplied : held[id].kind === 'move' ? 'Not moved · changed elsewhere' : draftWords.notSkipped) : undefined
  const noteOf = (id: string) => { const n = notes.get(id); return heldNote(id) || (n && n.until > now ? n.text : undefined) }
  for (const item of items) {
    seen.add(item.id)
    const look = lookOf(item.id, decided, now), note = noteOf(item.id)
    if (look || note) out.push({ item, look: look ?? 'gone', ...(note ? { note } : {}) })
  }
  // Skipped and already answered by the server: kept in place until its hold is over.
  for (const [id, l] of local) {
    if (l.pageId !== pageId || seen.has(id) || l.kind !== 'skip') continue
    const look = lookOf(id, decided, now)
    if (look === 'skipped' || look === 'closing') { seen.add(id); out.push({ item: l.item, look }) }
  }
  for (const [id, n] of notes) if (n.pageId === pageId && !seen.has(id) && n.until > now) { seen.add(id); out.push({ item: n.item, look: 'gone', note: n.text }) }
  for (const id of Object.keys(held)) { const item = known.get(id), note = heldNote(id); if (item && note && !seen.has(id)) out.push({ item, look: 'gone', note }) }
  const order = lastOrder.get(pageId) ?? [], at = (id: string) => { const i = order.indexOf(id); return i < 0 ? Infinity : i }
  const sorted = out.map((b, i) => ({ b, i })).sort((x, y) => (at(x.b.item.id) - at(y.b.item.id)) || x.i - y.i).map(x => x.b)
  // New items keep the order the draft gives them, after those already shown.
  // Kept whole, so a band that leaves for a moment (drawn as made from a kept change, then held) comes back in its place.
  lastOrder.set(pageId, [...order, ...sorted.map(b => b.item.id).filter(id => !order.includes(id))])
  return sorted
}

/** Still his to decide: offered, nothing stored or on its way for it (§2.5: Apply all and Dismiss act only on these). */
const undecided = (draft: DayDraft, ids: string[]) => ids.filter(id => draft.items.some(i => i.id === id) && !draft.decided[id] && !local.has(id))

function noteFor(items: DraftItem[], pageId: string, text: string) {
  const until = Date.now() + NOTE_MS
  for (const item of items) notes.set(item.id, { text, item, pageId, until })
  later(NOTE_MS + 20)
  bump()
}

/** `Applied · Undo` (§2.1.2): shown once the change is stored. A newer decision retires it: the workspace has one Undo. */
function showApplied(draft: DayDraft, n: number, operationId: string): string {
  if (appliedNotice) toast.close(appliedNotice)
  const key: string = toast(appliedWords(n), {
    timeout: NOTICE_MS,
    actionProps: { children: 'Undo', onPress: () => { toast.close(key); void draft.undoApply(operationId).then(u => { if (u === 'refused') toast(draftWords.cantUndo, { timeout: REFUSAL_MS }) }) } },
  })
  appliedNotice = key
  noticeOf.set(operationId, key)
  return key
}

/** Marks `items` as decided in this tab; past WORKING_AFTER_MS without being stored, they show they're working. */
function begin(kind: Local['kind'], items: DraftItem[], pageId: string, until?: LocalDate): { stored: () => void; done: () => void } {
  const heightOf = (id: string) => document.querySelector<HTMLElement>(`.draft-band[data-draft-item="${CSS.escape(id)}"]`)?.getBoundingClientRect().height
  for (const item of items) { local.set(item.id, { kind, item, pageId, working: false, ...(until ? { until, height: heightOf(item.id) } : {}) }); notes.delete(item.id) }
  if (choices && items.some(i => i.id === choices!.itemId) && !until) closeChoices()
  const timer = setTimeout(() => { for (const item of items) { const l = local.get(item.id); if (l && l.storedAt === undefined) l.working = true } bump() }, WORKING_AFTER_MS)
  return {
    stored: () => {
      clearTimeout(timer)
      const at = Date.now()
      for (const item of items) { const l = local.get(item.id); if (l) { l.working = false; l.storedAt = at } }
      if (kind === 'skip') {
        later(SKIP_HOLD_MS + CLOSE_MS + 20)
        // As it starts closing, focus held in it moves on, never left in markup about to go (sketch v2 §4).
        setTimeout(() => { handFocusOn(items.map(i => i.id)); bump() }, SKIP_HOLD_MS)
        setTimeout(() => { for (const item of items) if (local.get(item.id)?.storedAt === at) { local.delete(item.id); if (choices?.itemId === item.id) choices = null } bump() }, SKIP_HOLD_MS + CLOSE_MS + 40)
      }
      bump()
    },
    done: () => { clearTimeout(timer) },
  }
}

/** ✓ on one band, or Apply all (§2.1, §2.3). */
async function applyAndTell(draft: DayDraft, pageId: string, wanted: string[]) {
  const ids = undecided(draft, wanted)
  if (!ids.length) return
  const items = draft.items.filter(i => ids.includes(i.id))
  const mark = begin('apply', items, pageId)
  let key: string | null = null
  const r = await draft.apply(ids, editsFor(ids), { onStored: operationId => { mark.stored(); key = showApplied(draft, ids.length, operationId) } })
  mark.done()
  for (const item of items) if (local.get(item.id)?.kind === 'apply') local.delete(item.id)
  // Refused (decided elsewhere, no longer open): said on its own line for 4 s, where he pressed, and its notice closes
  // (§2.1.4). Held (the draft changed since): its note comes from the held change itself and stays until Keep mine or
  // Discard in the banner (Ratchet 0fd0406e, Jazz 93fbd48f). Never a silent roll back. Kept for later for lack of
  // network is neither: it keeps its look, and the banner says it's waiting.
  if (r.held && key) toast.close(key)
  const back = r.refused ? items : r.landed ? items.filter(i => r.dropped.includes(i.id)) : []
  if (back.length) {
    noteFor(back, pageId, draftWords.notApplied)
    if (key) toast.close(key)
    if (r.applied.length) showApplied(draft, r.applied.length, r.operationId)
  } else if (r.failed) noteFor(items, pageId, 'Not applied · try again')
  // Not stored here (no store on this device): it went as before, and its notice comes with the answer.
  else if (!r.stored && r.landed) showApplied(draft, r.applied.length, r.operationId)
  bump()
}

/** ✕ on one band, or Dismiss (§2.2, §2.4). */
async function skipAndTell(draft: DayDraft, pageId: string, wanted: string[]) {
  const ids = undecided(draft, wanted)
  if (!ids.length) return
  const items = draft.items.filter(i => ids.includes(i.id))
  const mark = begin('skip', items, pageId)
  let key: string | null = null, refused = false, held = false
  const ticket = await draft.skip(ids, {
    onStored: t => { mark.stored(); if (appliedNotice) toast.close(appliedNotice); key = showSkipped(draft, t) },
    onRefused: () => { refused = true },
    onHeld: () => { held = true },
  })
  mark.done()
  if (ticket) { if (key === null) { mark.stored(); showSkipped(draft, ticket) } }
  else if (held) { for (const item of items) local.delete(item.id); if (key) toast.close(key) }
  else if (refused || key === null) {
    // Stored and then refused, or never stored and not sent: the band comes back, saying why. Stored and kept for later
    // (offline) keeps its skipped look, and the outbox's banner says it's waiting.
    for (const item of items) local.delete(item.id)
    if (key) toast.close(key)
    noteFor(items, pageId, refused ? draftWords.notSkipped : 'Not skipped · try again')
  }
  bump()
}

// ---------- Another day on the row (#377, Jazz sketch v2, Lead 028d4a5e, Ratchet e60932f5) ----------

/** The one row whose day choices are open, on any page: opening another's, Esc, or deciding this row closes them. */
let choices: { itemId: string; pageId: string } | null = null
const closeChoices = () => { choices = null; bump() }

/** The days Another day offers: the notice's Move to choices (less Tomorrow, which ✕ already means), after the draft's day. */
const moveDays = (on: LocalDate): LocalDate[] => {
  const day = todayIso()
  return anotherDayOptions(day).map(o => o.date).filter(d => d !== addDays(day, 1) && d > on)
}

/** `Moved to Mon, Nov 30 · Undo`: one Undo takes back the skip and the move, before or after it has landed. */
function showMoved(draft: DayDraft, item: DraftItem, date: LocalDate, operationId: string): string {
  if (appliedNotice) toast.close(appliedNotice)
  const key: string = toast(`Moved to ${noticeDate(date)}`, {
    timeout: NOTICE_MS,
    actionProps: { children: 'Undo', onPress: () => { toast.close(key); forget([item.id]); void draft.undoApply(operationId).then(u => { if (u === 'refused') toast(draftWords.cantUndo, { timeout: REFUSAL_MS }) }) } },
  })
  // The workspace keeps one Undo: a newer decision's notice retires this one, as it does Applied's.
  appliedNotice = key
  noticeOf.set(operationId, key)
  return key
}

/**
 * A day picked in the row's choices: the band shows it decided at once (struck, "moved to …", the day marked), holds 1 s
 * and closes with its choices, as a ✕ does. Refused: it comes back open, if the draft still offers it, saying why for
 * 4 s. Held: the banner's Keep mine / Discard, and its note on the band. Stored and waiting (offline) keeps its look.
 */
async function moveAndTell(draft: DayDraft, pageId: string, item: DraftItem, date: LocalDate) {
  if (!undecided(draft, [item.id]).length) return
  const mark = begin('skip', [item], pageId, date)
  let key: string | null = null
  const r = await draft.move(item.id, date, { onStored: operationId => { mark.stored(); key = showMoved(draft, item, date, operationId) } })
  mark.done()
  if (r.landed) { if (key === null) { mark.stored(); showMoved(draft, item, date, r.operationId) } }
  else if (r.held) { local.delete(item.id); if (key) toast.close(key) }
  else if (r.refused || key === null) {
    local.delete(item.id)
    if (key) toast.close(key)
    if (choices?.itemId === item.id) choices = null
    noteFor([item], pageId, !r.refused ? 'Not moved · try again' : /later day/i.test(r.reason ?? '') ? 'Not moved · pick a later day' : 'Not moved · changed elsewhere')
  }
  bump()
}

const editorRoot = () => document.querySelector<HTMLElement>('.continuous-editor [contenteditable="true"]')
/** The caret at the end of a page block, in the editor: where focus goes when no draft control is left to take it. */
function caretAtEnd(blockId: string | null | undefined) {
  const root = editorRoot()
  if (!root) return
  const block = blockId ? root.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(blockId)}"] .bn-inline-content`) : null
  root.focus({ preventScroll: true })
  if (!block) return
  const range = document.createRange()
  range.selectNodeContents(block)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/**
 * Keyboard focus held in a band (or its choices) about to close goes on (sketch v2 §4, Ratchet e60932f5): the next
 * suggestion's ✓, else the one before, else the draft line's first button, else the editor at the end of the row above.
 */
function handFocusOn(ids: string[]) {
  const active = document.activeElement as HTMLElement | null
  const from = active?.closest<HTMLElement>('[data-draft-item], [data-draft-choices]')
  const id = from?.dataset.draftItem ?? from?.dataset.draftChoices
  if (!id || !ids.includes(id)) return
  const open = [...document.querySelectorAll<HTMLElement>('.draft-band[data-draft-item]')].filter(b => !ids.includes(b.dataset.draftItem!) && b.querySelector('.draft-acts:not(.is-working) button'))
  const after = open.find(b => from!.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  const before = [...open].reverse().find(b => from!.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING)
  const next = (after ?? before)?.querySelector<HTMLElement>('.draft-acts button') ?? document.querySelector<HTMLElement>('.draft-line button')
  if (next) next.focus({ preventScroll: true })
  else caretAtEnd(known.get(id)?.anchorId)
}

/** Under the band: `Move to  Sat 11/28  Mon 11/30  Pick…`. Decided: the day he picked stays marked, the rest fade. */
function DayChoices({ draft, item, on, title, until }: { draft: DayDraft; item: DraftItem; on: LocalDate; title: string; until?: LocalDate }) {
  const days = moveDays(on)
  const pick = (date: LocalDate) => { if (!until) void moveAndTell(draft, draft.pageId, item, date) }
  const back = () => document.querySelector<HTMLElement>(`[data-draft-item="${CSS.escape(item.id)}"] .draft-another`)?.focus()
  // Esc collapses the choices and focus goes back to Another day, while the row is still there.
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && !until) { e.preventDefault(); closeChoices(); requestAnimationFrame(back) } }
  return (
    <div className={`draft-days${until ? ' is-held' : ''}`} role="group" aria-label={`Move ${title} to`} data-draft-choices={item.id} onKeyDown={onKeyDown}>
      <span className="draft-days-label">Move to</span>
      {days.map(d => <button key={d} type="button" className={until === d ? 'is-chosen' : undefined} aria-label={`Move ${title} to ${noticeDate(d)}`} aria-disabled={until ? true : undefined} onClick={() => pick(d)}>{shortLabel(d)}</button>)}
      {/* The native picker: cancelling it stores nothing and the choices stay open. Focus goes back to Pick… only for a
          keyboard cancel, never on touch: on a phone a focused band button brings up the editor's toolbar (Jazz 5b6ce414). */}
      <button type="button" className={until && !days.includes(until) ? 'is-chosen' : undefined} aria-label={`Move ${title} to another day`} aria-disabled={until ? true : undefined}
        onClick={e => {
          if (until) return
          const self = e.currentTarget, fromKeys = e.detail === 0
          const keyboard = (by: 'key' | 'pointer' | 'other') => by === 'key' || (by === 'other' && fromKeys)
          pickDate(addDays(todayIso() > on ? todayIso() : on, 1), d => (d > on ? pick(d) : undefined), { at: self, onCancel: by => { if (keyboard(by) && self.isConnected && (!document.activeElement || document.activeElement === document.body)) self.focus({ preventScroll: true }) } })
        }}>Pick…</button>
    </div>
  )
}

// ---------- Held while he types (states §2 "Arrived while he's typing") ----------

/** The last keystroke in a page editor; suggestions that arrive within 3 s of one wait for Show or a 3 s pause. */
let lastKey = 0
const HOLD_MS = 3000
if (typeof document !== 'undefined') document.addEventListener('keydown', e => { if ((e.target as HTMLElement | null)?.closest?.('.continuous-editor')) lastKey = Date.now() }, true)
const revealed = new Map<string, boolean>()

/**
 * Whether the bands for this page show. They're held when they arrive while he is typing, and released by Show or a
 * 3 s pause; the release keeps the line he is looking at where it is.
 */
export function useDraftReveal(pageId: string, ready: boolean): { shown: boolean; show: () => void } {
  const [, force] = useState(0)
  const was = useRef(ready)
  if (!ready) revealed.delete(pageId)
  if (ready && !was.current && !revealed.has(pageId)) revealed.set(pageId, Date.now() - lastKey >= HOLD_MS)
  if (ready && !revealed.has(pageId)) revealed.set(pageId, true)
  was.current = ready
  const shown = !ready || revealed.get(pageId) === true
  const show = () => { keepView(() => { revealed.set(pageId, true); bump(); force(n => n + 1) }) }
  useEffect(() => {
    if (shown) return
    const timer = setInterval(() => { if (Date.now() - lastKey >= HOLD_MS) show() }, 500)
    return () => clearInterval(timer)
  })
  return { shown, show }
}

/** Runs `change` and scrolls so the line he's on (the caret's, else the first in view) stays at the same height. */
function keepView(change: () => void) {
  const blocks = [...document.querySelectorAll<HTMLElement>('.continuous-editor .bn-block-outer')]
  const node = window.getSelection()?.anchorNode
  const caret = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('.continuous-editor .bn-block-outer')
  const inView = (b: HTMLElement) => { const r = b.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight }
  const anchor = caret && inView(caret) ? caret : blocks.find(b => b.getBoundingClientRect().bottom > 0)
  const before = anchor?.getBoundingClientRect().top
  change()
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (anchor && before !== undefined && anchor.isConnected) window.scrollBy(0, anchor.getBoundingClientRect().top - before)
  }))
}

// ---------- The bands: one widget per anchor, React rendered into it through a portal ----------

/**
 * Typed edits per item (item ids are unique), shared by a band's own Apply and the line's Apply all, so his words
 * are what gets applied either way (Ratchet 425687c4). Kept outside React so a re-render doesn't lose them.
 */
const bandEdits = new Map<string, string>()
const editsFor = (ids: string[]) => Object.fromEntries(ids.filter(id => bandEdits.has(id)).map(id => [id, bandEdits.get(id)!]))

const key = new PluginKey<DecorationSet>('daythread-draft-bands')
/** `afterId`: the block the group follows; '' = the top of the page (Ratchet 11e83453). */
export type BandGroup = { afterId: string; host: HTMLElement }

function place(doc: PMNode, groups: BandGroup[]): DecorationSet {
  if (!groups.length) return DecorationSet.empty
  // '' = the top of the page (no heading above the planning part), inside its block group, as the Events rows do.
  const at = new Map<string, number>([['', 1]])
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockContainer' && node.attrs.id) at.set(String(node.attrs.id), pos + node.nodeSize)
    return true
  })
  const decos = groups.filter(g => at.has(g.afterId)).map(g => Decoration.widget(at.get(g.afterId)!, g.host, { key: `draft-${g.afterId}`, side: -1, ignoreSelection: true, stopEvent: () => true }))
  return DecorationSet.create(doc, decos)
}

/** `groups()` is read on every document change and when `refreshDraftBands` asks (the draft changed). */
export const draftBands = (groups: () => BandGroup[]) => createExtension({
  key: 'daythreadDraftBands',
  prosemirrorPlugins: [new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => place(state.doc, groups()),
      apply: (tr, old) => tr.docChanged || tr.getMeta(key) ? place(tr.doc, groups()) : old,
    },
    props: { decorations: state => key.getState(state) },
  })],
})
export const refreshDraftBands = (view: EditorView) => view.dispatch(view.state.tr.setMeta(key, true))

/** Hosts for the bands and the "more open" row, by anchor block id, kept across renders so the widgets stay put. */
export function useBandHosts() {
  const hosts = useRef(new Map<string, HTMLElement>())
  return useMemo(() => (id: string) => {
    let h = hosts.current.get(id)
    if (!h) {
      h = Object.assign(document.createElement('div'), { className: 'draft-host', contentEditable: 'false' })
      // The host sits inside the editor, so a tap on ✓, ✕, ＋ or "more open" would focus the editor and bring up his
      // phone's keyboard. Buttons never take focus from a press; a new to-do's editable text still does.
      h.addEventListener('mousedown', e => { if ((e.target as Element).closest('button')) e.preventDefault() })
      hosts.current.set(id, h)
    }
    return h
  }, [])
}

/** Groups items by anchor, in order, and adds the "more open" row's anchor. */
export function bandGroups(draft: DayDraft, shown: boolean, host: (id: string) => HTMLElement): (BandGroup & { items: ShownBand[]; more: boolean })[] {
  if (!shown || (draft.state !== 'ready' && draft.state !== 'failed' && draft.state !== 'offline')) return []
  const groups = new Map<string, ShownBand[]>()
  for (const band of draft.bands) groups.set(band.item.anchorId, [...(groups.get(band.item.anchorId) ?? []), band])
  const out = [...groups].map(([afterId, items]) => ({ afterId, host: host(afterId), items, more: false }))
  const end = draft.moreOpenAfterId ?? draft.planningEndId ?? ''
  if (draft.moreOpen.length) {
    const g = out.find(o => o.afterId === end)
    if (g) g.more = true
    else out.push({ afterId: end, host: host(end), items: [], more: true })
  }
  return out
}

/** Fill anchors: the empty template rows a band takes the place of, hidden while it shows. */
export const fillAnchors = (draft: DayDraft, shown: boolean) => shown ? draft.bands.filter(b => b.item.kind === 'fill').map(b => b.item.anchorId) : []

const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
const CrossIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
const PlusIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>

/** A carried to-do's task, if the band is one: it shows that task's current title (Bumblebee 21e0ae02). */
function carriedTask(item: DraftItem, workspace: Workspace) {
  const taskId = item.block.props?.taskId
  return typeof taskId === 'string' ? workspace.tasks.find(t => t.id === taskId) : undefined
}

function Band({ band, workspace, edits, draft, on, onApply, onSkip }: { band: ShownBand; workspace: Workspace; edits: Map<string, string>; draft: DayDraft; on: LocalDate | null; onApply: () => void; onSkip: () => void }) {
  const { item, look, note } = band
  const noteLine = note && <p className="draft-note" role="status">{note}</p>
  // Only a refusal's note is left where the band was (§2.1.4): one line's height, then it closes.
  if (look === 'gone') return <div className="draft-band-slot" data-draft-item={item.id}>{noteLine}</div>
  const task = carriedTask(item, workspace)
  const text = task ? task.title : (edits.get(item.id) || inlineText(item.block.content))
  const kind = item.block.type === 'task' ? 'task' : item.block.type === 'bulletListItem' ? 'bullet' : 'line'
  const decided = look !== 'open'
  // #377: a carried to-do skipped before says on which days, and offers Another day; not once it's applied.
  const skips = task && on && item.skipped?.length && look !== 'applied' ? skippedLabel(item.skipped, on) : null
  const until = local.get(item.id)?.until
  const open = Boolean(skips) && choices?.itemId === item.id && choices.pageId === draft.pageId
  const toggle = (e: MouseEvent) => {
    if (open) { closeChoices(); return }
    choices = { itemId: item.id, pageId: draft.pageId }
    bump()
    // From the keyboard (Enter, Space): focus goes to the first day.
    if (e.detail === 0) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-draft-choices="${CSS.escape(item.id)}"] button`)?.focus())
  }
  // Each part is unbreakable, and a line breaks between parts (after a dot), so the age and the days wrap whole (Jazz
  // 2cb3d6c2). Picked a day: line 2 says where it went, and Another day stays, faded, so the band keeps its height.
  const meta = skips && (
    <span className="draft-meta">
      {/* Not on a phone (Lead f056fda9): his titles wrap there, and the age made each labelled band ~120 px. */}
      {item.since && <span className="m-age"><span className="m-seg draft-since">{shortLabel(item.since)}</span><span className="m-dot"> · </span></span>}
      {until
        ? <span className="m-seg draft-moved">moved to {shortLabel(until)}</span>
        : <span className="m-seg draft-skips" title={skips.full}><span aria-hidden="true">{skips.text}</span><span className="sr-only">{skips.full}</span></span>}
      <span className="m-seg is-another"><span className="m-dot"> · </span><button type="button" className="draft-another" aria-expanded={open} disabled={decided} onClick={toggle}
        onKeyDown={e => { if (e.key === 'Escape' && open) { e.preventDefault(); closeChoices() } }}>Another day<span className="draft-chev" aria-hidden="true">▸</span></button></span>
    </span>
  )
  // Through the hold after a day is picked the band keeps the height it had, so nothing below moves under his finger.
  const keepHeight = until && (look === 'skipped' || look === 'working') ? local.get(item.id)?.height : undefined
  return (<>
    <div className={`draft-band is-${kind}${decided ? ` is-${look}` : ''}${skips ? ' has-skips' : ''}`} data-draft-item={item.id} {...(decided ? { 'data-decided': look } : {})} {...(keepHeight ? { style: { minHeight: keepHeight } } : {})}>
      {kind === 'task' && <span className="draft-box" aria-hidden="true" />}
      <span className="draft-main">
        {task || decided
          // Read-only (Lead, Ratchet, Bumblebee 22:12Z): applying plans the task as it is; he renames it on his own row.
          // Decided: his words are what was stored, so they stop being editable (§2.1.2).
          ? <span className="draft-text is-readonly">{text}</span>
          : <span className="draft-text" contentEditable suppressContentEditableWarning spellCheck={false}
            onInput={e => edits.set(item.id, (e.currentTarget.textContent ?? '').trim())}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); onApply() } }}>{text}</span>}
        {meta || (item.since && <span className="draft-since">{shortLabel(item.since)}</span>)}
      </span>
      {look === 'open' && <span className="draft-acts">
        <button type="button" aria-label={`Apply ${text}`} title="Apply" onClick={onApply}><CheckIcon /></button>
        <button type="button" aria-label={`Skip ${text}`} title="Skip" onClick={onSkip}><CrossIcon /></button>
      </span>}
      {/* Not stored on this device yet: working, in the place of ✓ ✕ (§2, store failure). */}
      {look === 'working' && <span className="draft-acts is-working" role="status" aria-label="Saving"><span className="draft-spin" aria-hidden="true" /></span>}
    </div>
    {skips && on && (until || (open && look === 'open')) && <DayChoices draft={draft} item={item} on={on} title={text} {...(until ? { until } : {})} />}
    {noteLine}
  </>)
}

function MoreOpen({ tasks, onAdd }: { tasks: OpenTask[]; onAdd: (taskId: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="draft-more">
      <button type="button" className="draft-more-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>{tasks.length} more open <span className="draft-chev" aria-hidden="true">▸</span></button>
      {open && tasks.map(t => (
        <div key={t.taskId} className="draft-band is-task is-open-row">
          <span className="draft-box" aria-hidden="true" />
          <span className="draft-main"><span className="draft-text">{t.title}</span><span className="draft-since">{shortLabel(t.since)}</span></span>
          <span className="draft-acts"><button type="button" aria-label={`Add ${t.title} to today`} title="Add to today" onClick={() => onAdd(t.taskId)}><PlusIcon /></button></span>
        </div>
      ))}
    </div>
  )
}

/** Everything the page editor renders for the draft: the bands in their hosts, and the style hiding filled anchors. */
export function DraftBands({ draft, workspace, groups, fills }: { draft: DayDraft; workspace: Workspace; groups: ReturnType<typeof bandGroups>; fills: string[] }): ReactNode {
  const edits = bandEdits
  // The draft's own day: skipped days are named from it, never from the device's clock (Lead 937ccf73).
  const on = workspace.pages.find(p => p.id === draft.pageId)?.date ?? null
  return <>
    {fills.length > 0 && <style>{fills.map(id => `.continuous-editor .bn-block-outer[data-id="${CSS.escape(id)}"]`).join(',')}{'{display:none}'}</style>}
    {groups.map(g => createPortal(<>
      {g.items.map(band => <Band key={band.item.id} band={band} workspace={workspace} edits={edits} draft={draft} on={on}
        onApply={() => void applyAndTell(draft, draft.pageId, [band.item.id])} onSkip={() => void skipAndTell(draft, draft.pageId, [band.item.id])} />)}
      {g.more && <MoreOpen tasks={draft.moreOpen} onAdd={id => void draft.addOpen(id)} />}
    </>, g.host, g.afterId))}
  </>
}

/** The one line under the title (states §1, §2). Nothing explains anything (Brian 1ac6784b). */
export function DraftLine({ page }: { page: Page }) {
  const draft = useDayDraft(page)
  const ready = draft.state === 'ready' || draft.state === 'failed' || draft.state === 'offline'
  const { shown, show } = useDraftReveal(page.id, ready && draft.items.length > 0)
  // Only what's still his to decide: a band decided, or on its way, isn't counted or decided again (§2.3, §2.5).
  const ids = undecided(draft, draft.items.map(i => i.id))
  const n = ids.length
  const all = (fn: 'apply' | 'skip') => keepView(() => void (fn === 'apply' ? applyAndTell(draft, page.id, ids) : skipAndTell(draft, page.id, ids)))
  if (draft.state === 'none') return null
  const words = draftLineWords(draft.state, n, n > 0 && !shown)
  if (words?.kind === 'preparing') return <p className="draft-line" role="status"><span className="draft-spin" aria-hidden="true" />{draftWords.preparing}</p>
  if (words?.kind === 'held') return <p className="draft-line" role="status">{draftWords.ready}<span className="sep"> · </span><button type="button" className="draft-primary" onClick={show}>{draftWords.show}</button></p>
  // A held Apply all or Dismiss is one decision: said once, here, until Keep mine or Discard (B109, Jazz e28c328e).
  const batches = new Set(Object.values(draft.held).filter(h => h.batch).map(h => h.kind))
  const heldLine = batches.size > 0 && <p className="draft-held" role="status">{[...batches].sort().map(k => k === 'apply' ? draftWords.notApplied : 'Not dismissed · changed elsewhere').join(' / ')}</p>
  const counts = words?.count && <span className="draft-seg">{words.count}<span className="sep"> · </span><button type="button" className="draft-primary" onClick={() => all('apply')}>{draftWords.applyAll}</button><span className="sep"> · </span><button type="button" onClick={() => all('skip')}>{draftWords.dismiss}</button></span>
  const tail = words?.failed ? <span className="draft-seg"><span className="draft-warn">{draftWords.failed}</span><span className="sep"> · </span><button type="button" onClick={() => draft.retry()}>{draftWords.retry}</button></span>
    : words?.offline ? <span className="draft-seg">{draftWords.offline}</span> : null
  if (!counts && !tail) return heldLine || null
  return <><p className="draft-line is-segs" role="status"><span className="draft-segs">{counts}{tail}</span></p>{heldLine}</>
}
