import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const at = new Date().toISOString()
for (let i = 0; i < 27; i++) ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'add-row', databaseId: 'list', pageId: `r${i}`, title: `Row ${i}`, at } })).workspace
console.log('rows', ws.pages.filter(p => p.parentId === 'list').length)
