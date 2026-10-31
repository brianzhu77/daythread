import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { heading, bullet } from '../../v2-helpers.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
const repo = new SqliteWorkspaceRepository('/tmp/ratchet236.sqlite')
const run = async (action) => (await repo.executeOnLatest(crypto.randomUUID(), action)).workspace
await run({ type: 'ensure-day', date: '2026-10-30' })
await run({ type: 'create-document', title: 'Reading', body: '', pageId: 'reading' })
await run({
  type: 'create-document',
  title: 'Nested notes',
  body: '',
  pageId: 'nested',
  parentId: 'reading',
})
for (const [id, title, target] of [
  ['daily-tpl', 'Daily', 'days'],
  ['top-tpl', 'Top', 'top-level'],
  ['inside-tpl', 'Inside days', 'day-subpages'],
  ['specific-tpl', 'Specific', 'reading'],
]) {
  await run({ type: 'create-template', title, pageId: id })
  let ws = await repo.load(),
    page = ws.pages.find((p) => p.id === id)
  await run({
    type: 'save-editor',
    pageId: id,
    expectedContent: pageContentKey(page),
    document: JSON.stringify([heading(id + '-h', title + ' layout'), bullet(id + '-b')]),
    today: '2026-10-30',
  })
  await run({ type: 'set-template-target', pageId: id, target })
}
console.log('Seeded own four-template SQLite fixture')
