import type { LocalDate, Workspace } from './types.ts'

// Tags are plain text Brian writes (#daythread:e36141c5): `#` (or full-width `＃`) followed by the tag characters
// below, ending at the first other character (so `#工作。` is the tag 工作) or the end of the block. Nothing is
// stored; every reader derives tags from the block text with the same rule, so the index can never disagree with
// what is on the page.
export interface TagMatch { tag: string; start: number; end: number }
export interface TagOccurrence { pageId: string; blockId: string; date: LocalDate | null; pageTitle: string; sectionTitle: string; taskId?: string; text: string }
export interface TagEntry { key: string; tag: string; occurrences: TagOccurrence[] }

const isMark = (c: string | undefined) => c === '#' || c === '＃'
const isSpace = (c: string) => /\s/u.test(c)
// Obsidian's rule, Brian's choice (#daythread:e36141c5 5b496134): a tag is Unicode letters, numbers, `_`, `-` and
// `/` (for nested names like #work/appx). Any other character ends it: whitespace, punctuation, symbols, emoji, `#`.
// Combining marks stay with their letter, so a decomposed é or Thai and Hindi words are not cut (Bumblebee 8cf3d2a0).
const tagChar = /^[\p{L}\p{M}\p{N}_/-]$/u
// A tag needs a letter or number (#_, #-, #/ are not tags) and can't be all decimal digits (#2026, #１２３ are plain
// text); #v1, #1on1, #1-2 and #① are tags.
const isTag = (tag: string) => /[\p{L}\p{N}]/u.test(tag) && !/^\p{Nd}+$/u.test(tag)
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
      if (!tagChar.test(char)) break
      end += char.length
    }
    const tag = text.slice(i + 1, end)
    if (isTag(tag)) found.push({ tag, start: i, end })
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
