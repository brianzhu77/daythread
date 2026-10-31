import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { heading, para, text } from '../../v2-helpers.ts'
const repo = new SqliteWorkspaceRepository('/tmp/ratchet236.sqlite')
const run = async (action) => (await repo.executeOnLatest(crypto.randomUUID(), action)).workspace
await run({ type: 'ensure-day', date: '2026-10-28' })
let ws = await repo.load(),
  p = ws.pages.find((p) => p.date === '2026-10-28')
await run({
  type: 'save-editor',
  pageId: p.id,
  expectedContent: pageContentKey(p),
  document: JSON.stringify([
    heading('calendar-h', 'Fixture'),
    para('calendar-p', text('Written calendar dot fixture')),
  ]),
  today: '2026-10-30',
})
await run({
  type: 'create-document',
  pageId: 'long-parent',
  parentId: 'nested',
  title:
    'Korean soup notes with a very long title that must fit in the target menu on a phone 中文标题需要换行',
  body: '',
})
await run({ type: 'set-template-target', pageId: 'specific-tpl', target: 'long-parent' })
console.log('Seeded a written past day and long nested target on own copy')
