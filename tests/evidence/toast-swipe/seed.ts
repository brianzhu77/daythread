// The store swipe.mjs runs on: today's page with twelve open to-dos. Usage: node --no-warnings tests/evidence/toast-swipe/seed.ts <repo-path> <store-path> (throwaway; replaced). Never his data.
import { rmSync } from 'node:fs'
const [repo, S] = process.argv.slice(2)
if (!repo || !S) { console.error('Usage: seed.ts <repo> <store-path>'); process.exit(2) }
const { SqliteWorkspaceRepository: R } = await import(repo + '/src/server/sqlite-repository.ts')
for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
const r = new R(S, undefined, { allowMissingLegacy: true }); let w: any = await r.load()
const run = async (action: any) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const today = new Intl.DateTimeFormat('en-CA').format(new Date())
await run({ type: 'ensure-day', date: today })
const day = w.pages.find((p: any) => p.date === today)
for (let i = 1; i <= 12; i++) await run({ type: 'add-task', pageId: day.id, title: `To-do ${i}`, plannedOn: today })
console.log(JSON.stringify({ revision: w.revision, tasks: w.tasks.length }))
