import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, carrySection, createEmptyWorkspace } from '../../../src/domain/workspace.ts'
import { editorSeed, inlineText, needsTemplateRows, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

// B34b (Jazz rule 3, cb79b4f0): a carried sub-task lands under its parent when the parent comes too, at any depth and
// in source order; the nesting is on the page, so the next morning's carry still knows it (Ratchet second-day.ts).
const yesterday = '2026-10-22', today = '2026-10-23', tomorrow = '2026-10-24'
type Tree = Record<string, string[]>
/** On yesterday's Top 3 (or Other), as `{ parent: [children] }`; returns tasks by title and helpers. */
function setup(titles: string[], tree: Tree, kind: 'top3' | 'other' = 'top3') {
  let ws: Workspace = createEmptyWorkspace(), n = 0
  const run = (action: Action) => { ws = applyCommand(ws, { operationId: `n-${++n}`, expectedRevision: ws.revision, action }).workspace; return ws }
  const page = (date: string) => ws.pages.find(p => p.date === date)!
  run({ type: 'ensure-day', date: yesterday })
  const task: Record<string, string> = {}
  for (const title of titles) { run({ type: 'add-task', pageId: page(yesterday).id, sectionId: page(yesterday).sections.find(s => s.kind === kind)!.id, title, plannedOn: yesterday }); task[title] = ws.tasks.at(-1)!.id }
  nestOn(yesterday, tree)
  function nestOn(date: string, shape: Tree) {
    // Every line flat first, then nested as `shape` says.
    const p = page(date), doc: EditorNode[] = []
    const flatten = (list: EditorNode[]) => list.forEach(x => { doc.push({ ...x, children: [] }); flatten(x.children ?? []) })
    flatten(editorSeed(p, ws))
    const rowOf = (title: string) => doc.find(x => x.props?.taskId === task[title])!
    const nested = new Set(Object.values(shape).flat())
    const build = (node: EditorNode): EditorNode => {
      const title = Object.keys(task).find(t => task[t] === node.props?.taskId)
      return { ...node, children: title && shape[title] ? shape[title]!.map(c => build(rowOf(c))) : [] }
    }
    const top = doc.filter(x => !nested.has(Object.keys(task).find(t => task[t] === x.props?.taskId) ?? '')).map(build)
    run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(top) })
  }
  const item = (title: string, from = yesterday) => ({ taskId: task[title]!, section: carrySection(page(from), task[title]!) })
  /** The day's task rows as an indented outline, from the page's own editor document. */
  const outline = (date: string) => {
    const lines: string[] = []
    const walk = (list: EditorNode[], depth: number) => list.forEach(x => { if (x.type === 'task' || x.type === 'heading') lines.push(`${'  '.repeat(depth)}${x.type === 'heading' ? '#' : ''}${inlineText(x.content)}`); walk(x.children ?? [], depth + 1) })
    walk(editorSeed(page(date), ws), 0)
    return lines.filter(l => l.trim() !== '').filter(l => !l.startsWith('#') || /top|other|todo/i.test(l))
  }
  const rows = (date: string, k: string) => page(date).sections.filter(x => x.kind === k).flatMap(x => x.blocks).filter(x => x.kind === 'task').map(x => x.text)
  return { run, page, task, item, outline, rows, nestOn, get ws() { return ws } }
}
const plan = (s: ReturnType<typeof setup>, date: string, titles: string[], from = yesterday) => { s.run({ type: 'ensure-day', date }); for (const t of titles) s.run({ type: 'plan-tasks', date, items: [s.item(t, from)] }) }
const top3 = (outline: string[]) => outline.slice(outline.findIndex(l => /top 3/i.test(l)) + 1, outline.findIndex((l, i) => i > 0 && l.startsWith('#') && !/top 3/i.test(l)))


const s=setup(['P','c','X','Y'],{P:['c']});plan(s,today,['c','X','Y','P']);console.log(JSON.stringify({top:s.rows(today,'top3'),other:s.rows(today,'other'),outline:s.outline(today)}));assert.deepEqual(s.rows(today,'other'),[],'late parent must share its child slot, not overflow');
