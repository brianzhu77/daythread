import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
const [, , store, every, start, time, notBefore] = process.argv
const repo = new SqliteWorkspaceRepository(store!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: unknown) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: action as never })).workspace }
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
await run({ type: 'create-database', pageId: 'log', parentId: 'notes', homeBlockId: null, title: 'Log' })
await run({ type: 'create-template', databaseId: 'log', title: 'Daily review', pageId: 'weekly' })
await run({ type: 'change-database', pageId: 'log', change: { kind: 'setRepeat', templateId: 'weekly', repeat: { every, interval: 1, start, time, notBefore } } })
void pageContentKey
