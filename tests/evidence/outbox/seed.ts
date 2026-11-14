// The store outbox.mjs runs on: today's page with three open to-dos. Usage: node --no-warnings tests/evidence/outbox/seed.ts <store-path>
// (a throwaway path; it's replaced). Never his data.
import { rmSync } from 'node:fs'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
const S = process.argv[2]
if (!S) { console.error('Usage: node --no-warnings tests/evidence/outbox/seed.ts <store-path>'); process.exit(2) }
for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
const r = new R(S, undefined, { allowMissingLegacy: true }); let w: any = await r.load()
const run = async (action: any) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(new Date())
// `no-today`: the to-dos live on a page of their own and today has no page yet (an offline open on a new morning).
const noToday = process.argv[3] === 'no-today'
if (noToday) await run({ type: 'create-document', title: 'Errands', body: '', pageId: 'errands' })
else await run({ type: 'ensure-day', date: today })
const day = noToday ? w.pages.find((p: any) => p.id === 'errands') : w.pages.find((p: any) => p.date === today)
for (const title of ['Water the plants', 'Call the bank', 'Pay rent']) await run({ type: 'add-task', pageId: day.id, title, plannedOn: today })
// A database for a cell edit: Runs, a Stage select, two rows.
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
await run({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'st', name: 'Stage', type: 'select', options: [{ id: 'a', name: 'Idea', color: 'gray' }, { id: 'b', name: 'Done', color: 'gray' }] } } })
for (const [id, title] of [['r1', 'Alpha'], ['r2', 'Bravo']]) await run({ type: 'add-row', databaseId: 'runs', pageId: id, title, values: { st: 'a' }, at })
console.log(JSON.stringify({ revision: w.revision, tasks: w.tasks.length }))
