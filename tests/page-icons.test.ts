import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { commandSchema } from '../src/domain/command-schema.ts'
import { exportFiles, pageMarkdown } from '../src/domain/export.ts'
import { holdsFiles } from '../src/domain/database.ts'
import { filesToSweep } from '../src/server/file-store.ts'
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
  assert.equal(commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'set-page-icon', pageId: 'p', icon: 'x'.repeat(400) } }).success, false)
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
  assert.equal(JSON.stringify(search(buildSearchIndex(h.ws), '🌲', '2026-11-05').pages ?? []).includes('"p"'), false)
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
test('a cover is an http or https link; added, changed, moved and removed each say so, with one Undo; a changed link starts in the middle', () => {
  const h = page(), a = 'https://example.com/a.png', b = 'https://example.com/b.png'
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AA', 'not a link', 'file:///x']) assert.throws(() => h.run({ type: 'set-page-cover', pageId: 'p', cover: bad }), /image link/, bad)
  assert.equal(h.run({ type: 'set-page-cover', pageId: 'p', cover: a }).receipt.message, 'Cover added')
  const moved = h.run({ type: 'set-page-cover', pageId: 'p', cover: a, position: 0.25 })
  assert.equal(moved.receipt.message, 'Cover moved')
  assert.equal(h.page('p').coverPosition, 0.25)
  h.run({ type: 'undo', targetOperationId: moved.receipt.operationId })
  assert.equal('coverPosition' in h.page('p'), false, 'back to exactly where it was')
  h.run({ type: 'set-page-cover', pageId: 'p', cover: a, position: 0.25 })
  assert.equal(h.run({ type: 'set-page-cover', pageId: 'p', cover: b }).receipt.message, 'Cover changed')
  assert.equal('coverPosition' in h.page('p'), false, 'a new picture has its own crop')
  assert.equal(h.run({ type: 'set-page-cover', pageId: 'p', cover: null }).receipt.message, 'Cover removed')
  assert.equal('cover' in h.page('p'), false)
})
test('a cover goes with a copy and a template, export writes it at the top, and it survives the database', async () => {
  const h = harness(), url = 'https://example.com/a.png', at = '2026-11-05T00:00:00.000Z'
  h.run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'Books' })
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'r1', title: 'One', values: {}, at } as never)
  h.run({ type: 'set-page-cover', pageId: 'r1', cover: url, position: 0.75 })
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'r2', title: '', copyOf: 'r1', at } as never)
  assert.deepEqual([h.page('r2').cover, h.page('r2').coverPosition], [url, 0.75])
  assert.match(pageMarkdown(h.page('r1'), h.ws, new Map([['r1', 'One']])), /!\[\]\(https:\/\/example\.com\/a\.png\)\n\n# One/)
  const db = await PGlite.create(), repo = new PostgresWorkspaceRepository(pgliteClient(db), undefined, { today: '2026-11-05' })
  await repo.prepare()
  const owner = '11111111-1111-4111-8111-111111111111'
  await repo.workspaceIdFor(owner)
  await asOwner(owner, async () => {
    let w = await repo.load()
    const run = async (action: never) => { w = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace as typeof w }
    await run({ type: 'create-document', title: 'Trip', body: '', pageId: 'p' } as never)
    await run({ type: 'set-page-cover', pageId: 'p', cover: url, position: 0.3 } as never)
    await run({ type: 'rename-page', pageId: 'p', title: 'Trip 2' } as never)
    const back = (await repo.load()).pages.find(p => p.id === 'p')!
    assert.deepEqual([back.cover, back.coverPosition], [url, 0.3])
  })
  await db.close()
})
test('step 3: an icon may be one of ours or an upload, a cover one of ours or an upload; export leaves no dead link and names the files; the sweep holds them; the warning counts them (P1-5)', async () => {
  const id = 'fileLook0001', up = `/api/files/${id}?name=me.png`
  for (const good of ['icon:book-open', up]) assert.equal(isPageIcon(good), true, good)
  for (const bad of ['icon:', 'icon:Bad Name', 'icon:../x', '/api/files/x', '/api/other/abcdefgh', 'https://example.com/a.png']) assert.equal(isPageIcon(bad), false, bad)
  const h = page()
  assert.equal(holdsFiles(h.ws), false)
  h.run({ type: 'set-page-icon', pageId: 'p', icon: up })
  assert.equal(holdsFiles(h.ws), true)
  const store = { list: async () => [{ key: `local/${id}`, size: 1, storedAt: 0 }] } as never
  assert.equal((await filesToSweep(store, JSON.stringify(h.ws), Date.now())).length, 0, 'an icon holds its file')
  h.run({ type: 'set-page-icon', pageId: 'p', icon: 'icon:leaf' })
  h.run({ type: 'set-page-cover', pageId: 'p', cover: up })
  assert.equal((await filesToSweep(store, JSON.stringify(h.ws), Date.now())).length, 0, 'a cover holds its file')
  const md = pageMarkdown(h.page('p'), h.ws, new Map([['p', 'Trip']]))
  assert.doesNotMatch(md, /api\/files|icon:leaf/)
  assert.match(md, /\(cover, not in this export\)/)
  assert.match(exportFiles(h.ws, new Date('2026-11-05T10:00:00Z'))[0]!.text, /Trip: me\.png/)
  h.run({ type: 'set-page-cover', pageId: 'p', cover: '/covers/ruled.svg' })
  assert.equal(h.page('p').cover, '/covers/ruled.svg')
  for (const bad of ['/covers/../x.svg', '/covers/x.png', '/other/x.svg']) assert.throws(() => h.run({ type: 'set-page-cover', pageId: 'p', cover: bad }), /image link/, bad)
})

