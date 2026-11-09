// The store comments-property.mjs runs on: Runs, six rows, Stage, Miles (hidden in the table view), Note and six empty Extras.
// Usage: node --no-warnings tests/evidence/comments-property/seed.ts <store-path>  (a throwaway path; it's replaced)
import { rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
const S = process.argv[2]
if (!S) { console.error('Usage: node --no-warnings tests/evidence/comments-property/seed.ts <store-path>'); process.exit(2) }
 for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
let r = new R(S, undefined, { allowMissingLegacy: true }); let w: any = await r.load()
const run = async (action: any) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const at = new Date().toISOString()
const C = (change: any) => run({ type: 'change-database', pageId: 'db', change })
await run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'Runs' })
await C({ kind: 'addProperty', property: { id: 'st', name: 'Stage', type: 'select', options: [{ id: 'a', name: 'Idea', color: 'gray' }, { id: 'b', name: 'Doing', color: 'gray' }, { id: 'c', name: 'Done', color: 'gray' }] } })
await C({ kind: 'addProperty', property: { id: 'n', name: 'Miles', type: 'number' } })
const rows: [string, string, any][] = [['r1', 'Alpha', { st: 'a', n: 3 }], ['r2', 'Bravo', { st: 'b', n: 5 }], ['r3', 'Charlie', { st: 'a', n: 2 }], ['r4', 'Delta', { st: 'c', n: 8 }], ['r5', 'Echo', { st: 'a', n: 1 }], ['r6', 'Foxtrot', { n: 4 }]]
for (const [id, title, values] of rows) await run({ type: 'add-row', databaseId: 'db', pageId: id, title, values, at })
await C({ kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } })
for (const n of [1, 2, 3, 4, 5, 6]) await C({ kind: 'addProperty', property: { id: `e${n}`, name: `Extra ${n}`, type: 'text' } })
{ const v = w.pages.find((p: any) => p.id === 'db').database.views.find((v: any) => v.layout === 'table'); await C({ kind: 'updateView', viewId: v.id, columns: v.columns.filter((c: any) => c.id !== 'n') }) }
console.log('rows', w.pages.filter((p: any) => p.parentId === 'db').length)
