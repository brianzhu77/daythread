// B42 fixture: today's Other holds a born-here to-do, "#daythread bug" with a nested born-here to-do under it, and a
// to-do carried from yesterday (history). New disposable store only.   node tests/evidence/b42/seed.ts /tmp/rb-b42-<n>.sqlite
import { existsSync } from 'node:fs'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const path = process.argv[2]
if (!path?.startsWith('/tmp/rb-b42-') || existsSync(path)) throw Error('A new /tmp/rb-b42-* store is required')
const repo = new SqliteWorkspaceRepository(path)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
let n = 0
const run = async (action: Action) => (await repo.execute({ operationId: `b42-seed-${++n}`, expectedRevision: (await repo.load()).revision, action })).workspace
let ws = await run({ type: 'ensure-day', date: yesterday })
const add = async (date: string, title: string) => { const p = ws.pages.find(x => x.date === date)!; ws = await run({ type: 'add-task', pageId: p.id, sectionId: p.sections.find(s => s.kind === 'other')!.id, title, plannedOn: date }); return ws.tasks.at(-1)!.id }
const carried = await add(yesterday, 'Carried from yesterday')
ws = await run({ type: 'ensure-day', date: today })
const born = await add(today, 'Delete task when I delete the checkbox')
const parent = await add(today, '#daythread bug')
const child = await add(today, 'read SEO information')
ws = await run({ type: 'plan-task', taskId: carried, date: today, section: 'other', from: yesterday, today })
const page = ws.pages.find(x => x.date === today)!, doc = editorSeed(page, ws), row = (id: string) => doc.find(x => x.props?.taskId === id)!
const shaped: EditorNode[] = doc.filter(x => x !== row(child)).map(x => x === row(parent) ? { ...x, children: [row(child)] } : x)
ws = await run({ type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify(shaped) })
console.log(JSON.stringify({ path, today, born, parent, child, carried }))
