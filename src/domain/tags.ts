import type { LocalDate, Workspace } from './types.ts'

// Tags are plain text Brian writes (#daythread:e36141c5): `#` (or full-width `＃`) followed by one or more
// characters, ending at whitespace, punctuation (so `#工作。` is the tag 工作), another `#`, or the end of the block. Nothing is stored; every reader derives tags from the
// block text with the same rule, so the index can never disagree with what is on the page.
export interface TagMatch { tag: string; start: number; end: number }
export interface TagOccurrence { pageId: string; blockId: string; date: LocalDate | null; pageTitle: string; sectionTitle: string; taskId?: string; text: string }
export interface TagEntry { key: string; tag: string; occurrences: TagOccurrence[] }

const isMark = (c: string | undefined) => c === '#' || c === '＃'
const isSpace = (c: string) => /\s/u.test(c)
// Whitespace and Unicode punctuation end a tag (Lead 7b1bc740), except `_`, `-` and `/` (for nested names like
// #work/appx). Everything else, emoji and symbols included, is tag text. `#` and `＃` are punctuation, so they end it.
const endsTag = (c: string) => /^[\s\p{P}]$/u.test(c) && !'_-/'.includes(c)
// The text before a `#` in the same word. A link's fragment (example.com/page#part) is not a tag; a domain needs a
// letters-only last part, so a version like v1.2#note still has a tag.
const urlPrefix = /^(?:[a-z][a-z\d+.-]*:\/\/|www\.|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/|$))/iu

export function findTags(text: string): TagMatch[] {
  const found: TagMatch[] = []
  let wordStart = 0
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text[i]!)) { wordStart = i + 1; continue }
    if (!isMark(text[i]) || urlPrefix.test(text.slice(wordStart, i))) continue
    let end = i + 1
    while (end < text.length) {
      const char = String.fromCodePoint(text.codePointAt(end)!)
      if (endsTag(char)) break
      end += char.length
    }
    if (end > i + 1) found.push({ tag: text.slice(i + 1, end), start: i, end })
    i = end - 1
  }
  return found
}

/** "Work", "work" and full-width "ｗｏｒｋ" are one tag. */
export const tagKey = (tag: string) => tag.normalize('NFKC').toLowerCase()

/** Every tag in paragraph and task blocks, most used first (then most recently used); each block counts once per tag. */
export function tagIndex(workspace: Workspace): TagEntry[] {
  const byKey = new Map<string, { tag: string; page: string; occurrences: TagOccurrence[] }>()
  const pages = [...workspace.pages].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  for (const page of pages) for (const section of page.sections) for (const block of section.blocks) {
    if (block.kind !== 'paragraph' && block.kind !== 'task') continue
    const seen = new Set<string>()
    for (const { tag } of findTags(block.text)) {
      const key = tagKey(tag)
      // Shown as written most recently (Jazz, b842c6d3): pages are read newest first, and on that newest page
      // a lower block counts as later, so the last form on the first page that has the tag wins.
      const entry = byKey.get(key) ?? { tag, page: page.id, occurrences: [] }
      if (entry.page === page.id) entry.tag = tag
      byKey.set(key, entry)
      if (seen.has(key)) continue
      seen.add(key)
      entry.occurrences.push({ pageId: page.id, blockId: block.id, date: page.date, pageTitle: page.title, sectionTitle: section.title, taskId: block.taskId, text: block.text })
    }
  }
  const latest = (t: TagEntry) => t.occurrences[0]?.date ?? ''
  return [...byKey].map(([key, { tag, occurrences }]) => ({ key, tag, occurrences }))
    .sort((a, b) => b.occurrences.length - a.occurrences.length || latest(b).localeCompare(latest(a)) || a.key.localeCompare(b.key))
}
