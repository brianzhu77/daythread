// B28 fixture: today's Top 3 holds P (with c1, and c2 with g under it), Q, and R with c3 under it; R is then planned
// for tomorrow, so on today's lists c3's parent is elsewhere. New disposable store only.
//   node tests/evidence/b28/seed.ts /tmp/rb-b28-<name>.sqlite
import { existsSync } from 'node:fs'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const path = process.argv[2]
if (!path?.startsWith('/tmp/rb-b28-') || existsSync(path)) throw Error('A new /tmp/rb-b28-* store is required')
const repo = new SqliteWorkspaceRepository(path)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
let n = 0
const run = async (action: Action) => (await repo.execute({ operationId: `b28-seed-${++n}`, expectedRevision: (await repo.load()).revision, action })).workspace
let ws = await run({ type: 'ensure-day', date: today })
const page = () => ws.pages.find(p => p.date === today)!
const id: Record<string, string> = {}
for (const title of ['P', 'c1', 'c2', 'g', 'Q', 'R', 'c3']) {
  ws = await run({ type: 'add-task', pageId: page().id, sectionId: page().sections.find(s => s.kind === 'top3')!.id, title, plannedOn: today })
  id[title] = ws.tasks.at(-1)!.id
}
const flat: EditorNode[] = editorSeed(page(), ws), row = (t: string) => flat.find(x => x.props?.taskId === id[t])!
const nested = new Set(['c1', 'c2', 'g', 'c3'].map(t => row(t).id))
const shaped = flat.filter(x => !nested.has(x.id)).map(x => x === row('P') ? { ...x, children: [row('c1'), { ...row('c2'), children: [row('g')] }] } : x === row('R') ? { ...x, children: [row('c3')] } : x)
ws = await run({ type: 'save-editor', pageId: page().id, expectedContent: pageContentKey(page()), document: JSON.stringify(shaped) })
ws = await run({ type: 'plan-task', taskId: id.R!, date: tomorrow })
console.log(JSON.stringify({ path, today, tomorrow }))
