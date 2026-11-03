// Column calculations: the Board seed plus a page holding a linked view of its database, whose settings live in that block.
// Usage: node tests/evidence/calculations/seed-calc.ts <store-path>  (a throwaway store, never his data)
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath] = process.argv.slice(2)
if (!storePath) { console.error('Usage: node tests/evidence/calculations/seed-calc.ts <store-path>'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'create-document', title: 'Elsewhere', body: '', pageId: 'other' })
const page = ws.pages.find(p => p.id === 'other')!, source = ws.pages.find(p => p.id === 'list')!.database!.views[0]!
await run({ type: 'save-editor', pageId: 'other', expectedContent: pageContentKey(page), document: JSON.stringify([{ id: 'linked', type: 'database', props: { pageId: 'list', view: linkedViewJson(source) }, children: [] }]) })
console.log('seeded')
