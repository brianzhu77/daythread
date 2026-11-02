// On a throwaway copy only: empties the fixture's scratch day, which his template fills, so align-fixtures.ts accepts the copy.
import { resolve } from 'node:path'
const [repo, store] = process.argv.slice(2)
if (!repo || !store) { console.error('Usage: node clear-scratch.ts <repo> <store-path>'); process.exit(2) }
const { SqliteWorkspaceRepository } = await import(resolve(repo, 'src/server/sqlite-repository.ts'))
const { headingNode, pageContentKey } = await import(resolve(repo, 'src/domain/editor-document.ts'))
const r = new SqliteWorkspaceRepository(store)
let ws = await r.load()
ws = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'ensure-day', date: '2026-12-31' } })).workspace
const page = ws.pages.find((p: any) => p.date === '2026-12-31')
ws = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify([headingNode('Notes')]), today: '2026-11-02' } })).workspace
console.log('cleared, revision', ws.revision)
