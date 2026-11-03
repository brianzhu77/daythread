// On a throwaway copy with seed-table.ts applied: a To-dos view on Books, and in the Day template with its own filter, for the
// alignment gate and the old-tab check. Usage: node tests/evidence/databases/todos-view-seed.ts <copy-store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
import { todosDatabase, todosSourceId } from '../../../src/domain/todos-source.ts'
import { defaultTemplate, dayPagesTarget } from '../../../src/domain/day-template.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/databases/todos-view-seed.ts <copy-store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2])
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const block = (id: string) => ({ id, type: 'database', props: { pageId: todosSourceId, view: linkedViewJson(todosDatabase.views[0]!) }, children: [] })
const books = ws.pages.find(p => p.id === 'books')!
await run({ type: 'save-editor', pageId: 'books', expectedContent: pageContentKey(books), document: JSON.stringify([...JSON.parse(books.document), block('td1')]) })
const template = defaultTemplate(ws, dayPagesTarget)
if (template) {
  const doc = JSON.parse(template.document) as { type: string }[], at = doc.findIndex(n => n.type === 'heading') + 1
  doc.splice(at, 0, block('td2'))
  await run({ type: 'save-editor', pageId: template.id, expectedContent: pageContentKey(template), document: JSON.stringify(doc) })
}
await run({ type: 'ensure-day', date: '2026-12-22' })
console.log('To-dos views added')
