import { useMemo, type CSSProperties } from 'react'
import { asTaskTree, taskAncestry, type TreeRow } from '../domain/task-tree'
import { useWorkspace } from './use-day'
import { TagText } from './tag-text'

/**
 * B28 (Jazz rule 3): a task list in outline order. A sub-task sits indented under its parent when both are listed;
 * otherwise a short "↳ parent" names the parent above its title.
 */
export function useTaskTree<T>(items: readonly T[], idOf: (item: T) => string): TreeRow<T>[] {
  const { workspace } = useWorkspace()
  return useMemo(() => (workspace ? asTaskTree(items, idOf, taskAncestry(workspace)) : items.map(item => ({ item, depth: 0, outsideParent: null }))), [workspace, items, idOf])
}

/** One step per level, the editor's nested indent (24 px). */
export const treeIndent = (depth: number): { style?: CSSProperties } => (depth ? { style: { '--tree-depth': depth } as CSSProperties } : {})

/** "↳ parent title" in --ink-3, above a sub-task's title when its parent isn't in the list. */
export function ParentLine({ parentId }: { parentId: string | null }) {
  const { workspace } = useWorkspace()
  const parent = parentId ? workspace?.tasks.find(t => t.id === parentId) : undefined
  if (!parent?.title.trim()) return null
  return <span className="task-parent">↳ <TagText text={parent.title} /></span>
}
