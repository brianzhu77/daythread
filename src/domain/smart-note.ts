// Smart notes: a workspace-level record holds the prompt, the range and the model's result; a page holds only a `smartNote` block with `props.noteId`.
import { describeLine, flatNodes, inlineText, pageNodes, rowTaskId, smartNoteBlockType, textDate, textKey, textRun, type EditorNode } from './editor-document.ts'
import { isTrashed, subtreeIds } from './page-tree.ts'
import { isTemplate, untouchedDay } from './day-template.ts'
import { isDraft } from './day-draft.ts'
import { addDays, isDatabase, localWall } from './database.ts'
import { tagIndex, tagKey } from './tags.ts'
import type { LocalDate, Page, Task, Workspace } from './types.ts'

export { smartNoteBlockType }
export const smartLimits = { name: 120, prompt: 2000, pages: 50, tag: 100, notes: 100, blocks: 60, text: 600, sourcesPerBlock: 8, inputChars: 60_000, pageChars: 6_000, lineChars: 400 } as const
export type SmartWhere = { kind: 'workspace' } | { kind: 'pages'; pageIds: string[] } | { kind: 'tag'; tag: string } | { kind: 'days' }
/** 0: all time. */
export type SmartWindow = 0 | 7 | 30 | 90
export interface SmartRange { where: SmartWhere; days: SmartWindow }
/** `blockId`: a line's id, or `''` for the page itself (its title). */
export interface SmartSource { pageId: string; blockId: string }
export interface SmartBlock { kind: 'heading' | 'paragraph' | 'bullet'; text: string; sources: SmartSource[] }
export interface SmartResult { blocks: SmartBlock[]; at: string; inputKey: string; pagesRead: number; pagesLeftOut: number; from: LocalDate | null; to: LocalDate | null }
export interface SmartNote { id: string; name: string; prompt: string; range: SmartRange; refresh: 'manual' | 'daily' | 'hourly'; result: SmartResult }

/** What a result answers: the prompt and the range, a pages range in any order. A result is stored only under the spec it was made for. */
// A blank name's stand-in (Brian 5e7596ac): the prompt's first sentence when it fits, else a cut at a word with "…",
// at a character where the words are Chinese, Japanese or Korean, which have no spaces to cut at.
const nameRoom = 60
const sentenceEnd = /[.!?](?=\s|$)|[。！？]/u
const wideScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
export function smartNoteName(prompt: string): string {
  const line = prompt.trim().split('\n')[0].replace(/\s+/g, ' ').trim()
  const end = line.search(sentenceEnd)
  // A prompt that opens with its own full stop would leave nothing: then the line itself names it.
  const first = (end < 0 ? line : line.slice(0, end + 1)).replace(/[.。]$/u, '').trim() || line
  const chars = Array.from(first)
  if (chars.length <= nameRoom) return first
  const kept = chars.slice(0, nameRoom - 1)
  const space = kept.lastIndexOf(' ')
  const atWord = !wideScript.test(kept[kept.length - 1] + chars[nameRoom - 1]) && space >= nameRoom / 2
  return (atWord ? kept.slice(0, space) : kept).join('').replace(/[\s,;:，、；：—-]+$/u, '') + '…'
}

export function smartSpecKey(prompt: string, range: SmartRange): string {
  const { where } = range
  return textKey(JSON.stringify([prompt.trim(), where.kind, where.kind === 'pages' ? [...new Set(where.pageIds)].sort() : where.kind === 'tag' ? where.tag : null, range.days]))
}

export const smartNoteOf = (ws: Pick<Workspace, 'smartNotes'>, id: string): SmartNote | undefined => ws.smartNotes?.find(n => n.id === id)

/** Blocks showing the note on live pages (not in Trash). */
export function smartPlaces(ws: Pick<Workspace, 'pages'>, noteId: string): { page: Page; blockId: string }[] {
  return ws.pages.filter(p => !isTrashed(p)).flatMap(page => flatNodes(pageNodes(page)).filter(n => n.type === smartNoteBlockType && n.props?.noteId === noteId).map(n => ({ page, blockId: n.id })))
}

/** For the picker: notes with at least one place, by name. */
export function placedSmartNotes(ws: Pick<Workspace, 'pages' | 'smartNotes'>): { note: SmartNote; places: number }[] {
  return (ws.smartNotes ?? []).map(note => ({ note, places: smartPlaces(ws, note.id).length })).filter(p => p.places > 0).sort((a, b) => a.note.name.localeCompare(b.note.name))
}

/** The ids of notes with a block on some page, a page in Trash included: Restore brings its block back. */
export function heldSmartNoteIds(ws: Pick<Workspace, 'pages'>): Set<string> {
  const ids = new Set<string>()
  for (const page of ws.pages) for (const n of flatNodes(pageNodes(page))) if (n.type === smartNoteBlockType && typeof n.props?.noteId === 'string') ids.add(n.props.noteId)
  return ids
}

export interface SmartLine { alias: string; pageId: string; blockId: string; text: string }
export interface SmartInputPage { pageId: string; label: string; lines: SmartLine[] }
export interface SmartInput { pages: SmartInputPage[]; key: string; pagesRead: number; pagesLeftOut: number; from: LocalDate | null; to: LocalDate | null }

const unread = new Set([smartNoteBlockType, 'database', 'button', 'image', 'file', 'divider'])
const eligible = (p: Page) => !isTrashed(p) && !isTemplate(p) && !isDraft(p) && !isDatabase(p)

/** When the page was last written: its last edit, else its making (a new page, a clip not yet edited). */
const writtenAt = (p: Page) => p.editedAt ?? p.createdAt
/** A page's date: its own, else the day it was last written in the account's zone, else none. */
const dateOf = (ws: Workspace, p: Page): LocalDate | null => { const at = writtenAt(p); return p.date ?? (at ? localWall(at, ws.timezone).slice(0, 10) : null) }

/** A page to read; `blocks`: only these lines (a tag range: the tagged ones and what is nested under them), null: all. */
type Source = { page: Page; blocks: Set<string> | null }

function pagesInRange(ws: Workspace, where: SmartWhere): Source[] {
  const live = ws.pages.filter(eligible)
  if (where.kind === 'workspace') return live.map(page => ({ page, blocks: null }))
  if (where.kind === 'days') return live.filter(p => p.type === 'daily').map(page => ({ page, blocks: null }))
  if (where.kind === 'pages') {
    const ids = new Set(where.pageIds.flatMap(id => [...subtreeIds(ws, id)]))
    return live.filter(p => ids.has(p.id)).map(page => ({ page, blocks: null }))
  }
  const entry = where.tag.trim() ? tagIndex(ws).find(e => e.key === tagKey(where.tag)) : undefined
  const byPage = new Map<string, Set<string>>()
  for (const o of entry?.occurrences ?? []) {
    const page = live.find(p => p.id === o.pageId), node = page && flatNodes(pageNodes(page)).find(n => n.id === o.blockId)
    if (node) { const set = byPage.get(o.pageId) ?? new Set<string>(); flatNodes([node]).forEach(n => set.add(n.id)); byPage.set(o.pageId, set) }
  }
  return live.filter(p => byPage.has(p.id)).map(page => ({ page, blocks: byPage.get(page.id)! }))
}

/**
 * "Last N days" ends today for a day page: a day planned ahead is not in it. Any other page is dated by a time in the
 * account's zone, which can be a day ahead of the device's `today`, so it has no upper end.
 */
const inWindow = (ws: Workspace, p: Page, days: SmartWindow, today: LocalDate) => {
  if (days === 0) return true
  const date = dateOf(ws, p)
  return date !== null && date >= addDays(today, -days) && !(p.type === 'daily' && date > today)
}
const recency = (p: Page) => writtenAt(p) ?? (p.date ? `${p.date}T23:59` : '')

/** The page's readable lines, whole and in order, up to `pageChars`. */
function readLines(tasks: ReadonlyMap<string, Task>, { page, blocks }: Source): { blockId: string; text: string }[] {
  const date = textDate(page), out: { blockId: string; text: string }[] = []
  let total = 0
  for (const n of flatNodes(pageNodes(page))) {
    if ((blocks && !blocks.has(n.id)) || unread.has(n.type)) continue
    const taskId = rowTaskId(n), task = taskId ? tasks.get(taskId) : undefined
    if (!(task ? task.title : inlineText(n.content, date)).trim()) continue
    const text = cut(task ? todoLine(task) : describeLine(n, date))
    if (total + text.length > smartLimits.pageChars) break
    total += text.length
    out.push({ blockId: n.id, text })
  }
  return out
}
/** A to-do row reads from its task, as export does: the row's stored words can be older than a title changed on another page. */
const todoLine = (task: Task) => `${task.status === 'done' ? '[x]' : task.status === 'cancelled' ? '[-]' : '[ ]'} ${task.title.trim()}`
// One line each: a newline inside (a code block, a pasted clip) would otherwise read as an alias or a page label.
const cut = (text: string) => Array.from(text.replace(/\s*[\r\n]+\s*/g, ' ')).slice(0, smartLimits.lineChars).join('')

const weekday = (d: LocalDate) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const labelOf = (p: Page) => cut(p.type === 'daily' && p.date ? `${p.date} (${weekday(p.date)})` : `${p.title || 'Untitled'}${p.url ? ` (${p.url})` : ''}`)
/** A titled page with no readable line (a database row, a clip) reads as its label, citing the page itself; a day page does not. */
const titleLine = ({ page, blocks }: Source): { blockId: string; text: string }[] =>
  !blocks && page.type !== 'daily' && page.title.trim() ? [{ blockId: '', text: labelOf(page) }] : []

/** What a smart note reads for `range`: the lines of its pages, newest page first, within the size budget. */
export function collectInput(ws: Workspace, range: SmartRange, today: LocalDate): SmartInput {
  const tasks = new Map(ws.tasks.map(t => [t.id, t]))
  // A day opened and not written on holds only what every new day holds: reading it would change the input each morning.
  // A smart note placed there, and an empty line left or taken for it, aren't writing either: placing a note mustn't
  // make its own day start being read, which showed "Notes changed" right after Save (Jazz 01ec668c, Lead c1eac402).
  const untouched = untouchedDay(ws, n => n.type === smartNoteBlockType)
  const candidates = pagesInRange(ws, range.where)
    .filter(({ page }) => inWindow(ws, page, range.days, today) && !untouched(page))
    .sort((a, b) => { const x = recency(a.page), y = recency(b.page); return x < y ? 1 : x > y ? -1 : 0 })
    .map(pick => { const lines = readLines(tasks, pick); return { pick, lines: lines.length ? lines : titleLine(pick) } })
    .filter(c => c.lines.length > 0)
  const pages: SmartInputPage[] = [], dates: LocalDate[] = []
  let used = 0, alias = 0, full = false
  for (const { pick: { page }, lines } of candidates) {
    // The label is sent too, so it counts: a range of many short pages (database rows) is mostly labels.
    const label = labelOf(page), size = lines.reduce((n, l) => n + l.text.length, label.length)
    if (full || used + size > smartLimits.inputChars) { full = true; continue }
    used += size
    const date = dateOf(ws, page)
    if (date) dates.push(date)
    pages.push({ pageId: page.id, label, lines: lines.map(l => ({ alias: `L${++alias}`, pageId: page.id, blockId: l.blockId, text: l.text })) })
  }
  // By page id, not reading order: an edit that changes no line read (placing this note's own block) moves a page up.
  const key = textKey([...pages].sort((a, b) => a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0).flatMap(p => p.lines.map(l => `${l.pageId}|${l.blockId}|${l.text}`)).join('\n'))
  const sorted = [...dates].sort()
  return { pages, key, pagesRead: pages.length, pagesLeftOut: candidates.length - pages.length, from: sorted[0] ?? null, to: sorted.at(-1) ?? null }
}

/** A `pages` range with no live page left, or a `tag` range whose tag is in no live line. */
export function rangeGone(ws: Workspace, range: SmartRange): boolean {
  const { where } = range
  if (where.kind === 'pages') return !where.pageIds.some(id => ws.pages.some(p => p.id === id && !isTrashed(p)))
  if (where.kind === 'tag') return !where.tag.trim() || !tagIndex(ws).some(e => e.key === tagKey(where.tag))
  return false
}

/** The line a source points at, while its page is live and still holds it; a page source (`node: null`) while its page is live. */
export function sourceLine(ws: Pick<Workspace, 'pages'>, source: SmartSource): { page: Page; node: EditorNode | null } | null {
  const page = ws.pages.find(p => p.id === source.pageId && !isTrashed(p))
  if (!page) return null
  if (!source.blockId) return { page, node: null }
  const node = flatNodes(pageNodes(page)).find(n => n.id === source.blockId)
  return node ? { page, node } : null
}

const lineType = { heading: 'heading', paragraph: 'paragraph', bullet: 'bulletListItem' } as const

/** The note as ordinary lines: heading (level 3), paragraph, bulletListItem; each source a `pageRef` inline with `lineId` (and `taskId` when the line is a to-do row), a page source a page link. A source whose line is gone is left out. */
export function smartNoteLines(ws: Workspace, note: SmartNote, newId: () => string): EditorNode[] {
  return note.result.blocks.map((b): EditorNode => {
    const refs = b.sources.flatMap(s => {
      const line = sourceLine(ws, s)
      return line ? [textRun(' '), { type: 'pageRef', props: { pageId: s.pageId, refId: newId(), newTitle: '', lineId: s.blockId, taskId: (line.node && rowTaskId(line.node)) ?? '' } }] : []
    })
    return { id: newId(), type: lineType[b.kind], props: b.kind === 'heading' ? { level: 3 } : {}, content: [textRun(b.text), ...refs], children: [] }
  })
}

/** The note as plain text: `## ` headings, `- ` bullets, paragraphs; no sources. */
export function smartNoteText(note: SmartNote): string {
  return note.result.blocks.map((b, i) => {
    const line = b.kind === 'heading' ? `## ${b.text}` : b.kind === 'bullet' ? `- ${b.text}` : b.text
    return i === 0 ? line : `${b.kind === 'bullet' && note.result.blocks[i - 1]!.kind === 'bullet' ? '\n' : '\n\n'}${line}`
  }).join('')
}

/** The page of each source whose line is still in place, by `${pageId}|${blockId}`; each page's document read once. */
export function livePlaces(ws: Pick<Workspace, 'pages'>, result: SmartResult): Map<string, Page> {
  const lines = new Map<string, Set<string>>(), out = new Map<string, Page>()
  for (const s of result.blocks.flatMap(b => b.sources)) {
    const page = ws.pages.find(p => p.id === s.pageId && !isTrashed(p))
    if (!page) continue
    let ids = lines.get(page.id)
    if (!ids) { ids = new Set(flatNodes(pageNodes(page)).map(n => n.id)); lines.set(page.id, ids) }
    if (!s.blockId || ids.has(s.blockId)) out.set(`${s.pageId}|${s.blockId}`, page)
  }
  return out
}

/** Each distinct source's number, by first appearance. */
export function sourceNumbers(result: SmartResult): Map<string, number> {
  const numbers = new Map<string, number>()
  for (const s of result.blocks.flatMap(b => b.sources)) { const key = `${s.pageId}|${s.blockId}`; if (!numbers.has(key)) numbers.set(key, numbers.size + 1) }
  return numbers
}
