// B27 rollback rehearsal on Postgres: loads a COPY of his rev-356 workspace JSON into a throwaway loopback Postgres
// schema, then writes the same `@date` chips as seed.ts through save-editor. Refuses any non-loopback database.
//   DAYTHREAD_STORAGE=postgres DATABASE_URL=postgres://…@127.0.0.1:…/… DAYTHREAD_PG_SCHEMA=<scratch> node tests/evidence/b27/pg-seed.ts <copy.json> <today>
import { readFileSync } from 'node:fs'
import { postgresSql } from '../../../src/server/storage.ts'
import { PostgresWorkspaceRepository, schemaName } from '../../../src/server/postgres-repository.ts'
import { editorSeed, needsTemplateRows, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const [json, today] = process.argv.slice(2)
const url = new URL(process.env.DATABASE_URL ?? 'x:')
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !json || !today) throw Error('Loopback DATABASE_URL, a copy of the workspace JSON and today only')
const sql = postgresSql(), repo = new PostgresWorkspaceRepository(sql), table = `${schemaName()}.workspace`
await repo.load()
const copy = JSON.parse(readFileSync(json, 'utf8')) as Workspace
await sql.query(`update ${table} set revision = $1, data = $2::text::json where id = 1`, [copy.revision, JSON.stringify(copy)])
const run = async (action: Action) => { const { revision } = await repo.load(); return (await repo.execute({ operationId: `b27-pg-seed:${crypto.randomUUID()}`, expectedRevision: revision, action })).workspace }
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const chip = (date: string, time = '') => ({ type: 'dateMention', props: { eventId: crypto.randomUUID(), date, time } })
async function write(day: string, lines: unknown[][]) {
  let ws = await run({ type: 'ensure-day', date: day })
  const page = ws.pages.find(p => p.type === 'daily' && p.date === day)!
  const nodes = editorSeed(page, ws, { templateRows: needsTemplateRows(page, today) }) as EditorNode[]
  const notes = page.sections.find(s => s.kind === 'notes')!.id
  let at = nodes.findIndex(n => n.id === notes) + 1
  while (at < nodes.length && nodes[at]!.type !== 'heading') at++
  nodes.splice(at, 0, ...lines.map(content => ({ id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content, children: [] }) as unknown as EditorNode))
  return run({ type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify(nodes) })
}
const prev = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
await write(prev(2), [[text('PAC Lunch '), chip('2026-11-20', '12:00')], [text('Dentist '), chip(today, '15:00')]])
await write(prev(1), [[text('Bake sale at school '), chip(today)], [text('Lunch with Kathy '), chip(today, '12:00')]])
const ws = await write(today, [[text('Call the plumber '), chip(today, '09:30')]])
console.log('schema', schemaName(), 'revision', ws.revision, 'undo', Boolean(ws.undo))
process.exit(0)
