import { writeFileSync } from 'node:fs'
import { applyCommand, createEmptyWorkspace } from '/Users/dogrod/Developer/daythread-dd/src/domain/workspace.ts'
import { pageContentKey, pageNodes } from '/Users/dogrod/Developer/daythread-dd/src/domain/editor-document.ts'
const today = process.argv[2]!, yesterday = process.argv[3]!
let ws = createEmptyWorkspace(); ws.timezone = 'America/Vancouver'
let n = 0
const run = (action: any) => { ws = applyCommand(ws, { operationId: `seed-${++n}`, expectedRevision: ws.revision, action }).workspace }
const t = (s: string) => ({ type: 'text', text: s, styles: {} })
const h = (id: string, s: string, level = 2) => ({ id, type: 'heading', props: { level }, content: [t(s)], children: [] })
const todo = (id: string, s: string) => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate: yesterday }, content: s ? [t(s)] : [], children: [] })
const slot = (id: string) => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'reference', planDate: '' }, content: [], children: [] })
const b = (id: string, s = '') => ({ id, type: 'bulletListItem', props: {}, content: s ? [t(s)] : [], children: [] })
const p = (id: string, s = '') => ({ id, type: 'paragraph', props: {}, content: s ? [t(s)] : [], children: [] })
const save = (id: string, doc: unknown[]) => { const pg = ws.pages.find(x => x.id === id)!; run({ type: 'save-editor', pageId: id, expectedContent: pageContentKey(pg), document: JSON.stringify(doc), today: yesterday }) }
run({ type: 'ensure-day', date: yesterday })
save(`day:${yesterday}`, [h('y1', 'TODO'), todo('a', 'Book the flights to Lisbon'), todo('c', 'Renew the passport'), h('y2', 'Notes'), b('n1', 'Tomorrow: start with the tax forms before email'), b('n2', 'Felt tired after 3pm')])
run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
save('tpl', [p('pl', 'Plan for today'), slot('s1'), p('nt', 'Notes'), b('nb')])
writeFileSync('/tmp/rb-dd/seed-nohead.json', JSON.stringify(ws))
console.log('seeded', ws.tasks.map(x => x.title))
