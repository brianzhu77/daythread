// A11 rollback rerun on the candidate (plan §6, §8): the CANDIDATE build's own commands write A11 data to a THROWAWAY
// Postgres schema, then tests/evidence/a11-plan-pg/old-build.mjs runs the previous build on it.
//   node tests/evidence/a11/pg-rollback-seed.ts <postgres url> <daythread_check_* schema>
// Unlike scripts/exp-a11-pg-seed.ts (the plan's experiment, which wrote `doneOn` and `seen` by hand before A11
// existed), everything here goes through the A11 commands: task-status with `today` sets doneOn, save-editor stamps
// `seen` on task rows, and the links carry lineId/taskId.
import postgres from 'postgres'
import { postgresClient } from '../../../src/server/db/sql.ts'
import { PostgresWorkspaceRepository } from '../../../src/server/postgres-repository.ts'
import { editorSeed, needsTemplateRows, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const [url, schema] = process.argv.slice(2)
if (!url || !schema?.startsWith('daythread_check')) { console.error('A throwaway daythread_check* schema only.'); process.exit(2) }
const sql = postgres(url, { prepare: false, onnotice: () => {} })
const repo = new PostgresWorkspaceRepository(postgresClient(sql), schema)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const run = async (action: Action) => { const ws = await repo.load(); return (await repo.execute({ operationId: `a11-rollback:${crypto.randomUUID()}`, expectedRevision: ws.revision, action })).workspace }
const save = async (pageId: string, edit: (nodes: EditorNode[]) => EditorNode[]) => {
  const ws = await repo.load(), p = ws.pages.find(x => x.id === pageId)!
  return run({ type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws, { templateRows: needsTemplateRows(p, today) }))), today })
}

let ws: Workspace = await run({ type: 'ensure-day', date: today })
ws = await run({ type: 'create-document', title: 'Target page', body: 'the line he links to' })
const target = ws.pages.find(p => p.title === 'Target page')!
const line = target.sections.flatMap(s => s.blocks).find(b => b.text === 'the line he links to')!
const day = ws.pages.find(p => p.type === 'daily' && p.date === today)!
const other = day.sections.find(s => s.kind === 'other')!.id
ws = await run({ type: 'add-task', pageId: day.id, sectionId: other, title: 'a task he links to', plannedOn: today })
const task = ws.tasks.at(-1)!
ws = await run({ type: 'add-task', pageId: day.id, sectionId: other, title: 'a probe task', plannedOn: today })
const probe = ws.tasks.at(-1)!
const row = (id: string) => ws.pages.find(p => p.id === day.id)!.sections.flatMap(s => s.blocks).find(b => b.taskId === id)!.id
const taskRow = row(task.id), probeRow = row(probe.id)
// The links, on the day's Notes, saved by the editor path (this save also stamps `seen` on the day's task rows).
ws = await save(day.id, nodes => {
  const notes = nodes.findIndex(n => n.id === day.sections.find(s => s.kind === 'notes')!.id)
  const link = (props: Record<string, string>) => ({ type: 'pageRef', props: { pageId: target.id, refId: crypto.randomUUID(), newTitle: '', lineId: '', taskId: '', ...props } })
  return [...nodes.slice(0, notes + 1),
    { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'line link: ', styles: {} }, link({ lineId: line.id })], children: [] } as unknown as EditorNode,
    { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'task link: ', styles: {} }, link({ pageId: day.id, lineId: taskRow, taskId: task.id })], children: [] } as unknown as EditorNode,
    ...nodes.slice(notes + 1)]
})
// The probe row is removed by the editor: its metadata entry stays, with its `seen` (the "removed line" case).
ws = await save(day.id, nodes => nodes.filter(n => n.id !== probeRow))
// The day it's done, through the command the row's checkbox sends.
ws = await run({ type: 'task-status', taskId: task.id, status: 'done', today })

// Name the probe's entry as old-build.mjs reads it.
const cur = JSON.parse((await sql.unsafe(`select data::text as d from ${schema}.workspace`))[0]!.d) as Workspace
const meta = cur.pages.find(p => p.id === day.id)!.editorBlockMetadata!
const probeEntry = meta[probeRow]!
delete meta[probeRow]; meta['a11-probe'] = { ...probeEntry, id: 'a11-probe' }
await sql.unsafe(`update ${schema}.workspace set data = $1::text::json where id = 1`, [JSON.stringify(cur)])

const saved = await repo.load(), dayNow = saved.pages.find(p => p.id === day.id)!
console.log(JSON.stringify({
  today, dayId: day.id,
  lineIdsInDocument: (dayNow.editorJSON!.match(/"lineId":"[^"]+"/g) ?? []).length,
  refs: dayNow.sections.flatMap(s => s.blocks).flatMap(b => b.refs ?? []).map(r => [r.pageId, r.lineId ?? null, r.taskId ?? null]),
  doneOn: saved.tasks.find(t => t.id === task.id)!.doneOn,
  seenOnLiveTaskRow: dayNow.editorBlockMetadata?.[taskRow]?.seen ?? null,
  seenOnRemovedProbe: dayNow.editorBlockMetadata?.['a11-probe']?.seen ?? null,
}))
await sql.end()
