// Smart notes: a workspace-level record holds the prompt, the range and the model's result; a page holds only a `smartNote` block with `props.noteId`.
import { describeLine, flatNodes, inlineText, pageNodes, rowTaskId, taskOfRow, textDate, textKey, textRun, type EditorNode } from './editor-document.ts'
import { isTrashed, subtreeIds } from './page-tree.ts'
import { isTemplate } from './day-template.ts'
import { isDraft } from './day-draft.ts'
import { addDays, isDatabase, localWall } from './database.ts'
import { tagIndex, tagKey } from './tags.ts'
import type { LocalDate, Page, Workspace } from './types.ts'

export const smartNoteBlockType = 'smartNote'
export const smartLimits = { name: 120, prompt: 2000, pages: 50, tag: 100, notes: 100, blocks: 60, text: 600, sourcesPerBlock: 8, inputChars: 60_000, pageChars: 6_000, lineChars: 400 } as const
export type SmartWhere = { kind: 'workspace' } | { kind: 'pages'; pageIds: string[] } | { kind: 'tag'; tag: string } | { kind: 'days' }
/** 0: all time. */
export type SmartWindow = 0 | 7 | 30 | 90
export interface SmartRange { where: SmartWhere; days: SmartWindow }
export interface SmartSource { pageId: string; blockId: string }
export interface SmartBlock { kind: 'heading' | 'paragraph' | 'bullet'; text: string; sources: SmartSource[] }
export interface SmartResult { blocks: SmartBlock[]; at: string; inputKey: string; pagesRead: number; pagesLeftOut: number; from: LocalDate | null; to: LocalDate | null }
export interface SmartNote { id: string; name: string; prompt: string; range: SmartRange; refresh: 'manual' | 'daily' | 'hourly'; result: SmartResult }

export const smartNoteOf = (ws: Pick<Workspace, 'smartNotes'>, id: string): SmartNote | undefined => ws.smartNotes?.find(n => n.id === id)

/** Blocks showing the note on live pages (not in Trash). */
export function smartPlaces(ws: Pick<Workspace, 'pages'>, noteId: string): { page: Page; blockId: string }[] {
  return ws.pages.filter(p => !isTrashed(p)).flatMap(page => flatNodes(pageNodes(page)).filter(n => n.type === smartNoteBlockType && n.props?.noteId === noteId).map(n => ({ page, blockId: n.id })))
}

/** For the picker: notes with at least one place, by name. */
export function placedSmartNotes(ws: Pick<Workspace, 'pages' | 'smartNotes'>): { note: SmartNote; places: number }[] {
  return (ws.smartNotes ?? []).map(note => ({ note, places: smartPlaces(ws, note.id).length })).filter(p => p.places > 0).sort((a, b) => a.note.name.localeCompare(b.note.name))
}

export interface SmartLine { alias: string; pageId: string; blockId: string; text: string }
export interface SmartInputPage { pageId: string; label: string; lines: SmartLine[] }
export interface SmartInput { pages: SmartInputPage[]; key: string; pagesRead: number; pagesLeftOut: number; from: LocalDate | null; to: LocalDate | null }

const unread = new Set([smartNoteBlockType, 'database', 'button', 'image', 'file', 'divider'])
const eligible = (p: Page) => !isTrashed(p) && !isTemplate(p) && !isDraft(p) && !isDatabase(p)

/** A page's date: its own, else the day it was last edited in the account's zone, else none. */
const dateOf = (ws: Workspace, p: Page): LocalDate | null => p.date ?? (p.editedAt ? localWall(p.editedAt, ws.timezone).slice(0, 10) : null)

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

const inWindow = (date: LocalDate | null, days: SmartWindow, today: LocalDate) => days === 0 || (date !== null && date >= addDays(today, -days))
const recency = (ws: Workspace, p: Page) => p.editedAt ?? (p.date ? `${p.date}T23:59` : '')

/** The page's readable lines, whole and in order, up to `pageChars`. */
function readLines(ws: Workspace, { page, blocks }: Source): { blockId: string; text: string }[] {
  const date = textDate(page), out: { blockId: string; text: string }[] = []
  let total = 0
  for (const n of flatNodes(pageNodes(page))) {
    if ((blocks && !blocks.has(n.id)) || unread.has(n.type) || !inlineText(n.content, date).trim()) continue
    const text = Array.from(describeLine(n, date, isDone(ws, n))).slice(0, smartLimits.lineChars).join('')
    if (total + text.length > smartLimits.pageChars) break
    total += text.length
    out.push({ blockId: n.id, text })
  }
  return out
}
const isDone = (ws: Workspace, n: EditorNode) => taskOfRow(ws, n)?.status === 'done'

const weekday = (d: LocalDate) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const labelOf = (p: Page) => p.type === 'daily' && p.date ? `${p.date} (${weekday(p.date)})` : `${p.title || 'Untitled'}${p.url ? ` (${p.url})` : ''}`

/** What a smart note reads for `range`: the lines of its pages, newest page first, within the size budget. */
export function collectInput(ws: Workspace, range: SmartRange, today: LocalDate): SmartInput {
  const candidates = pagesInRange(ws, range.where)
    .filter(({ page }) => inWindow(dateOf(ws, page), range.days, today))
    .sort((a, b) => recency(ws, b.page).localeCompare(recency(ws, a.page)))
    .map(pick => ({ pick, lines: readLines(ws, pick) }))
    .filter(c => c.lines.length > 0)
  const pages: SmartInputPage[] = [], dates: LocalDate[] = []
  let used = 0, alias = 0, full = false
  for (const { pick: { page }, lines } of candidates) {
    const size = lines.reduce((n, l) => n + l.text.length, 0)
    if (full || used + size > smartLimits.inputChars) { full = true; continue }
    used += size
    const date = dateOf(ws, page)
    if (date) dates.push(date)
    pages.push({ pageId: page.id, label: labelOf(page), lines: lines.map(l => ({ alias: `L${++alias}`, pageId: page.id, blockId: l.blockId, text: l.text })) })
  }
  const key = textKey(pages.flatMap(p => p.lines.map(l => `${l.pageId}|${l.blockId}|${l.text}`)).join('\n'))
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

/** The line a source points at, while its page is live and still holds it. */
export function sourceLine(ws: Pick<Workspace, 'pages'>, source: SmartSource): { page: Page; node: EditorNode } | null {
  const page = ws.pages.find(p => p.id === source.pageId && !isTrashed(p))
  const node = page && flatNodes(pageNodes(page)).find(n => n.id === source.blockId)
  return page && node ? { page, node } : null
}

const lineType = { heading: 'heading', paragraph: 'paragraph', bullet: 'bulletListItem' } as const

/** The note as ordinary lines: heading (level 3), paragraph, bulletListItem; each source a `pageRef` inline with `lineId` (and `taskId` when the line is a to-do row). A source whose line is gone is left out. */
export function smartNoteLines(ws: Workspace, note: SmartNote, newId: () => string): EditorNode[] {
  return note.result.blocks.map((b): EditorNode => {
    const refs = b.sources.flatMap(s => {
      const line = sourceLine(ws, s)
      return line ? [textRun(' '), { type: 'pageRef', props: { pageId: s.pageId, refId: newId(), newTitle: '', lineId: s.blockId, taskId: rowTaskId(line.node) ?? '' } }] : []
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
    if (ids.has(s.blockId)) out.set(`${s.pageId}|${s.blockId}`, page)
  }
  return out
}

/** Each distinct source's number, by first appearance. */
export function sourceNumbers(result: SmartResult): Map<string, number> {
  const numbers = new Map<string, number>()
  for (const s of result.blocks.flatMap(b => b.sources)) { const key = `${s.pageId}|${s.blockId}`; if (!numbers.has(key)) numbers.set(key, numbers.size + 1) }
  return numbers
}
