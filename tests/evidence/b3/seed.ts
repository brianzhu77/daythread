// B3 export fixture: today's page with a nested, partly done Top 3 and a styled note linking a page; two pages with
// the same CJK title, one with "/" and ":" in its title, and a trashed page. New disposable store only.
//   node tests/evidence/b3/seed.ts /tmp/rb-b3-<name>.sqlite
import { existsSync } from 'node:fs'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const path = process.argv[2]
if (!path?.startsWith('/tmp/rb-b3-') || existsSync(path)) throw Error('A new /tmp/rb-b3-* store is required')
const repo = new SqliteWorkspaceRepository(path)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
let n = 0
const run = async (action: Action) => (await repo.execute({ operationId: `b3-seed-${++n}`, expectedRevision: (await repo.load()).revision, action })).workspace
let ws = await run({ type: 'ensure-day', date: today })
const page = () => ws.pages.find(p => p.date === today)!
const cjk = '原生家庭创伤导致的讨好型人格如何解决？（是否强关联？）'
ws = await run({ type: 'create-document', title: cjk, body: '', pageId: 'cjk-1' })
ws = await run({ type: 'create-document', title: cjk, body: '', pageId: 'cjk-2' })
ws = await run({ type: 'create-document', title: 'Q4 plan: home/office', body: '', pageId: 'slash' })
ws = await run({ type: 'create-document', title: 'Trashed draft', body: '', pageId: 'gone' })
ws = await run({ type: 'delete-page', pageId: 'gone', at: new Date().toISOString() })
const top = page().sections.find(s => s.kind === 'top3')!.id, id: Record<string, string> = {}
for (const title of ['Rewind App PR', 'corridor', 'plaid']) { ws = await run({ type: 'add-task', pageId: page().id, sectionId: top, title, plannedOn: today }); id[title] = ws.tasks.at(-1)!.id }
ws = await run({ type: 'task-status', taskId: id.plaid!, status: 'done', today })
const doc = editorSeed(page(), ws), row = (t: string) => doc.find(x => x.props?.taskId === id[t])!
const notes = doc.findIndex(x => x.type === 'heading' && /notes/i.test(JSON.stringify(x.content)))
const t = (text: string, styles = {}) => ({ type: 'text', text, styles })
const note: EditorNode = { id: 'note-1', type: 'bulletListItem', props: {}, content: [t('Read '), t('slowly', { bold: true }), t(' · '), { type: 'pageRef', props: { pageId: 'cjk-2', refId: 'ref-1', newTitle: '', lineId: '', taskId: '' } }, t(' and '), { type: 'link', href: 'https://example.com/a', content: [t('a link', {})] }] as never, children: [{ id: 'note-2', type: 'checkListItem', props: { checked: true }, content: [t('nested tick')], children: [] }] }
const shaped = doc.filter(x => x !== row('Rewind App PR')).map(x => x === row('corridor') ? { ...x, children: [row('Rewind App PR')] } : x)
shaped.splice(shaped.findIndex(x => x.id === doc[notes]?.id) + 1, 0, note)
ws = await run({ type: 'save-editor', pageId: page().id, expectedContent: pageContentKey(page()), document: JSON.stringify(shaped) })
console.log(JSON.stringify({ path, today }))
