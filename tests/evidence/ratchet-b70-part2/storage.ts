import assert from 'node:assert/strict'
import postgres from 'postgres'
import { PostgresWorkspaceRepository } from '../../../src/server/postgres-repository.ts'
import { postgresClient } from '../../../src/server/db/sql.ts'
import { pageContentKey, pageNodes, inlineText } from '../../../src/domain/editor-document.ts'
import { defaultTemplate } from '../../../src/domain/day-template.ts'
import { heading, todo, text, para } from '../../v2-helpers.ts'
import type { Action } from '../../../src/domain/types.ts'
const sql = postgres('postgres://ratchet226:localonly@127.0.0.1:54889/ratchet226', {
  prepare: false,
  onnotice: () => {},
})
const schema = 'ratchet_p2_' + Date.now()
const fresh = () => new PostgresWorkspaceRepository(postgresClient(sql), schema)
let sequence = 0
async function run(action: Action) {
  const repo = fresh(),
    ws = await repo.load()
  return repo.execute({ operationId: 'p2-' + ++sequence, expectedRevision: ws.revision, action })
}
async function page(id: string) {
  return (await fresh().load()).pages.find((p) => p.id === id)!
}
async function save(id: string, document: unknown[]) {
  await run({
    type: 'save-editor',
    pageId: id,
    expectedContent: pageContentKey(await page(id)),
    document: JSON.stringify(document),
    today: '2026-10-30',
  })
}
const words = (p) => pageNodes(p).map((n) => [n.type, inlineText(n.content)])
try {
  await run({ type: 'ensure-day', date: '2026-10-30' })
  await run({ type: 'create-document', pageId: 'reading', title: 'Reading', body: '' })
  await run({
    type: 'create-document',
    pageId: 'nested',
    parentId: 'reading',
    title: 'Nested',
    body: '',
  })
  for (const [id, target] of [
    ['daily', 'days'],
    ['top', 'top-level'],
    ['inside', 'day-subpages'],
    ['specific', 'reading'],
  ]) {
    await run({ type: 'create-template', pageId: id, title: id })
    await save(id, [
      heading(id + '-h', id),
      todo(id + '-task', 'Template task words', 'reference', ''),
    ])
    await run({ type: 'set-template-target', pageId: id, target })
    assert.equal(defaultTemplate(await fresh().load(), target)?.id, id)
  }
  for (const [id, parentId, expected] of [
    ['top-page', undefined, 'top'],
    ['specific-page', 'reading', 'specific'],
    ['inside-page', 'day:2026-10-30', 'inside'],
    ['deeper', 'nested', null],
  ]) {
    await run({
      type: 'create-document',
      pageId: id,
      title: id,
      body: '',
      ...(parentId ? { parentId } : {}),
    })
    assert.deepEqual(
      words(await page(id)),
      expected
        ? [
            ['heading', expected],
            ['task', ''],
          ]
        : [['paragraph', '']],
    )
    assert.equal((await page(id)).title, id)
  }
  await run({ type: 'ensure-day', date: '2026-11-15' })
  assert.deepEqual(words(await page('day:2026-11-15')), [
    ['heading', 'daily'],
    ['task', ''],
  ])
  await run({ type: 'set-template-target', pageId: 'specific', target: 'day:2026-10-30' })
  await run({
    type: 'create-document',
    pageId: 'nearer',
    parentId: 'day:2026-10-30',
    title: '',
    body: '',
  })
  assert.equal(words(await page('nearer'))[0][1], 'specific')
  await run({ type: 'set-template-target', pageId: 'specific', target: 'reading' })
  await run({
    type: 'create-document',
    pageId: 'with-words',
    parentId: 'reading',
    title: 'Kept title',
    body: 'Existing words',
  })
  assert.deepEqual(words(await page('with-words')), [['paragraph', 'Existing words']])
  const existing = (await page('specific-page')).document
  await run({ type: 'move-page', pageId: 'specific-page', parentId: null })
  assert.equal((await page('specific-page')).document, existing)
  await run({
    type: 'make-link-pages',
    parentPageId: 'reading',
    items: [{ pageId: 'link', url: 'https://example.com/review' }],
  })
  const before = pageNodes(await page('link'))
  await run({
    type: 'apply-link-preview',
    pageId: 'link',
    url: 'https://example.com/review',
    title: 'Preview title',
    description: 'Preview excerpt',
  })
  assert.equal((await page('link')).title, 'Preview title')
  assert.deepEqual(pageNodes(await page('link')).slice(1), before)
  const edited = pageNodes(await page('link'))
  edited.push(para('my-words', text('My own note')))
  await save('link', edited)
  const own = await page('link')
  await run({
    type: 'apply-link-preview',
    pageId: 'link',
    url: 'https://example.com/review',
    title: 'Too late',
    description: 'Late excerpt',
  })
  assert.equal((await page('link')).document, own.document)
  assert.equal((await page('link')).title, own.title)
  const deleted = await run({ type: 'delete-template', pageId: 'specific' })
  assert.equal(defaultTemplate(await fresh().load(), 'reading'), undefined)
  await run({ type: 'undo', targetOperationId: deleted.receipt.operationId })
  assert.equal(defaultTemplate(await fresh().load(), 'reading')?.id, 'specific')
  await run({ type: 'delete-page', pageId: 'reading', at: '2026-10-31T05:00:00Z' })
  assert.ok(!(await page('specific')).trashedAt)
  assert.equal((await page('specific')).parentId, 'reading')
  await run({ type: 'restore-page', pageId: 'reading' })
  assert.equal(defaultTemplate(await fresh().load(), 'reading')?.id, 'specific')
  assert.equal((await fresh().load()).tasks.length, 0)
  console.log(
    'PASS Postgres four targets/nearer precedence/no ancestor inheritance/title and body rules/link preview/late edit/move/Delete+Undo/Trash+restore; fresh loads throughout',
  )
} finally {
  await sql.unsafe(`drop schema ${schema} cascade`)
  await sql.end()
}
