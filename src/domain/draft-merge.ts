// B23 (docs/design/save-conflict-states.md §2): "Load latest" after a save conflict. The latest page wins, and his
// changes come back as ordinary lines below their lines, so nothing he typed is lost and nothing the other tab did
// is undone. His changes are measured against the page as it was when he started (the save's starting point), not
// against the latest, so a line only the other side changed is left alone.
import { inlineText, type EditorNode } from './editor-document.ts'

export interface DraftMerge {
  /** The latest page with his lines inserted. */
  document: EditorNode[]
  /** Ids of the lines that were inserted (or filled), in document order. */
  inserted: string[]
}

const walk = (nodes: EditorNode[], visit: (node: EditorNode, parent: EditorNode | null, index: number) => void, parent: EditorNode | null = null) =>
  nodes.forEach((node, index) => { visit(node, parent, index); walk(node.children ?? [], visit, node) })
const byId = (nodes: EditorNode[]) => { const map = new Map<string, EditorNode>(); walk(nodes, n => map.set(n.id, n)); return map }
/** What a line says: its kind and words, with links by target (a link's refId is identity, not wording). */
// A checklist line's tick is part of what it says (Ratchet #97).
const wording = (node: EditorNode) => JSON.stringify([node.type, node.type === 'heading' ? node.props?.level : null, node.content ?? null, node.type === 'pageLink' ? node.props?.pageId : null, node.type === 'sourceChecklist' ? Boolean(node.props?.checked) : null], (key, value) => (key === 'refId' ? undefined : value))
/** No words and nothing else inline: a line holding only a `[[` link is not empty (Ratchet #97). */
const isEmpty = (node: EditorNode) => node.type !== 'pageLink' && !inlineText(node.content).trim() && !(Array.isArray(node.content) && (node.content as { type?: string }[]).some(c => c?.type && c.type !== 'text'))
const withoutChildren = ({ children: _children, ...node }: EditorNode): EditorNode => ({ ...node, children: [] })
/** His text for a line that already exists: a line of the same kind, or a bullet for a task or heading (never a second task or a new section). */
function copyOf(node: EditorNode, newId: () => string): EditorNode {
  const content = Array.isArray(node.content)
    ? (node.content as { type?: string; props?: Record<string, unknown> }[]).map(c => (c?.type === 'pageRef' ? { ...c, props: { ...c.props, refId: newId() } } : c))
    : node.content
  // A bullet sits on the section's text column like every other line (Jazz: a plain paragraph read as a stray heading).
  const type = node.type === 'task' || node.type === 'heading' ? 'bulletListItem' : node.type
  return { id: newId(), type, props: type === node.type ? node.props : {}, content, children: [] }
}

/**
 * `base` is the page he started from, `draft` his editor, `latest` the page now. `knownTaskIds` are tasks that exist
 * on the server: a task row whose task doesn't exist yet is one he added in this draft and stays a task.
 */
export function mergeDraft(base: EditorNode[], draft: EditorNode[], latest: EditorNode[], knownTaskIds: ReadonlySet<string>, newId: () => string = () => crypto.randomUUID()): DraftMerge {
  const document: EditorNode[] = structuredClone(latest)
  const baseLines = byId(base), latestLines = byId(document)
  const inserted: string[] = []
  // Where to put a line: right after `afterId` among its siblings in the result, or at the end of the page.
  const insertAfter = (afterId: string | null, node: EditorNode) => {
    let placed = false
    if (afterId) walk(document, (n, parent, index) => {
      if (placed || n.id !== afterId) return
      ;(parent ? parent.children! : document).splice(index + 1, 0, node)
      placed = true
    })
    if (!placed) document.push(node)
    walk([node], n => latestLines.set(n.id, n))
  }
  // The id after which the next line of his goes: the latest line it follows, or the last line he got back.
  const anchorFor = new Map<string, string>()
  const handle = (node: EditorNode, previousId: string | null) => {
    const before = baseLines.get(node.id), now = latestLines.get(node.id)
    if (!before) {
      // A line he added. Kept with its id (no other page has it), and as a task when its task doesn't exist yet.
      if (now && wording(now) === wording(node)) return
      if (node.type === 'task' && knownTaskIds.has(String(node.props?.taskId ?? ''))) return // a task already on the server
      const line = withoutChildren(node)
      if (now) line.id = newId()
      if (line.type === 'task' && String(line.props?.taskId ?? '').startsWith('editor-task:')) line.props = { ...line.props, taskId: `editor-task:${line.id}` }
      insertAfter(previousId ? (anchorFor.get(previousId) ?? (latestLines.has(previousId) ? previousId : null)) : null, line)
      inserted.push(line.id); anchorFor.set(node.id, line.id)
      return
    }
    if (wording(before) === wording(node)) return // he didn't change it
    if (now && wording(now) === wording(node)) return // the other side made the same edit
    if (now && isEmpty(before) && isEmpty(now) && wording(before) === wording(now)) {
      // A line that was empty on both sides (a template row): his words go in place, with nothing below to repeat.
      now.content = structuredClone(node.content)
      if (now.type === 'task' && String(now.props?.taskId ?? '') === `editor-task:${now.id}`) now.props = { ...now.props, ...node.props, taskId: `editor-task:${now.id}` }
      inserted.push(now.id); anchorFor.set(node.id, now.id)
      return
    }
    if (node.type === 'sourceChecklist' && now && wording(now) === wording(before) && JSON.stringify(node.content) === JSON.stringify(before.content)) {
      // Only his tick changed, and the other side left the line alone: the tick goes in place, not as a second line (Jazz).
      now.props = { ...now.props, checked: Boolean(node.props?.checked) }
      inserted.push(now.id); anchorFor.set(node.id, now.id)
      return
    }
    if (node.type === 'task' && before.type === 'task' && inlineText(node.content) === inlineText(before.content)) return // only props moved
    // A task he started in this draft (its task doesn't exist yet) stays a task; an existing one comes back as text.
    const fresh = node.type === 'task' && !knownTaskIds.has(String(node.props?.taskId ?? ''))
    const line = fresh ? (() => { const id = newId(); return { ...withoutChildren(node), id, props: { ...node.props, taskId: `editor-task:${id}` } } })() : copyOf(node, newId)
    insertAfter(now ? node.id : null, line)
    inserted.push(line.id); anchorFor.set(node.id, line.id)
  }
  let previous: string | null = null
  walk(draft, node => { handle(node, previous); previous = node.id })
  const order = new Map<string, number>(); let i = 0; walk(document, n => order.set(n.id, i++))
  inserted.sort((a, b) => order.get(a)! - order.get(b)!)
  return { document, inserted }
}
