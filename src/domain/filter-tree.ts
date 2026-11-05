// Edits to a view's filter as a tree (filter-groups.md): the sheet works on the top group and its layers, and saves the view's fields.
import { filterLayers, type Condition, type FilterGroup } from './database.ts'

/** Which group: an index at each layer below the top. */
export type FilterPath = readonly number[]

export const atPath = (node: FilterGroup, path: FilterPath, edit: (group: FilterGroup) => FilterGroup): FilterGroup => {
  if (!path.length) return edit(node)
  return { ...node, groups: (node.groups ?? []).map((g, i) => (i === path[0] ? atPath(g, path.slice(1), edit) : g)) }
}
export const treeFields = (top: FilterGroup): { filter: Condition[]; filterAny: boolean; filterGroups: FilterGroup[] } => ({ filter: top.rules, filterAny: Boolean(top.any), filterGroups: top.groups ?? [] })
export const canHoldGroup = (path: FilterPath): boolean => path.length + 1 < filterLayers

const withGroups = (node: FilterGroup, groups: FilterGroup[]): FilterGroup => {
  const { groups: _gone, ...rest } = node
  return groups.length ? { ...rest, groups } : rest
}
/** A group never stands empty: taking its last rule takes the group, so there's nothing to tidy when the sheet closes. */
export const withoutRule = (top: FilterGroup, path: FilterPath, index: number): FilterGroup => {
  const inner = atPath(top, path, g => ({ ...g, rules: g.rules.filter((_, i) => i !== index) }))
  return dropEmpty(inner)
}
export const dropEmpty = (node: FilterGroup): FilterGroup => withGroups(node, (node.groups ?? []).map(dropEmpty).filter(g => g.rules.length || g.groups?.length))
export const addGroup = (node: FilterGroup, first: Condition): FilterGroup => withGroups(node, [...(node.groups ?? []), { rules: [first] }])
/** The rule goes into a group of its own, below the rules beside it. */
export const moveIntoNewGroup = (node: FilterGroup, index: number): FilterGroup => addGroup({ ...node, rules: node.rules.filter((_, i) => i !== index) }, node.rules[index]!)
/** In with the group beside it: a rule can't be given to a group it can't see, so one layer down is as far as it goes in one move. */
export const moveIntoGroup = (node: FilterGroup, index: number, group: number): FilterGroup => ({ ...node, rules: node.rules.filter((_, i) => i !== index), groups: (node.groups ?? []).map((g, i) => (i === group ? { ...g, rules: [...g.rules, node.rules[index]!] } : g)) })
/** Up one layer, taking the group with it if that was its last rule. */
export const moveOutOfGroup = (top: FilterGroup, path: FilterPath, index: number): FilterGroup => {
  const inner = path[path.length - 1]!, parent = path.slice(0, -1)
  return dropEmpty(atPath(top, parent, node => {
    const group = node.groups?.[inner]
    if (!group) return node
    return { ...node, rules: [...node.rules, group.rules[index]!], groups: node.groups!.map((g, i) => (i === inner ? { ...g, rules: g.rules.filter((_, j) => j !== index) } : g)) }
  }))
}
export const removeGroup = (node: FilterGroup, index: number): FilterGroup => withGroups(node, (node.groups ?? []).filter((_, i) => i !== index))
/** Its rules and groups join the layer it was in, which is one up, so they still fit. */
export const moveRulesOut = (node: FilterGroup, index: number): FilterGroup => {
  const group = node.groups?.[index]
  if (!group) return node
  return withGroups({ ...node, rules: [...node.rules, ...group.rules] }, (node.groups ?? []).flatMap((g, i) => (i === index ? group.groups ?? [] : [g])))
}
