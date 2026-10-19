import type { Page, Section, SectionKind, Workspace } from './types.ts'

/** The default content of a new day page, like a Notion template: each heading and the empty rows under it. */
export const dayTemplate: readonly { kind: SectionKind; title: string; rows: readonly ('task' | 'bullet')[] }[] = [
  { kind: 'top3', title: 'TODO - Top 3', rows: ['task'] },
  { kind: 'other', title: 'TODO - Other', rows: ['task'] },
  { kind: 'events', title: 'Events', rows: ['bullet'] },
  { kind: 'good-stuffs', title: 'Good Stuffs', rows: ['bullet'] },
  { kind: 'notes', title: 'Notes', rows: ['bullet'] },
]

export interface EditorNode {
  id: string
  type: string
  props?: Record<string, string | number | boolean>
  content?: unknown
  children?: EditorNode[]
}
export function inlineText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(c => typeof c === 'object' && c !== null ? ('text' in c ? String(c.text) : 'content' in c ? inlineText(c.content) : '') : '').join('')
}
export function pageContentKey(page: Page): string { return JSON.stringify([page.sections, page.editorJSON ?? null]) }
// Template rows are empty; a task row keeps the `editor-task:` draft identity, so no Task exists until it has text.
function templateRows(section: Section, page: Page): EditorNode[] {
  const rows = dayTemplate.find(t => t.kind === section.kind)?.rows ?? []
  return rows.map((row, i) => {
    const id = `${section.id}:template:${i}`
    return row === 'task'
      ? { id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate: page.date ?? '' }, content: '' }
      : { id, type: 'bulletListItem', content: '' }
  })
}
/**
 * A day page for today or later whose template rows have never been saved. Past pages open exactly as saved.
 * A page never opened in the editor (no editorJSON) gets the rows even if tasks were already placed on it,
 * e.g. kept from yesterday; a page saved before templates existed only gets them while all sections are empty.
 */
export function needsTemplateRows(page: Page, today: string): boolean {
  if (page.type !== 'daily' || page.templateApplied || !page.date || page.date < today) return false
  return !page.editorJSON || page.sections.every(s => s.blocks.length === 0)
}
export function editorSeed(page: Page, workspace: Workspace, options: { templateRows?: boolean } = {}): EditorNode[] {
  if (!options.templateRows && page.editorJSON && page.editorSections === JSON.stringify(page.sections)) return JSON.parse(page.editorJSON)
  const previous: EditorNode[] = page.editorJSON ? JSON.parse(page.editorJSON) : []
  const byId = new Map<string, EditorNode>()
  const remember = (node: EditorNode) => { byId.set(node.id, node); node.children?.forEach(remember) }
  previous.forEach(remember)
  const emitted = new Set<string>()
  const mark = (node: EditorNode) => { emitted.add(node.id); node.children?.forEach(mark) }
  const result: EditorNode[] = []
  for (const s of page.sections) {
    if (!s.id.startsWith('intro:')) {
      const heading = byId.get(s.id)
      const node = heading ? { ...heading, content: inlineText(heading.content) === s.title ? heading.content : s.title } : { id: s.id, type: 'heading', props: { level: 2 }, content: s.title }
      result.push(node); mark(node)
    }
    for (const b of s.blocks) {
      if (emitted.has(b.id)) continue
      const prior = byId.get(b.id)
      // A page card has no inline content; its title is read live from the page it points at.
      const node: EditorNode = prior?.type === 'pageLink' ? prior
        : prior ? { ...prior, content: inlineText(prior.content) === b.text ? prior.content : b.text }
        : b.taskId ? { id: b.id, type: 'task', props: { taskId: b.taskId, role: b.planRole ?? (s.kind === 'top3' || s.kind === 'other' ? 'plan' : 'reference'), planDate: page.date ?? '' }, content: workspace.tasks.find(t => t.id === b.taskId)?.title ?? b.text }
        : b.eventId ? { id: b.id, type: 'paragraph', content: workspace.events.find(e => e.id === b.eventId)?.title ?? b.text }
        : b.targetPageId ? { id: b.id, type: 'pageLink', props: { pageId: b.targetPageId } }
        : b.materialId ? { id: b.id, type: 'paragraph', content: [{ type: 'link', href: workspace.materials.find(m => m.id === b.materialId)?.url ?? '#', content: b.text }] }
        : { id: b.id, type: 'paragraph', content: b.text }
      result.push(node); mark(node)
    }
    if (options.templateRows) result.push(...templateRows(s, page))
  }
  return result
}
function isEmptyParagraph(node: EditorNode): boolean {
  return node.type === 'paragraph' && !inlineText(node.content).trim() && !node.children?.length
}
export function sectionRange(nodes: readonly EditorNode[], id: string): EditorNode[] {
  const start = nodes.findIndex(n => n.id === id)
  if (start < 0) return []
  const first = nodes[start]!
  if (first.type !== 'heading') return [first]
  let end = start + 1
  while (end < nodes.length && !(nodes[end]!.type === 'heading' && Number(nodes[end]!.props?.level ?? 1) <= Number(first.props?.level ?? 1))) end++
  return nodes.slice(start, end)
}
export function projectDocument(nodes: EditorNode[], page: Page, workspace: Workspace): Section[] {
  const ids = new Set<string>()
  const sections: Section[] = []
  const old = new Map([...Object.values(page.editorBlockMetadata ?? {}), ...page.sections.flatMap(s => s.blocks)].map(b => [b.id, b]))
  let current: Section | undefined
  function visit(node: EditorNode) {
    if (!node.id || ids.has(node.id)) throw new Error('Duplicate editor block identity')
    ids.add(node.id)
    if (node.type === 'heading') {
      current = { id: node.id, kind: page.sections.find(s => s.id === node.id)?.kind ?? 'custom', title: inlineText(node.content), blocks: [] }
      sections.push(current)
    } else {
      if (!current) { current = { id: `intro:${page.id}`, kind: 'custom', title: '', blocks: [] }; sections.push(current) }
      if (node.type === 'pageLink') {
        // pages-delta N-2: a page card is a reference. Removing it never touches the page it points at.
        const targetPageId = String(node.props?.pageId ?? '')
        current.blocks.push({ id: node.id, kind: 'reference', targetPageId, text: workspace.pages.find(p => p.id === targetPageId)?.title ?? '' })
      } else if (node.type === 'task') {
        const target = workspace.tasks.find(t => t.id === node.props?.taskId)
        if (!target && node.props?.taskId === `editor-task:${node.id}` && !inlineText(node.content)) { current.blocks.push({ id: node.id, kind: 'paragraph', text: '' }); return }
        if (!target) throw new Error('Task reference not found')
        const nextTitle = inlineText(node.content)
        const previous = old.get(node.id)
        if (previous && previous.text !== nextTitle) {
          if (target.title !== previous.text && target.title !== nextTitle) throw new Error('Task title changed elsewhere; editor draft kept')
          if (target.title !== nextTitle) { target.title = nextTitle; target.version++ }
        }
        current.blocks.push({ id: node.id, kind: 'task', taskId: target.id, text: nextTitle, planRole: node.props?.role === 'plan' ? 'plan' : 'reference' })
      } else {
        const prior = old.get(node.id)
        const value = inlineText(node.content)
        if (prior?.eventId && prior.text !== value) {
          const event = workspace.events.find(e => e.id === prior.eventId)
          if (event) {
            if (event.title !== prior.text && event.title !== value) throw new Error('Event changed elsewhere')
            event.title = value
          }
        }
        current.blocks.push({ ...prior, id: node.id, kind: prior?.kind ?? 'paragraph', text: value })
      }
    }
    node.children?.forEach(visit)
  }
  nodes.forEach(visit)
  return sections
}
