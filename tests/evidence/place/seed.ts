// The store place.mjs runs on: "Eats", a database with a Place property "Where" holding one pinned place, one kept as
// words alone and one empty, and a Text property; and today's day page, for the network check.
// Usage: node --no-warnings tests/evidence/place/seed.ts <store-path>  (a throwaway path; it's replaced)
import { rmSync } from 'node:fs'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
const S = process.argv[2]
if (!S) { console.error('Usage: node --no-warnings tests/evidence/place/seed.ts <store-path>'); process.exit(2) }
for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
const r = new R(S, undefined, { allowMissingLegacy: true }); let w: any = await r.load()
const run = async (action: any) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const C = (change: any) => run({ type: 'change-database', pageId: 'eats', change })
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'eats', homeBlockId: null, title: 'Eats' })
await C({ kind: 'addProperty', property: { id: 'pl', name: 'Where', type: 'place' } })
await C({ kind: 'addProperty', property: { id: 'nt', name: 'Notes', type: 'text' } })
await run({ type: 'add-row', databaseId: 'eats', pageId: 'e1', title: 'Dumplings', values: { pl: { name: 'Golden Dumpling', address: '8391 Alexandra Rd, Richmond, BC, Canada', lat: 49.1859, lon: -123.1338, ref: 'osm:N123' } }, at })
await run({ type: 'add-row', databaseId: 'eats', pageId: 'e2', title: 'Ramen', values: { pl: { name: 'ramen place near work' } }, at })
await run({ type: 'add-row', databaseId: 'eats', pageId: 'e3', title: 'Tea', values: {}, at })
await run({ type: 'add-row', databaseId: 'eats', pageId: 'e4', title: 'Lake', values: {}, at })
await run({ type: 'ensure-day', date: new Date().toLocaleDateString('en-CA') })
console.log('seeded', w.revision)
