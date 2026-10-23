// B34a fixture: yesterday with a Top 3 task, an Other task and a task dragged from Other into Top 3, all unfinished.
//   node tests/evidence/b34a/seed.ts <new sqlite path>
import { existsSync } from 'node:fs'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const path = process.argv[2]
if (!path || existsSync(path)) { console.error('Pass a new SQLite path'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true }); let n = 0
const run = async (action: Action) => { const ws = await repo.load(); return (await repo.execute({ operationId: `b34a-${++n}`, expectedRevision: ws.revision, action })).workspace }
const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const yesterday = iso(new Date(Date.now() - 86_400_000))
let ws = await run({ type: 'ensure-day', date: yesterday })
const p = () => ws.pages.find(x => x.date === yesterday)!, sec = (k: string) => p().sections.find(s => s.kind === k)!.id
for (const [title, kind] of [['Carried top', 'top3'], ['Carried other', 'other'], ['Dragged up', 'other']] as const) ws = await run({ type: 'add-task', pageId: p().id, sectionId: sec(kind), title, plannedOn: yesterday })
const doc = editorSeed(p(), ws), row = doc.find(x => x.type === 'task' && x.content && JSON.stringify(x.content).includes('Dragged up'))!
const rest = doc.filter(x => x.id !== row.id), at = rest.findIndex(x => x.id === sec('top3'))
ws = await run({ type: 'save-editor', pageId: p().id, expectedContent: pageContentKey(p()), document: JSON.stringify([...rest.slice(0, at + 1), row, ...rest.slice(at + 1)]) })
console.log(`seeded ${yesterday}`); process.exit(0)
