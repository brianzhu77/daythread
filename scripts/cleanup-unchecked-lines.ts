// B42 one-time cleanup (Lead): to-dos whose checkbox was removed before B42 left their tasks behind, and the page still
// records those lines as to-do rows (the projection kept the old row). Re-saving such a page with its document unchanged
// applies B42's rule now: a task born there is deleted (Undo restores it), nothing else on the page changes.
// Lists what each page's re-save would do; applies only when the deleted tasks are exactly the ids passed and no other
// task changes. Take a backup of the row first.
//   DAYTHREAD_STORAGE=postgres DATABASE_URL=... node scripts/cleanup-unchecked-lines.ts                 # list only
//   DAYTHREAD_STORAGE=postgres DATABASE_URL=... node scripts/cleanup-unchecked-lines.ts --apply <id> ...
import { getRepository } from '../src/server/storage.ts'
import { applyCommand } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Page, Workspace } from '../src/domain/types.ts'

const repository = getRepository()
let ws = await repository.load()
// Today, in his zone: a re-save of an earlier page never sends a task with history to Not today.
const today = new Date().toLocaleDateString('en-CA', { timeZone: ws.timezone })
const taskRows = (p: Page) => {
  const rows = new Map<string, string>()
  const walk = (list: EditorNode[]) => list.forEach(n => { if (n.type === 'task') rows.set(n.id, String(n.props?.taskId)); walk(n.children ?? []) })
  try { walk(JSON.parse(p.editorJSON ?? '[]')) } catch { /* not an editor page */ }
  return rows
}
/** Pages recording a to-do row whose line in the document is no longer that to-do. */
const stale = (w: Workspace) => w.pages.filter(p => p.editorJSON && !p.trashedAt && p.sections.some(s => s.blocks.some(b => b.kind === 'task' && b.taskId && taskRows(p).get(b.id) !== b.taskId)))
const resave = (w: Workspace, p: Page, operationId: string): { action: Action; after: Workspace } => {
  const action: Action = { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(editorSeed(p, w)), today }
  return { action, after: applyCommand(w, { operationId, expectedRevision: w.revision, action }).workspace }
}
const effect = (before: Workspace, after: Workspace) => ({
  deleted: before.tasks.filter(t => !after.tasks.some(x => x.id === t.id)).map(t => ({ id: t.id, title: t.title })),
  changed: after.tasks.filter(t => { const b = before.tasks.find(x => x.id === t.id); return b && JSON.stringify(b) !== JSON.stringify(t) }).map(t => ({ id: t.id, title: t.title })),
})

const plan = stale(ws).map(p => ({ page: p, ...effect(ws, resave(ws, p, `preview:${p.id}`).after) }))
const apply = process.argv.indexOf('--apply')
if (apply < 0) {
  console.log(`revision ${ws.revision}: ${plan.length} page${plan.length === 1 ? '' : 's'} with to-do rows that are no longer to-dos`)
  for (const x of plan) console.log(JSON.stringify({ page: x.page.date ?? x.page.title, deletes: x.deleted, alsoChanges: x.changed }))
  process.exit(0)
}
const ids = new Set(process.argv.slice(apply + 1))
const deleting = plan.flatMap(x => x.deleted.map(t => t.id)), changing = plan.flatMap(x => x.changed)
if (!ids.size || deleting.length !== ids.size || deleting.some(id => !ids.has(id)) || changing.length) {
  console.error(`Not applied: the re-saves would delete ${JSON.stringify(deleting)} and change ${JSON.stringify(changing.map(t => t.id))}; expected exactly ${JSON.stringify([...ids])}. Nothing changed.`)
  process.exit(1)
}
for (const { page } of plan) {
  const p = ws.pages.find(x => x.id === page.id)!, operationId = `cleanup-unchecked:${p.id}:${ws.revision}`
  const result = await repository.execute({ operationId, expectedRevision: ws.revision, action: resave(ws, p, operationId).action })
  console.log(`${p.date ?? p.title}: ${result.receipt.message} (revision ${ws.revision} → ${result.workspace.revision}); Undo targets ${operationId}`)
  ws = result.workspace
}
process.exit(0)
