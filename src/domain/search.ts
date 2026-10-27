import { inlineText, pageNodes, rowTaskId, textDate, type EditorNode } from './editor-document.ts'
import { isTrashed, pageAncestors } from './page-tree.ts'
import { tagIndex, tagKey, type TagEntry } from './tags.ts'
import type { LocalDate, Page, Workspace } from './types.ts'

// Search (docs/design/search-states.md): a plain-text look over the loaded workspace. Nothing is stored or sent
// anywhere; the index is read from the pages like tags and links are, and rebuilt whenever the workspace changes.

/** A page whose title (or a day whose date) matches. */
export interface PageHit { page: Page; /** "Pages › Work" for a nested page, the day for a day's subpage; empty at the top. */ path: string }
/** A line whose words match. `text` is the task's current title for a to-do row. */
export interface LineHit { page: Page; blockId: string; date: LocalDate | null; sectionTitle: string; taskId: string | null; text: string }
export interface TagHit { key: string; tag: string; count: number }
export interface SearchResults {
  pages: PageHit[]
  tags: TagHit[]
  lines: LineHit[]
  /** Lines that matched beyond `lines` (the list stops at `lineLimit`). */
  moreLines: number
}

export const lineLimit = 50
export const pageLimit = 8
export const tagLimit = 5

interface IndexedLine { page: Page; blockId: string; sectionTitle: string; taskId: string | null; text: string; folded: string }
interface IndexedPage { page: Page; path: string; folded: string; /** Day pages: their date words ("sun, oct 18", "october 18, 2026", "2026-10-18"). */ dayWords: string }
export interface SearchIndex { pages: IndexedPage[]; lines: IndexedLine[]; tags: TagEntry[] }

/** Case, width and accents folded, so "Café" finds "cafe" and full-width letters find their ASCII twins. */
export const fold = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

// The same line types the tag index reads; headings are context (the section a line is in), never a hit of their own.
const lineTypes = new Set(['paragraph', 'bulletListItem', 'numberedListItem', 'quote', 'checkListItem', 'task', 'sourceChecklist', 'toggleListItem'])

const dayWords = (date: LocalDate): string => {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(y!, m! - 1, d!)
  const long = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const short = day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return fold(`${long} ${short} ${date}`)
}

/** "Pages › Work" for a nested page, the day for a day's subpage, "" for a top-level page or a day. */
export function pagePath(ws: Workspace, p: Page, dayLabel: (date: LocalDate) => string): string {
  if (p.type === 'daily') return ''
  const chain = pageAncestors(ws, p.id)
  if (chain.length === 0) return ''
  const labels = chain.map(x => x.type === 'daily' && x.date ? dayLabel(x.date) : x.title || 'Untitled')
  return [...(chain[0]?.type === 'daily' ? [] : ['Pages']), ...labels].join(' › ')
}

/**
 * Everything the search reads, once per workspace: live pages newest day first (documents after, newest first), each
 * page's lines in document order, and the tag index. The folded text is kept so each keystroke only compares.
 */
export function buildSearchIndex(ws: Workspace, dayLabel: (date: LocalDate) => string = date => date): SearchIndex {
  const tasks = new Map(ws.tasks.map(t => [t.id, t]))
  const pages = ws.pages.map((page, created) => ({ page, created })).filter(p => !isTrashed(p.page))
    .sort((a, b) => (b.page.date ?? '').localeCompare(a.page.date ?? '') || b.created - a.created).map(p => p.page)
  const indexedPages: IndexedPage[] = [], lines: IndexedLine[] = []
  for (const page of pages) {
    indexedPages.push({ page, path: pagePath(ws, page, dayLabel), folded: fold(`${page.title} ${page.url ?? ''}`), dayWords: page.type === 'daily' && page.date ? dayWords(page.date) : '' })
    let section = ''
    const visit = (node: EditorNode) => {
      if (node.type === 'heading') section = inlineText(node.content).trim()
      else if (lineTypes.has(node.type)) {
        const taskId = rowTaskId(node)
        const text = (taskId ? tasks.get(taskId)?.title : undefined) ?? inlineText(node.content, textDate(page))
        const trimmed = text.trim().replace(/\s+/g, ' ')
        if (trimmed) lines.push({ page, blockId: node.id, sectionTitle: section, taskId, text: trimmed, folded: fold(trimmed) })
      }
      node.children?.forEach(visit)
    }
    pageNodes(page).forEach(visit)
  }
  return { pages: indexedPages, lines, tags: tagIndex(ws) }
}

/** The words typed, folded; a `#word` keeps its mark so it can prefer tags, and matches lines by the word. */
export function queryTerms(query: string): string[] {
  return fold(query).split(/\s+/u).filter(Boolean)
}

const bare = (term: string) => term.replace(/^[#＃]/u, '')
const matchesAll = (folded: string, terms: readonly string[]) => terms.every(t => folded.includes(bare(t)))

/**
 * What matches `query`: pages by title (days by their date words, or "today" / "yesterday"), tags by name, lines by
 * every word typed (in any order, anywhere in the line). Pages whose title starts with the query come first; lines
 * keep the index's order, newest day first.
 */
export function search(index: SearchIndex, query: string, today: LocalDate, yesterday?: LocalDate): SearchResults {
  const terms = queryTerms(query)
  if (terms.length === 0) return { pages: [], tags: [], lines: [], moreLines: 0 }
  const q = terms.map(bare).join(' ')
  const relative = q === 'today' ? today : q === 'yesterday' && yesterday ? yesterday : null
  const pageHits = index.pages
    .map(p => {
      const words = p.page.type === 'daily' ? p.dayWords : p.folded
      const rank = relative && p.page.date === relative ? 0 : p.folded.startsWith(q) ? 1 : matchesAll(words, terms) ? 2 : -1
      return { p, rank }
    })
    .filter(x => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, pageLimit)
    .map(({ p }) => ({ page: p.page, path: p.path }))
  const tagQuery = tagKey(terms.map(bare).join(''))
  const tagHits = terms.length === 1 || terms.some(t => t !== bare(t))
    ? index.tags.filter(t => t.key.includes(tagQuery)).slice(0, tagLimit).map(t => ({ key: t.key, tag: t.tag, count: t.occurrences.length }))
    : []
  const lineHits: LineHit[] = []
  let moreLines = 0
  for (const line of index.lines) {
    if (!matchesAll(line.folded, terms)) continue
    if (lineHits.length < lineLimit) lineHits.push({ page: line.page, blockId: line.blockId, date: line.page.date, sectionTitle: line.sectionTitle, taskId: line.taskId, text: line.text })
    else moreLines++
  }
  return { pages: pageHits, tags: tagHits, lines: lineHits, moreLines }
}

/** Where each typed word sits in `text` (folded positions map one to one for the scripts this app writes), for bolding. */
export function matchRanges(text: string, query: string): { start: number; end: number }[] {
  const folded = fold(text)
  // Folding can change the length (a decomposed accent); then the positions wouldn't line up, so nothing is bolded.
  if (folded.length !== text.length) return []
  const ranges: { start: number; end: number }[] = []
  for (const term of queryTerms(query).map(bare)) {
    if (!term) continue
    let at = folded.indexOf(term)
    while (at >= 0) { ranges.push({ start: at, end: at + term.length }); at = folded.indexOf(term, at + term.length) }
  }
  ranges.sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const r of ranges) {
    const last = merged.at(-1)
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  return merged
}

/**
 * The part of a long line to show: the whole line when it fits in `max`, else a window around the first match with an
 * ellipsis on the cut sides, so the matched word is on screen rather than clipped off the end.
 */
export function snippet(text: string, query: string, max = 140): string {
  if ([...text].length <= max) return text
  const first = matchRanges(text, query)[0]
  if (!first || first.start < max * 0.6) return `${text.slice(0, max - 1).trimEnd()}…`
  const start = Math.max(0, first.start - Math.floor(max / 3))
  const head = text.slice(start, start + max - 2)
  return `…${head.trim()}${start + max - 2 < text.length ? '…' : ''}`
}
