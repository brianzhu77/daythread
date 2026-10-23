// B33 notice fixture (Ratchet 164, Jazz 57dd5a4e): today a new to-do that also has a line on a document page, and a
// new to-do with two lines on today's page.   node tests/evidence/b33/notice-seed.ts <new sqlite path>
import { existsSync } from 'node:fs'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'
const path = process.argv[2]
if (!path || existsSync(path)) { console.error('Pass a new SQLite path'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true }); let n = 0
const run = async (action: Action): Promise<Workspace> => { const ws = await repo.load(); return (await repo.execute({ operationId: `b33n-${++n}`, expectedRevision: ws.revision, action })).workspace }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
let ws = await run({ type: 'ensure-day', date: today })
const day = () => ws.pages.find(p => p.date === today)!, top3 = () => day().sections.find(s => s.kind === 'top3')!.id
ws = await run({ type: 'add-task', pageId: day().id, sectionId: top3(), title: 'Also on Doc', plannedOn: today })
const shared = ws.tasks.at(-1)!
ws = await run({ type: 'add-task', pageId: day().id, sectionId: top3(), title: 'Twice here', plannedOn: today })
const twice = ws.tasks.at(-1)!
ws = await run({ type: 'create-document', title: 'Doc', body: '', pageId: 'doc' })
const doc = ws.pages.find(p => p.id === 'doc')!
ws = await run({ type: 'save-editor', pageId: 'doc', expectedContent: pageContentKey(doc), document: JSON.stringify([...editorSeed(doc, ws), { id: 'doc-row', type: 'task', props: { taskId: shared.id }, content: 'Also on Doc' }]) })
const d = editorSeed(day(), ws), at = d.findIndex(x => x.props?.taskId === twice.id)
ws = await run({ type: 'save-editor', pageId: day().id, expectedContent: pageContentKey(day()), document: JSON.stringify([...d.slice(0, at + 1), { id: 'twice-2', type: 'task', props: { taskId: twice.id, role: 'reference' }, content: 'Twice here' }, ...d.slice(at + 1)]), today })
console.log('seeded', today); process.exit(0)
