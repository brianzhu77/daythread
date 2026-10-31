import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
const repo = new SqliteWorkspaceRepository('/tmp/ratchet234-ui.sqlite')
const ws = await repo.load()
for (const p of ws.pages.filter((p) => p.type === 'document' && !p.parentId && !p.trashedAt)) {
  await repo.executeOnLatest(`review234-move-${p.id}`, {
    type: 'move-page',
    pageId: p.id,
    parentId: 'day:2026-10-30',
  })
}
console.log('Moved only invented root fixtures under today for zero-root sidebar check')
