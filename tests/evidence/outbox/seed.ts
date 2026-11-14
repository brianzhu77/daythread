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
await run({ type: 'ensure-day', date: today })
const day = w.pages.find((p: any) => p.date === today)
for (const title of ['Water the plants', 'Call the bank', 'Pay rent']) await run({ type: 'add-task', pageId: day.id, title, plannedOn: today })
console.log(JSON.stringify({ revision: w.revision, tasks: w.tasks.length }))
