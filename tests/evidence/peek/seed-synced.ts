// A synced block on both a row and the page behind its view (peek.md §4), with the view set to Center peek.
// Usage: node tests/evidence/peek/seed-synced.ts <store-path>  (a throwaway store, never his data)
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [storePath] = process.argv.slice(2)
if (!storePath) { console.error('Usage: node tests/evidence/peek/seed-synced.ts <store-path>'); process.exit(2) }
execSync(`node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const page = (id: string) => ws.pages.find(p => p.id === id)!
const line = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const block = (id: string, children: object[] = []) => ({ id, type: 'syncedBlock', props: { syncId: 's1', roles: '' }, children })
const books = page('books')
await run({ type: 'save-editor', pageId: 'books', expectedContent: pageContentKey(books), document: JSON.stringify([block('behind', [line('s-one', 'Shared words')]), ...JSON.parse(books.document)]) })
await run({ type: 'save-editor', pageId: 'dune', expectedContent: pageContentKey(page('dune')), document: JSON.stringify([block('inrow'), line('own', 'Own line')]) })
const view = page('list').database!.views[0]!
await run({ type: 'change-database', pageId: 'list', change: { kind: 'updateView', viewId: view.id, openIn: 'center' } })
console.log('seeded')
