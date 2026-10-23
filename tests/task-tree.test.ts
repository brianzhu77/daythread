import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { asTaskTree, taskAncestry } from '../src/domain/task-tree.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B28 (Jazz rule 3, Lead f3a6f170): Tasks and Review show a sub-task under its parent; the page documents are the record.
const yesterday = '2026-10-22', today = '2026-10-23'
function setup() {
  let ws: Workspace = createEmptyWorkspace(), n = 0
  const run = (action: Action) => { ws = applyCommand(ws, { operationId: `t-${++n}`, expectedRevision: ws.revision, action }).workspace; return ws }
  const page = (date: string) => ws.pages.find(p => p.date === date)!
  const id: Record<string, string> = {}
  const add = (title: string, date: string) => {
    run({ type: 'ensure-day', date })
    run({ type: 'add-task', pageId: page(date).id, sectionId: page(date).sections.find(s => s.kind === 'top3')!.id, title, plannedOn: date })
    id[title] = ws.tasks.at(-1)!.id
  }
  /** Nests rows on a day page: `{ parent: [children] }`, by task title. */
  const nest = (date: string, shape: Record<string, string[]>) => {
    const p = page(date), flat: EditorNode[] = []
    const flatten = (list: EditorNode[]) => list.forEach(x => { flat.push({ ...x, children: [] }); flatten(x.children ?? []) })
    flatten(editorSeed(p, ws))
    const titleOf = (x: EditorNode) => Object.keys(id).find(t => id[t] === x.props?.taskId) ?? ''
    const nested = new Set(Object.values(shape).flat())
    const build = (x: EditorNode): EditorNode => ({ ...x, children: (shape[titleOf(x)] ?? []).map(c => build(flat.find(y => titleOf(y) === c)!)) })
    run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(flat.filter(x => !nested.has(titleOf(x))).map(build)) })
  }
  return { run, page, id, add, nest, get ws() { return ws } }
}

test('a task\'s parents are the to-dos above its row, nearest first, at any depth', () => {
  const s = setup()
  for (const t of ['P', 'c', 'cc', 'Q']) s.add(t, today)
  s.nest(today, { P: ['c'], c: ['cc'] })
  const a = taskAncestry(s.ws)
  assert.deepEqual(a.get(s.id.cc!), [s.id.c, s.id.P])
  assert.deepEqual(a.get(s.id.c!), [s.id.P])
  assert.equal(a.has(s.id.P!), false)
  assert.equal(a.has(s.id.Q!), false)
})

test('the planned day\'s page wins over an older page that nests it differently', () => {
  const s = setup()
  for (const t of ['Old', 'New', 'c']) s.add(t, yesterday)
  s.nest(yesterday, { Old: ['c'] })
  s.run({ type: 'ensure-day', date: today })
  for (const t of ['New', 'c']) s.run({ type: 'plan-task', taskId: s.id[t]!, date: today, section: 'top3' })
  s.nest(today, { New: ['c'] })
  assert.deepEqual(taskAncestry(s.ws).get(s.id.c!), [s.id.New])
})

test('the list keeps its order; a listed parent takes its children right after it; an unlisted parent is named', () => {
  const ancestry = new Map([['c1', ['P']], ['c2', ['P']], ['g', ['c1', 'P']], ['orphan', ['Gone']]])
  const rows = asTaskTree(['A', 'c2', 'orphan', 'P', 'B', 'g', 'c1'], x => x, ancestry)
  assert.deepEqual(rows.map(r => `${'  '.repeat(r.depth)}${r.item}${r.outsideParent ? ` ↳${r.outsideParent}` : ''}`), ['A', 'orphan ↳Gone', 'P', '  c2', '  c1', '    g', 'B'])
})

test('a grandchild whose parent isn\'t listed goes under the nearest listed ancestor', () => {
  const rows = asTaskTree(['P', 'g'], x => x, new Map([['g', ['c', 'P']]]))
  assert.deepEqual(rows.map(r => [r.item, r.depth, r.outsideParent]), [['P', 0, null], ['g', 1, null]])
})
