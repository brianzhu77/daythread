// A11 plan, rollback on Postgres (Lead 0942391a…/a0c0a578): data as the A11 build would write it, on a THROWAWAY
// schema, so the current build (the rollback build) can be run on it. Not for main.
import postgres from 'postgres'
import { postgresClient } from '../src/server/db/sql.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { editorSeed, needsTemplateRows, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'
const [url, schema] = process.argv.slice(2)
if (!schema?.startsWith('daythread_check')) { console.error('throwaway daythread_check* schema only'); process.exit(2) }
const sql = postgres(url!, { prepare: false, onnotice: () => {} })
const repo = new PostgresWorkspaceRepository(postgresClient(sql), schema)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const run = async (action: Action) => { const ws = await repo.load(); return (await repo.execute({ operationId: `exp:${crypto.randomUUID()}`, expectedRevision: ws.revision, action })).workspace }
let ws: Workspace = await run({ type: 'ensure-day', date: today })
ws = await run({ type: 'create-document', title: 'Target page', body: 'the line he links to' })
const target = ws.pages.find(p => p.title === 'Target page')!
const line = target.sections.flatMap(s => s.blocks).find(b => b.text === 'the line he links to')!
const day = ws.pages.find(p => p.type === 'daily' && p.date === today)!
ws = await run({ type: 'add-task', pageId: day.id, sectionId: day.sections[0]!.id, title: 'a task he links to' } as Action)
const task = ws.tasks.find(t => t.title === 'a task he links to')!
const dayNow = ws.pages.find(p => p.id === day.id)!
const doc = editorSeed(dayNow, ws, { templateRows: needsTemplateRows(dayNow, today) }) as EditorNode[]
const notes = doc.findIndex(n => n.id === dayNow.sections.find(s => s.kind === 'notes')!.id)
const link = (props: Record<string, string>) => ({ type: 'pageRef', props: { pageId: target.id, refId: crypto.randomUUID(), newTitle: '', ...props } })
doc.splice(notes + 1, 0,
  { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'line link: ', styles: {} }, link({ lineId: line.id })], children: [] } as unknown as EditorNode,
  { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'task link: ', styles: {} }, link({ pageId: day.id, lineId: dayNow.sections[0]!.blocks[0]!.id, taskId: task.id })], children: [] } as unknown as EditorNode)
ws = await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(dayNow), document: JSON.stringify(doc), today })
// The rest of what the A11 build adds lives only in the JSON document: a done day on tasks, a `seen` revision on
// retained line metadata, lineId/taskId on refs. Written here as the new build would, then left to the old build.
await sql.unsafe(`update ${schema}.workspace set data = (jsonb_set(jsonb_set(data::jsonb,
  '{tasks,0,doneOn}', to_jsonb($1::text)), '{pages,0,editorBlockMetadata}', coalesce(data::jsonb #> '{pages,0,editorBlockMetadata}', '{}'::jsonb) || jsonb_build_object('a11-probe', jsonb_build_object('id','a11-probe','kind','paragraph','text','probe','seen', 7))))::json where id = 1`, [today])
const saved = (await repo.load()).pages.find(p => p.id === day.id)!
console.log(JSON.stringify({ today, dayId: day.id, linesStored: (saved.editorJSON!.match(/"lineId"/g) ?? []).length, taskIdStored: saved.editorJSON!.includes('"taskId":"' + task.id), refs: saved.sections.flatMap(s => s.blocks).filter(b => b.refs?.length).map(b => b.refs!.map(r => r.pageId)) }))
await sql.end()
