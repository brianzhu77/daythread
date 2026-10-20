// A copy of Brian's database for the A6b browser check: today's card not done and no draft yet, and two lines on the
// previous day (Oct 19 had none): one that names a day, one that doesn't.   node seed.ts <workspace.sqlite> <today>
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, inlineText, pageContentKey } from '../../../src/domain/editor-document.ts'
const [path, today] = process.argv.slice(2) as [string, string]
const repo = new SqliteWorkspaceRepository(path)
let ws = await repo.load()
const prev = ws.pages.filter(p => p.type === 'daily' && p.date! < today).sort((a, b) => b.date!.localeCompare(a.date!))[0]!
const doc = editorSeed(prev, ws), at = doc.findIndex(n => n.type === 'heading' && inlineText(n.content) === 'Notes')
const lines = [{ id: 'seed-1', type: 'paragraph', content: '明天给 Kevin 回电话' }, { id: 'seed-2', type: 'paragraph', content: '奥德赛 第二章' }]
await repo.execute({ operationId: 'seed-lines', expectedRevision: ws.revision, action: { type: 'save-editor', pageId: prev.id, expectedContent: pageContentKey(prev), document: JSON.stringify([...doc.slice(0, at + 1), ...lines, ...doc.slice(at + 1)]) } })
ws = await repo.load()
if (!ws.pages.some(p => p.date === today)) await repo.execute({ operationId: 'seed-day', expectedRevision: ws.revision, action: { type: 'ensure-day', date: today } })
const db = new DatabaseSync(path)
db.prepare("UPDATE pages SET handoffDone=0, draft=NULL, draftError=NULL, present=(SELECT json_group_array(value) FROM json_each(present) WHERE value NOT IN ('draftError')) WHERE snapshot='current' AND date=?").run(today)
db.close()
console.log(`seeded: lines on ${prev.date}, ${today} card open with no draft`)
