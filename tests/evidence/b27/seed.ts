// B27 spike: a disposable SQLite store from a COPY of his rev-356 workspace JSON, plus `@date` chips written the way
// the editor saves them (save-editor). Refuses any path outside /tmp/rb-b27/.
//   node tests/evidence/b27/seed.ts /tmp/rb-b47/ws-356.json /tmp/rb-b27/<name>.sqlite <today>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, needsTemplateRows, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const [json, db, today] = process.argv.slice(2)
if (!db?.startsWith('/tmp/rb-b27/') || !json || !today) throw Error('usage: seed.ts <copy.json> /tmp/rb-b27/<db> <today>')
const repo = new SqliteWorkspaceRepository(db, json)
const run = async (action: Action): Promise<Workspace> => {
  const { revision } = await repo.load()
  return (await repo.execute({ operationId: `b27-seed:${crypto.randomUUID()}`, expectedRevision: revision, action })).workspace
}
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const chip = (date: string, time = '') => ({ type: 'dateMention', props: { eventId: crypto.randomUUID(), date, time } })
/** Adds lines at the end of a day page's Notes section, through save-editor. */
async function write(day: string, lines: unknown[][]) {
  let ws = await run({ type: 'ensure-day', date: day })
  const page = ws.pages.find(p => p.type === 'daily' && p.date === day)!
  const nodes = editorSeed(page, ws, { templateRows: needsTemplateRows(page, today) }) as EditorNode[]
  const notes = page.sections.find(s => s.kind === 'notes')!.id
  let at = nodes.findIndex(n => n.id === notes) + 1
  while (at < nodes.length && nodes[at]!.type !== 'heading') at++
  nodes.splice(at, 0, ...lines.map(content => ({ id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content, children: [] }) as unknown as EditorNode))
  ws = await run({ type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify(nodes) })
  return ws
}
const prev = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
await write(prev(2), [[text('PAC Lunch '), chip('2026-11-20', '12:00')], [text('Dentist '), chip(today, '15:00')]])
await write(prev(1), [[text('Bake sale at school '), chip(today)]])
const ws = await write(today, [[text('Call the plumber '), chip(today, '09:30')]])
console.log('store', db, 'revision', ws.revision)
