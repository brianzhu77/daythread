import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { commandSchema } from '../src/domain/command-schema.ts'
import { pageMarkdown } from '../src/domain/export.ts'
import { isPageIcon } from '../src/domain/page-icon.ts'
import { buildSearchIndex, search } from '../src/domain/search.ts'
import { pgliteClient } from '../src/server/db/sql.ts'
import { PostgresWorkspaceRepository } from '../src/server/postgres-repository.ts'
import { asOwner } from '../src/server/auth/request-owner.ts'
import { harness } from './v2-helpers.ts'

function page() {
  const h = harness()
  h.run({ type: 'create-document', title: 'Trip', body: '', pageId: 'p' })
  return h
}
test('an icon is one emoji as a person sees it, however many code points it takes', () => {
  for (const good of ['😀', '👍🏽', '👩‍💻', '🇨🇦', '1️⃣', '❤️']) assert.equal(isPageIcon(good), true, good)
  for (const bad of ['', 'a', 'ab', '😀😀', '😀 ', '<b>', 'x'.repeat(40)]) assert.equal(isPageIcon(bad), false, bad)
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'set-page-icon', pageId: 'p', icon: 'x'.repeat(40) } }).success, false)
})
test('adding, changing and removing say so, each with one Undo; what isn\'t an emoji is refused', () => {
  const h = page()
  const added = h.run({ type: 'set-page-icon', pageId: 'p', icon: '😀' })
  assert.equal(added.receipt.message, 'Icon added')
  assert.equal(h.page('p').icon, '😀')
  const changed = h.run({ type: 'set-page-icon', pageId: 'p', icon: '🌲' })
  assert.equal(changed.receipt.message, 'Icon changed')
  h.run({ type: 'undo', targetOperationId: changed.receipt.operationId })
  assert.equal(h.page('p').icon, '😀')
  const removed = h.run({ type: 'set-page-icon', pageId: 'p', icon: null })
  assert.equal(removed.receipt.message, 'Icon removed')
  assert.equal('icon' in h.page('p'), false, 'no field left, so a page with none is as it was')
  assert.throws(() => h.run({ type: 'set-page-icon', pageId: 'p', icon: 'words' }), /one emoji/)
})
test('a title stays words: search and the title don\'t change, and export writes the emoji before the heading', () => {
  const h = page()
  h.run({ type: 'set-page-icon', pageId: 'p', icon: '🌲' })
  assert.equal(h.page('p').title, 'Trip')
  assert.equal(JSON.stringify(search(buildSearchIndex(h.ws), '🌲').pages ?? []).includes('"p"'), false)
  const md = pageMarkdown(h.page('p'), h.ws, new Map([['p', 'Trip']]))
  assert.match(md, /🌲\n\n# Trip\n/)
})
test('Duplicate row copies it, a row template and a day template pass it on (P1-6, P1-7)', () => {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'Books' })
  const at = '2026-11-05T00:00:00.000Z'
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'r1', title: 'One', values: {}, at } as never)
  h.run({ type: 'set-page-icon', pageId: 'r1', icon: '📕' })
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'r2', title: '', copyOf: 'r1', at } as never)
  assert.equal(h.page('r2').icon, '📕')
  h.run({ type: 'create-template', databaseId: 'db', title: 'T', pageId: 'rt' })
  h.run({ type: 'set-page-icon', pageId: 'rt', icon: '📗' })
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'r3', title: '', template: 'rt', at } as never)
  assert.equal(h.page('r3').icon, '📗')
  h.run({ type: 'create-template', dayPage: true, title: 'Day', pageId: 'dt' })
  h.run({ type: 'set-page-icon', pageId: 'dt', icon: '☀️' })
  h.run({ type: 'ensure-day', date: '2099-01-02' })
  assert.equal(h.ws.pages.find(p => p.date === '2099-01-02')!.icon, '☀️')
})
test('it survives the database: written, read back, and a save that doesn\'t touch it leaves it', async () => {
  const db = await PGlite.create(), repo = new PostgresWorkspaceRepository(pgliteClient(db), undefined, { today: '2026-11-05' })
  await repo.prepare()
  const owner = '11111111-1111-4111-8111-111111111111'
  await repo.workspaceIdFor(owner)
  await asOwner(owner, async () => {
    let w = await repo.load()
    const run = async (action: never) => { w = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace as typeof w }
    await run({ type: 'create-document', title: 'Trip', body: '', pageId: 'p' } as never)
    await run({ type: 'set-page-icon', pageId: 'p', icon: '👩‍💻' } as never)
    await run({ type: 'rename-page', pageId: 'p', title: 'Trip 2' } as never)
    assert.equal((await repo.load()).pages.find(p => p.id === 'p')!.icon, '👩‍💻')
    await run({ type: 'set-page-icon', pageId: 'p', icon: null } as never)
    assert.equal('icon' in (await repo.load()).pages.find(p => p.id === 'p')!, false)
  })
  await db.close()
})
