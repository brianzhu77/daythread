// Run from a tree (the floor's): edit the Notes view (a sort) and add a row, as an older build would. Usage: node floor-edit.ts <store>
import { SqliteWorkspaceRepository } from './src/server/sqlite-repository.ts'
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws: any = await repo.load()
const run = async (action: unknown) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: action as never })).workspace }
const view = ws.pages.find((p: any) => p.id === 'notes').database.views[0]
console.log('floor reads layout', view.layout)
await run({ type: 'change-database', pageId: 'notes', change: { kind: 'updateView', viewId: view.id, sort: [{ by: 'title', direction: 'asc' }] } })
await run({ type: 'add-row', databaseId: 'notes', pageId: 'floorrow', title: 'Added by the floor', values: {}, at: new Date().toISOString() })
console.log('floor wrote', JSON.stringify(ws.pages.find((p: any) => p.id === 'notes').database.views[0]).slice(0, 160))
