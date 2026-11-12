// Brian 3d7aca46, on a blank SQLite store with invented words: a day template, yesterday's page with an open to-do
// and a nested next-day list at its end, and today's page with the draft an older build made for it: ready, no recipe,
// one to-do applied. Opening today's page should make it again once, keeping that to-do and adding the next-day lines.
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=<blank store> node tests/evidence/day-draft-week/seed.ts <today>
import { getRepository } from '../../../src/server/storage.ts'
import { editorSeed, inlineText, pageContentKey, textRun, type EditorNode } from '../../../src/domain/editor-document.ts'
import { addDays } from '../../../src/domain/workspace.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const today = process.argv[2]
const path = process.env.DAYTHREAD_SQLITE_PATH
if (process.env.DAYTHREAD_STORAGE !== 'sqlite' || !path || path.includes('.daythread-local') || !/^\d{4}-\d{2}-\d{2}$/.test(today ?? '')) { console.error('Run on a blank SQLite store, with today\'s date.'); process.exit(2) }
const yesterday = addDays(today!, -1)
const repository = getRepository()
let ws: Workspace = await repository.load()
if (ws.pages.length) { console.error('The store is not blank.'); process.exit(2) }
const run = async (action: Action) => { ws = (await repository.execute({ operationId: `seed:${crypto.randomUUID()}`, expectedRevision: ws.revision, action })).workspace; return ws }
let n = 0
const id = () => `s${++n}`
const h = (t: string, level = 3): EditorNode => ({ id: id(), type: 'heading', props: { level }, content: [textRun(t)], children: [] })
const slot = (): EditorNode => { const i = id(); return { id: i, type: 'task', props: { taskId: `editor-task:${i}`, role: 'reference', planDate: '' }, content: [], children: [] } }
const b = (t: string, children: EditorNode[] = []): EditorNode => ({ id: id(), type: 'bulletListItem', props: {}, content: t ? [textRun(t)] : [], children })
const save = (pageId: string, edit: (d: EditorNode[]) => EditorNode[]) => {
  const p = ws.pages.find(x => x.id === pageId)!
  return run({ type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(structuredClone(editorSeed(p, ws)))), today: yesterday })
}
await run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
await save('tpl', () => [h('Morning Planning', 1), h('Top 3'), slot(), slot(), slot(), h('Other'), slot(), h('Notes', 1), b(''), h('Next day'), b('')])
await run({ type: 'ensure-day', date: yesterday })
await save(`day:${yesterday}`, d => {
  const out = [...d], first = out.findIndex(x => x.type === 'task')
  out[first] = { ...out[first]!, props: { ...out[first]!.props, role: 'plan', planDate: yesterday }, content: [textRun('Renew the parking permit')] }
  const next = out.findIndex(x => x.type === 'heading' && inlineText(x.content).trim() === 'Next day')
  out.splice(next + 1, 1, b('Book the venue visit'), b('Website', [b('Fix the broken footer link'), b('Swap the team photo')]))
  return out
})
await run({ type: 'ensure-day', date: today! })
const permit = ws.tasks.find(t => t.title === 'Renew the parking permit')!
await run({ type: 'set-draft', pageId: `day:${today}`, status: 'ready', moreOpen: [], allowedTaskIds: [permit.id], items: [{ id: 'old-1', anchor: '', place: 'after', taskId: permit.id, source: 'model', state: 'open' }] })
await run({ type: 'apply-draft', pageId: `day:${today}`, itemIds: ['old-1'], today: today! })
console.log(`seeded ${yesterday} and ${today}: ${ws.tasks.length} to-do, an older draft with 1 applied`)
