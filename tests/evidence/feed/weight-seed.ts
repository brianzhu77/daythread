// 25 rows with a few paragraphs each, on a page as a table or a Feed. Usage: node --no-warnings tests/evidence/feed/weight-seed.ts <store-path> <table|feed>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path, layout] = process.argv.slice(2)
const repo = new SqliteWorkspaceRepository(path!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const at = new Date().toISOString()
await run({ type: 'create-document', title: 'Reading', body: '', pageId: 'reading' })
await run({ type: 'save-editor', pageId: 'reading', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'reading')!), document: JSON.stringify([{ id: 'home', type: 'database', props: { pageId: 'notes', view: '' }, children: [] }]) })
await run({ type: 'create-database', pageId: 'notes', parentId: 'reading', homeBlockId: 'home', title: 'Notes' })
await run({ type: 'change-database', pageId: 'notes', change: { kind: 'addProperty', property: { id: 'made', name: 'Created', type: 'createdTime' } } } as never)
for (let i = 0; i < 25; i++) {
  await run({ type: 'add-row', databaseId: 'notes', pageId: `n${i}`, title: `Note ${i}`, values: {}, at })
  const body = Array.from({ length: 4 }, (_, j) => ({ id: `n${i}p${j}`, type: 'paragraph', props: {}, content: [{ type: 'text', text: `Paragraph ${j + 1} of note ${i}, long enough to wrap once or twice on a phone.`, styles: {} }], children: [] }))
  await run({ type: 'save-editor', pageId: `n${i}`, expectedContent: pageContentKey(ws.pages.find(p => p.id === `n${i}`)!), document: JSON.stringify(body) })
}
if (layout === 'feed') { const view = ws.pages.find(p => p.id === 'notes')!.database!.views[0]!; await run({ type: 'change-database', pageId: 'notes', change: { kind: 'updateView', viewId: view.id, layout: 'feed', name: 'Feed', columns: [{ id: 'made' }] } } as never) }
console.log('seeded', layout)
