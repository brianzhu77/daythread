// B70: templates through the Postgres row store on a throwaway database (schema daythread_b70_check, dropped after).
// DATABASE_TEST_URL=postgres://postgres:postgres@127.0.0.1:54888/postgres node tests/evidence/b70-templates/postgres-roundtrip.ts
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { PostgresWorkspaceRepository } from '../../../src/server/postgres-repository.ts'
import { postgresClient } from '../../../src/server/db/sql.ts'
import { pageContentKey, pageNodes, inlineText } from '../../../src/domain/editor-document.ts'
import { defaultTemplate, dayPagesTarget } from '../../../src/domain/day-template.ts'
import type { Action } from '../../../src/domain/types.ts'

const url = process.env.DATABASE_TEST_URL
if (!url || !/127\.0\.0\.1|localhost/.test(url)) throw new Error('DATABASE_TEST_URL must point at a local throwaway Postgres')
const schema = 'daythread_b70_check'
const sql = postgres(url, { prepare: false, max: 2, onnotice: () => {} })
let n = 0
const fresh = () => new PostgresWorkspaceRepository(postgresClient(sql), schema)
const run = async (action: Action) => {
  const repo = fresh()
  const ws = await repo.load()
  return repo.execute({ operationId: `b70-${++n}`, expectedRevision: ws.revision, action })
}
try {
  await sql.unsafe(`drop schema if exists ${schema} cascade`)
  await run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  let ws = await fresh().load()
  const t = ws.pages.find(p => p.id === 'tpl')!
  assert.equal(t.type, 'template'); assert.equal(t.parentId, 'days'); assert.equal(defaultTemplate(ws, dayPagesTarget)?.id, 'tpl')
  const doc = [{ id: 'h', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Plan', styles: {} }], children: [] },
    { id: 't', type: 'task', props: { taskId: 'editor-task:t', role: 'reference', planDate: '' }, content: [{ type: 'text', text: 'Water plants', styles: {} }], children: [] },
    { id: 'p', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Gym?', styles: {} }], children: [] }]
  await run({ type: 'save-editor', pageId: 'tpl', expectedContent: pageContentKey(t), document: JSON.stringify(doc), today: '2026-10-31' })
  ws = await fresh().load()
  assert.equal(ws.tasks.length, 0, 'template save made no task')
  await run({ type: 'ensure-day', date: '2026-11-01' })
  ws = await fresh().load()
  const day = ws.pages.find(p => p.id === 'day:2026-11-01')!
  const words = pageNodes(day).map(n => [n.type, inlineText(n.content)])
  assert.deepEqual(words, [['heading', 'Plan'], ['task', ''], ['paragraph', 'Gym?']])
  assert.ok(pageNodes(day).every(n => !['h', 't', 'p'].includes(n.id)), 'fresh ids')
  // Default moved to None, then Undo gives it back, across reloads.
  const cleared = await run({ type: 'set-template-target', pageId: 'tpl', target: null })
  assert.equal(defaultTemplate(await fresh().load(), dayPagesTarget), undefined)
  await run({ type: 'undo', targetOperationId: cleared.receipt.operationId })
  ws = await fresh().load()
  assert.equal(defaultTemplate(ws, dayPagesTarget)?.id, 'tpl')
  const rows = await sql.unsafe(`select id, type, parent_id from ${schema}.pages order by id`)
  console.log(JSON.stringify(rows))
  console.log('PASS postgres round trip: create, save (no task), copy into a new day, clear default, undo, reloads')
} finally {
  await sql.unsafe(`drop schema if exists ${schema} cascade`)
  await sql.end()
}
