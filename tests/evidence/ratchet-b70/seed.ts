import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey, pageNodes } from '../../../src/domain/editor-document.ts'
import { todo, heading } from '../../v2-helpers.ts'
const path = '/tmp/ratchet234-ui.sqlite'
const repo = new SqliteWorkspaceRepository(path)
let ws = await repo.load()
const template = ws.pages.find((p) => p.type === 'template')!
console.log('TEMPLATE', template.id)
await repo.executeOnLatest('review234-paste-source', {
  type: 'create-document',
  pageId: 'review234-source',
  title: 'Paste source',
  body: '',
})
ws = await repo.load()
const source = ws.pages.find((p) => p.id === 'review234-source')!
await repo.executeOnLatest('review234-source-task-' + crypto.randomUUID(), {
  type: 'save-editor',
  pageId: source.id,
  expectedContent: pageContentKey(source),
  document: JSON.stringify([
    heading('source-heading', 'Source'),
    todo('source-task', 'Preserve real task', 'reference', ''),
  ]),
  today: '2026-10-30',
})
ws = await repo.load()
console.log('TASK', JSON.stringify(ws.tasks.find((t) => t.title === 'Preserve real task')))
console.log('NODES', JSON.stringify(pageNodes(ws.pages.find((p) => p.id === source.id)!)))
