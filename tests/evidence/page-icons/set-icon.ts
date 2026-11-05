// Sets one page's icon on a store a script is using: `DAY` is today's page. Usage: node tests/evidence/page-icons/set-icon.ts <store-path> <page-id|DAY> <emoji>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
const [store, id, icon] = process.argv.slice(2)
if (!store || !id || !icon) { console.error('Usage: node tests/evidence/page-icons/set-icon.ts <store-path> <page-id|DAY> <emoji>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(store, undefined, { allowMissingLegacy: true })
const ws = await repo.load(), today = new Intl.DateTimeFormat('en-CA').format(new Date())
const pageId = id === 'DAY' ? ws.pages.find(p => p.date === today)!.id : id
await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'set-page-icon', pageId, icon } as never })
