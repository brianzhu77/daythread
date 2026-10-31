import assert from 'node:assert/strict'
import postgres from 'postgres'
import { PostgresWorkspaceRepository } from '../../../src/server/postgres-repository.ts'
import { postgresClient } from '../../../src/server/db/sql.ts'
import { pageContentKey, pageNodes, inlineText } from '../../../src/domain/editor-document.ts'
import { defaultTemplate } from '../../../src/domain/day-template.ts'
import { asOwner } from '../../../src/server/auth/request-owner.ts'
import type { Action } from '../../../src/domain/types.ts'

// Own loopback server, never reads deployment environment or credentials.
const sql = postgres('postgres://ratchet226:localonly@127.0.0.1:54889/ratchet226', {
  prepare: false,
  onnotice: () => {},
})
const schema = 'ratchet_b70_' + Date.now()
const fresh = () => new PostgresWorkspaceRepository(postgresClient(sql), schema)
let sequence = 0
async function run(action: Action) {
  const repo = fresh()
  const ws = await repo.load()
  return repo.execute({
    operationId: `review-${++sequence}`,
    expectedRevision: ws.revision,
    action,
  })
}
try {
  await run({ type: 'ensure-day', date: '2026-10-30' })
  await run({
    type: 'create-template',
    pageId: 'review-template',
    title: 'Review template',
    dayPage: true,
  })
  let ws = await fresh().load()
  const template = ws.pages.find((p) => p.id === 'review-template')!
  const document = [
    {
      id: 'heading',
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: 'Custom', styles: {} }],
    },
    {
      id: 'task',
      type: 'task',
      props: { taskId: 'pasted-real-task', role: 'plan', planDate: '2026-10-30' },
      content: [{ type: 'text', text: 'Must copy empty', styles: {} }],
    },
    {
      id: 'paragraph',
      type: 'paragraph',
      content: [{ type: 'text', text: 'Keep these words', styles: {} }],
    },
  ]
  await run({
    type: 'save-editor',
    pageId: template.id,
    expectedContent: pageContentKey(template),
    document: JSON.stringify(document),
    today: '2026-10-30',
  })
  ws = await fresh().load()
  assert.equal(ws.tasks.length, 0)
  assert.equal(defaultTemplate(ws, 'days')?.id, template.id)
  const made = await run({ type: 'ensure-day', date: '2026-11-10' })
  ws = await fresh().load()
  const copied = pageNodes(ws.pages.find((p) => p.date === '2026-11-10')!)
  assert.deepEqual(
    copied.map((n) => inlineText(n.content)),
    ['Custom', '', 'Keep these words'],
  )
  assert.equal(new Set(copied.map((n) => n.id)).size, 3)
  assert.ok(copied.every((n) => !document.some((old) => old.id === n.id)))
  assert.equal(ws.tasks.length, 0)
  // ensure-day is deliberately not undoable; exercise the user-visible target change below.
  assert.equal(defaultTemplate(ws, 'days')?.id, template.id)
  const cleared = await run({ type: 'set-template-target', pageId: template.id, target: null })
  assert.equal(defaultTemplate(await fresh().load(), 'days'), undefined)
  await run({ type: 'undo', targetOperationId: cleared.receipt.operationId })
  assert.equal(defaultTemplate(await fresh().load(), 'days')?.id, template.id)
  const rows = await sql.unsafe(
    `select type, parent_id from ${schema}.pages where id = 'review-template'`,
  )
  assert.equal(rows[0].type, 'template')
  assert.equal(rows[0].parent_id, 'days')
  const ownerA = crypto.randomUUID()
  const ownerB = crypto.randomUUID()
  await fresh().workspaceIdFor(ownerA)
  await fresh().workspaceIdFor(ownerB)
  await asOwner(ownerA, () =>
    run({ type: 'create-template', pageId: 'same-id', title: 'A', dayPage: true }),
  )
  assert.equal((await asOwner(ownerB, () => fresh().load())).pages.length, 0)
  await asOwner(ownerB, () =>
    run({ type: 'create-template', pageId: 'same-id', title: 'B', dayPage: true }),
  )
  await asOwner(ownerB, () => run({ type: 'set-template-target', pageId: 'same-id', target: null }))
  assert.equal(defaultTemplate(await asOwner(ownerA, () => fresh().load()), 'days')?.id, 'same-id')
  assert.equal(defaultTemplate(await asOwner(ownerB, () => fresh().load()), 'days'), undefined)
  console.log(
    'PASS independent Postgres account A/B template and default isolation with overlapping page ids',
  )
  console.log(
    'PASS independent Postgres create/save/reload/copy/Undo/default clear/Undo; fresh repository every command',
  )
} finally {
  await sql.unsafe(`drop schema ${schema} cascade`)
  await sql.end()
}
