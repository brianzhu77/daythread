import { flatNodes, inlineText, pageNodes, rowTaskId, textDate, type EditorNode } from './editor-document.ts'
import { isTrashed } from './page-tree.ts'
import type { LocalDate, Workspace } from './types.ts'

// Tags are plain text: `#` (or full-width `＃`) followed by the tag characters below, ending at the first other
// character or the end of the line. Nothing is stored; every reader derives tags from the documents with the same rule.
export interface TagMatch { tag: string; start: number; end: number }
export interface TagOccurrence { pageId: string; blockId: string; date: LocalDate | null; pageTitle: string; sectionTitle: string; taskId?: string; text: string }
export interface TagEntry { key: string; tag: string; occurrences: TagOccurrence[] }

const isMark = (c: string | undefined) => c === '#' || c === '＃'
const isSpace = (c: string) => /\s/u.test(c)
// Obsidian's rule: Unicode letters, numbers, `_`, `-` and `/`. Combining marks stay with their letter.
const tagChar = /^[\p{L}\p{M}\p{N}_/-]$/u
const isTag = (tag: string) => /[\p{L}\p{N}]/u.test(tag) && !/^\p{Nd}+$/u.test(tag)
const inLink = (run: string) => /[a-z][a-z\d+.-]*:\/\/|www\./iu.test(run) || /^[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/|$)/iu.test(run.replace(/^[([<"']+/u, ''))
const endsLink = (c: string) => isSpace(c) || c > '~'

export function findTags(text: string): TagMatch[] {
  const found: TagMatch[] = []
  let linkStart = 0
  for (let i = 0; i < text.length; i++) {
    if (!isMark(text[i])) { if (endsLink(text[i]!)) linkStart = i + 1; continue }
    if (inLink(text.slice(linkStart, i))) continue
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
export const tagKey = (tag: string) => tag.normalize('NFKC').toLowerCase()

const textTypes = new Set(['paragraph', 'bulletListItem', 'numberedListItem', 'quote', 'checkListItem', 'task', 'sourceChecklist', 'toggleListItem', 'heading'])

/** Every tag on every line, most recently used first; each line counts once per tag. */
export function tagIndex(workspace: Workspace): TagEntry[] {
  const byKey = new Map<string, { tag: string; page: string; occurrences: TagOccurrence[] }>()
  const pages = workspace.pages.map((page, created) => ({ page, created })).filter(p => !isTrashed(p.page))
    .sort((a, b) => (b.page.date ?? '').localeCompare(a.page.date ?? '') || b.created - a.created).map(p => p.page)
  for (const page of pages) {
    let section = ''
    const visit = (node: EditorNode) => {
      if (node.type === 'heading') section = inlineText(node.content).trim()
      if (textTypes.has(node.type)) {
        const text = inlineText(node.content, textDate(page))
        const seen = new Set<string>()
        for (const { tag } of findTags(text)) {
          const key = tagKey(tag)
          const entry = byKey.get(key) ?? { tag, page: page.id, occurrences: [] }
          if (entry.page !== page.id) Object.assign(entry, { tag, page: page.id })
          byKey.set(key, entry)
          if (seen.has(key)) continue
          seen.add(key)
          entry.occurrences.push({ pageId: page.id, blockId: node.id, date: page.date, pageTitle: page.title, sectionTitle: section, taskId: rowTaskId(node) ?? undefined, text })
        }
      }
      node.children?.forEach(visit)
    }
    pageNodes(page).forEach(visit)
  }
  return [...byKey].map(([key, { tag, occurrences }]) => ({ key, tag, occurrences }))
    .sort((a, b) => (lastUsed(b) ?? '').localeCompare(lastUsed(a) ?? '') || b.occurrences.length - a.occurrences.length || a.key.localeCompare(b.key))
}
export function lastUsed(entry: TagEntry): LocalDate | null {
  return entry.occurrences[0]?.date ?? null
}
export { flatNodes }
