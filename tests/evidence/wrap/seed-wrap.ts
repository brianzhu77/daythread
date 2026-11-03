// Wrap: the Board seed plus a Text property and a row with a long title, long words and its own line breaks.
// Usage: node tests/evidence/wrap/seed-wrap.ts <store-path>  (a throwaway store, never his data)
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath] = process.argv.slice(2)
if (!storePath) { console.error('Usage: node tests/evidence/wrap/seed-wrap.ts <store-path>'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } } })
await run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'link', name: 'Link', type: 'url' } } })
const view = ws.pages.find(p => p.id === 'list')!.database!.views[0]!
// Note first after Name, so it's in reach at 390 without scrolling.
await run({ type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: view.id, columns: [{ id: 'note' }, { id: 'kind' }, { id: 'tags' }, { id: 'pages' }, { id: 'owned' }, { id: 'link' }, { id: 'status' }, { id: 'due' }] } })
const note = 'A note long enough that it can never fit on one line of this column, with more words after it\nand a second line of its own'
await run({ type: 'set-values', pageId: 'dune', values: { note, link: 'https://example.com/a/very/long/address/that/runs/on/and/on/past/the/width/of/its/column' } })
await run({ type: 'rename-page', pageId: 'emma', title: 'Emma, with a title long enough that it can never fit in the Name column on one line' })
console.log('seeded')
