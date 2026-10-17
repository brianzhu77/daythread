import type { Page, Section, Workspace } from './types.ts'

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
export function editorSeed(page: Page, workspace: Workspace): EditorNode[] {
  if (page.editorJSON && page.editorSections === JSON.stringify(page.sections)) return JSON.parse(page.editorJSON)
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
      const node: EditorNode = prior ? { ...prior, content: inlineText(prior.content) === b.text ? prior.content : b.text }
        : b.taskId ? { id: b.id, type: 'task', props: { taskId: b.taskId, role: b.planRole ?? (s.kind === 'top3' || s.kind === 'other' ? 'plan' : 'reference') }, content: workspace.tasks.find(t => t.id === b.taskId)?.title ?? b.text }
        : b.eventId ? { id: b.id, type: 'paragraph', content: workspace.events.find(e => e.id === b.eventId)?.title ?? b.text }
        : b.materialId ? { id: b.id, type: 'paragraph', content: [{ type: 'link', href: workspace.materials.find(m => m.id === b.materialId)?.url ?? '#', content: b.text }] }
        : { id: b.id, type: 'paragraph', content: b.text }
      result.push(node); mark(node)
    }
  }
  return result
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
  const old = new Map(page.sections.flatMap(s => s.blocks).map(b => [b.id, b]))
  let current: Section | undefined
  function visit(node: EditorNode) {
    if (!node.id || ids.has(node.id)) throw new Error('Duplicate editor block identity')
    ids.add(node.id)
    if (node.type === 'heading') {
      current = { id: node.id, kind: page.sections.find(s => s.id === node.id)?.kind ?? 'custom', title: inlineText(node.content), blocks: [] }
      sections.push(current)
    } else {
      if (!current) { current = { id: `intro:${page.id}`, kind: 'custom', title: '', blocks: [] }; sections.push(current) }
      if (node.type === 'task') {
        const target = workspace.tasks.find(t => t.id === node.props?.taskId)
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
        current.blocks.push({ ...prior, id: node.id, kind: prior?.kind ?? 'paragraph', text: inlineText(node.content) })
      }
    }
    node.children?.forEach(visit)
  }
  nodes.forEach(visit)
  return sections
}
