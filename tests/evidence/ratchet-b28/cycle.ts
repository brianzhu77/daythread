import { applyCommand, createEmptyWorkspace } from '../../../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import { asTaskTree, taskAncestry } from '../../../src/domain/task-tree.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'
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

const s = setup()
for (const t of ['A','B']) s.add(t,yesterday)
s.nest(yesterday,{A:['B']})
s.run({type:'ensure-day',date:today})
for(const t of ['A','B']) s.run({type:'plan-task',taskId:s.id[t]!,date:today,section:'top3'})
s.nest(today,{B:['A']})
// Each task has a valid acyclic page tree; separate planned days select opposite relationships.
s.run({type:'plan-task',taskId:s.id.B!,date:yesterday,section:'top3'})
const ancestry=taskAncestry(s.ws)
const items=s.ws.tasks.filter(t=>t.status==='open')
console.log(JSON.stringify({input:items.map(t=>t.title),ancestry:[...ancestry].map(([id,a])=>[items.find(t=>t.id===id)?.title,a.parents.map(x=>items.find(t=>t.id===x)?.title)]),output:asTaskTree(items,t=>t.id,ancestry).map(r=>r.item.title)}))
