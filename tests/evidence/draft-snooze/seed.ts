// The store notice.mjs runs on: today's page with a ready draft of three carried to-dos and one line the model wrote.
// Usage: node --no-warnings tests/evidence/draft-snooze/seed.ts <store-path> <today>  (a throwaway path; it's replaced). Never his data.
import { rmSync } from 'node:fs'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
import { pageNodes } from '../../../src/domain/editor-document.ts'
import { addDays } from '../../../src/domain/workspace.ts'
const [S, today] = process.argv.slice(2)
if (!S || !today) { console.error('Usage: node --no-warnings tests/evidence/draft-snooze/seed.ts <store-path> <today>'); process.exit(2) }
for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
const r = new R(S, undefined, { allowMissingLegacy: true }); let w: any = await r.load()
const run = async (action: any) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const dayId = (d: string) => w.pages.find((p: any) => p.type === 'daily' && p.date === d).id
const before = addDays(today, -3)
await run({ type: 'ensure-day', date: before })
for (const title of ['Tech Design Review - Fraud', 'TRV for Lu and Kathy', 'Umbrella']) await run({ type: 'add-task', pageId: dayId(before), title, plannedOn: before })
await run({ type: 'ensure-day', date: today })
const anchor = pageNodes(w.pages.find((p: any) => p.id === dayId(today)))[0].id
const items = [
  ...w.tasks.map((t: any, i: number) => ({ id: `t${i}`, anchor, place: 'after', taskId: t.id, source: 'model', state: 'open' })),
  { id: 'l0', anchor, place: 'after', source: 'model', state: 'open', block: { id: 'draft-l0', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Draft the offsite agenda', styles: {} }], children: [] } },
]
await run({ type: 'set-draft', pageId: dayId(today), status: 'ready', moreOpen: [], allowedTaskIds: w.tasks.map((t: any) => t.id), items })
console.log(JSON.stringify({ today, items: items.length }))
