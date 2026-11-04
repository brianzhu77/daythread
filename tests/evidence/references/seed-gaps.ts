// On top of references/seed.ts: a one-way and a two-way relation to People, a linked view of Work on another page, and a page with sources in Trash (B86 9 to 12).
// Usage: node tests/evidence/references/seed-gaps.ts <store-path>  (a throwaway SQLite file, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { linkedViewJson } from '../../../src/domain/linked-view.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/references/seed-gaps.ts <store-path>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const at = new Date().toISOString()
const write = async (pageId: string, nodes: unknown[]) => { const p = ws.pages.find(x => x.id === pageId)!; await run({ type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(nodes) }) }
await run({ type: 'create-database', pageId: 'people', parentId: 'projects', homeBlockId: null, title: 'People' } as never)
for (const [id, title] of [['ann', 'Ann'], ['ben', 'Ben'], ['cal', 'Cal']] as const) await run({ type: 'add-row', databaseId: 'people', pageId: id, title, values: {}, at })
const change = (c: unknown) => run({ type: 'change-database', pageId: 'work', change: c as never })
await change({ kind: 'addProperty', property: { id: 'owner', name: 'Owner', type: 'relation', target: 'people' } })
await change({ kind: 'addProperty', property: { id: 'pal', name: 'Pal', type: 'relation', target: 'people' } })
await change({ kind: 'setMirror', propertyId: 'pal', mirror: { id: 'palback', name: 'Work' } })
await run({ type: 'set-values', pageId: 'other', values: { owner: ['ann'] }, expected: {}, at } as never)
await run({ type: 'set-values', pageId: 'other', values: { pal: ['ben'] }, expected: {}, at } as never)
// A linked view of Work on another page.
await run({ type: 'create-document', title: 'Weekly plan', body: '', pageId: 'plan' })
const work = ws.pages.find(p => p.id === 'work')!.database!
await write('plan', [{ id: 'lv', type: 'database', props: { pageId: 'work', view: linkedViewJson(work.views[0]!, 'lv-view') }, children: [] }])
// Sources for one page, four live and the newest in Trash.
await run({ type: 'create-document', title: 'Much linked to', body: '', pageId: 'target' })
await run({ type: 'create-document', title: 'Quiet page', body: '', pageId: 'quiet' })
for (const id of ['s1', 's2', 's3', 's4', 'binned']) {
  await run({ type: 'create-document', title: id === 'binned' ? 'In the bin' : `Source ${id}`, body: '', pageId: id })
  await write(id, [{ id: `${id}-card`, type: 'pageLink', props: { pageId: 'target' }, children: [] }])
}
await run({ type: 'delete-page', pageId: 'binned', at } as never)
console.log('seeded', process.argv[2])
