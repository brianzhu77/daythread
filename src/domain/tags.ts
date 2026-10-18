import type { LocalDate, Workspace } from './types.ts'

// Tags are plain text Brian writes (#daythread:e36141c5): `#` (or full-width `＃`) followed by one or more
// characters, ending at whitespace or the end of the block. Nothing is stored; every reader derives tags from the
// block text with the same rule, so the index can never disagree with what is on the page.
export interface TagMatch { tag: string; start: number; end: number }
export interface TagOccurrence { pageId: string; blockId: string; date: LocalDate | null; pageTitle: string; text: string }
export interface TagEntry { key: string; tag: string; occurrences: TagOccurrence[] }

const isMark = (c: string | undefined) => c === '#' || c === '＃'
const isSpace = (c: string) => /\s/u.test(c)
// The text before a `#` in the same word. A link's fragment (example.com/page#part) is not a tag.
const urlPrefix = /^(?:[a-z][a-z\d+.-]*:\/\/|www\.|[\w-]+(?:\.[\w-]+)+(?:\/|$))/iu

export function findTags(text: string): TagMatch[] {
  const found: TagMatch[] = []
  let wordStart = 0
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text[i]!)) { wordStart = i + 1; continue }
    if (!isMark(text[i]) || urlPrefix.test(text.slice(wordStart, i))) continue
    // Only whitespace ends a tag, so a later mark is part of it: "#工作#生活" is the one tag "工作#生活".
    let end = i + 1
    while (end < text.length && !isSpace(text[end]!)) end++
    if (end > i + 1) found.push({ tag: text.slice(i + 1, end), start: i, end })
    i = end - 1
  }
  return found
}

/** "Work", "work" and full-width "ｗｏｒｋ" are one tag. */
export const tagKey = (tag: string) => tag.normalize('NFKC').toLowerCase()

/** Every tag in paragraph and task blocks, most used first; each block counts once per tag. */
export function tagIndex(workspace: Workspace): TagEntry[] {
  const byKey = new Map<string, { tag: string; occurrences: TagOccurrence[] }>()
  const pages = [...workspace.pages].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  for (const page of pages) for (const section of page.sections) for (const block of section.blocks) {
    if (block.kind !== 'paragraph' && block.kind !== 'task') continue
    const seen = new Set<string>()
    for (const { tag } of findTags(block.text)) {
      const key = tagKey(tag)
      // Pages are read newest first, so the first form seen is the one Brian used most recently.
      const entry = byKey.get(key) ?? { tag, occurrences: [] }
      byKey.set(key, entry)
      if (seen.has(key)) continue
      seen.add(key)
      entry.occurrences.push({ pageId: page.id, blockId: block.id, date: page.date, pageTitle: page.title, text: block.text })
    }
  }
  return [...byKey].map(([key, entry]) => ({ key, ...entry })).sort((a, b) => b.occurrences.length - a.occurrences.length || a.key.localeCompare(b.key))
}
