// Moving lines in a page's tree (line-drag.ts on a phone): what's held lands before or after its target, as its siblings.
import type { EditorNode } from './editor-document.ts'

export type DropPlace = 'before' | 'after'

/**
 * The document with `moving` (in document order, each with its own children) taken out and put before or after `to`,
 * as its siblings. Null when nothing would move: a target inside what's held, or one that isn't there.
 */
export function moveInTree(doc: readonly EditorNode[], moving: readonly string[], to: { id: string; place: DropPlace }): EditorNode[] | null {
  const ids = new Set(moving)
  if (!ids.size || ids.has(to.id)) return null
  const held: EditorNode[] = []
  const strip = (list: readonly EditorNode[]): EditorNode[] => list.flatMap(n => {
    if (ids.has(n.id)) { held.push(n); return [] }
    return [n.children?.length ? { ...n, children: strip(n.children) } : n]
  })
  const rest = strip(doc)
  if (!held.length) return null
  let placed = false
  const put = (list: readonly EditorNode[]): EditorNode[] => list.flatMap(n => {
    const kept = n.children?.length ? { ...n, children: put(n.children) } : n
    if (n.id !== to.id) return [kept]
    placed = true
    return to.place === 'before' ? [...held, kept] : [kept, ...held]
  })
  const out = put(rest)
  return placed ? out : null
}
