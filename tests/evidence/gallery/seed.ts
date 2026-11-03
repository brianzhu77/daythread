// Gallery: a disposable SQLite store (path as the argument, never his data) with board/seed-board.ts's database, and images in three row bodies.
// Usage: node tests/evidence/gallery/seed.ts <store-path> <base-url of the server, for an image that loads>
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath, base] = process.argv.slice(2)
if (!storePath || !base) { console.error('Usage: node tests/evidence/gallery/seed.ts <store-path> <base-url>'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const image = async (pageId: string, url: string) => {
  const row = ws.pages.find(p => p.id === pageId)!
  await run({ type: 'save-editor', pageId, expectedContent: pageContentKey(row), document: JSON.stringify([{ id: `img-${pageId}`, type: 'image', props: { url }, children: [] }, ...JSON.parse(row.document)]) })
}
await image('dune', `${base}/apple-touch-icon.png`)
await image('emma', `${base}/this-image-is-gone.png`)
console.log('seeded')
