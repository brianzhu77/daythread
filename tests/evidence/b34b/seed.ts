// B34b fixture: yesterday's Top 3 holds A, B (with b1, and b1x under b1) and C; Other holds D. Dates are relative to
// today in Vancouver, so the morning card offers them. New disposable store only.
//   node tests/evidence/b34b/seed.ts /tmp/rb-b34b-<name>.sqlite
import { existsSync } from 'node:fs'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const path = process.argv[2]
if (!path?.startsWith('/tmp/rb-b34b-') || existsSync(path)) throw Error('A new /tmp/rb-b34b-* store is required')
const repo = new SqliteWorkspaceRepository(path)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
let n = 0
const run = async (action: Action) => (await repo.execute({ operationId: `b34b-seed-${++n}`, expectedRevision: (await repo.load()).revision, action })).workspace
let ws = await run({ type: 'ensure-day', date: yesterday })
const page = () => ws.pages.find(p => p.date === yesterday)!
const id: Record<string, string> = {}
for (const [title, kind] of [['A', 'top3'], ['B', 'top3'], ['b1', 'top3'], ['b1x', 'top3'], ['C', 'top3'], ['D', 'other']] as const) {
  ws = await run({ type: 'add-task', pageId: page().id, sectionId: page().sections.find(s => s.kind === kind)!.id, title, plannedOn: yesterday })
  id[title] = ws.tasks.at(-1)!.id
}
const doc = editorSeed(page(), ws), row = (t: string) => doc.find(x => x.props?.taskId === id[t])!
const nested: EditorNode[] = doc.filter(x => x !== row('b1') && x !== row('b1x')).map(x => x === row('B') ? { ...x, children: [{ ...row('b1'), children: [row('b1x')] }] } : x)
ws = await run({ type: 'save-editor', pageId: page().id, expectedContent: pageContentKey(page()), document: JSON.stringify(nested) })
console.log(JSON.stringify({ path, today, yesterday }))
