// The store the tap feedback checks run on (a throwaway path; it's replaced, never his data): today's page with three
// open to-dos, two open to-dos from yesterday, and a ready draft of four suggestions on today (two of yesterday's
// to-dos carried, two new lines), as the model would have made it.
// Usage: node --no-warnings tests/evidence/tap-feedback/seed.ts <store-path>
import { rmSync } from 'node:fs'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
import { buildDayDraftRequest, itemsFromModel, type ModelSuggestion } from '../../../src/server/model/day-draft.ts'
import { DRAFT_RECIPE } from '../../../src/domain/day-draft.ts'
import type { Workspace } from '../../../src/domain/types.ts'

const S = process.argv[2]
if (!S) { console.error('Usage: node --no-warnings tests/evidence/tap-feedback/seed.ts <store-path>'); process.exit(2) }
for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
const r = new R(S, undefined, { allowMissingLegacy: true })
let w: Workspace = await r.load()
const run = async (action: unknown) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action } as never)).workspace }
const zone = 'America/Vancouver'
const day = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(Date.now() + offset * 86_400_000))
const today = day(0), yesterday = day(-1)
await run({ type: 'set-timezone', timezone: zone })
await run({ type: 'ensure-day', date: yesterday })
const before = w.pages.find(p => p.type === 'daily' && p.date === yesterday)!
for (const title of ['Renew the passport', 'Email the landlord']) await run({ type: 'add-task', pageId: before.id, title, plannedOn: yesterday })
await run({ type: 'ensure-day', date: today })
const page = w.pages.find(p => p.type === 'daily' && p.date === today)!
for (const title of ['Water the plants', 'Call the bank', 'Pay rent']) await run({ type: 'add-task', pageId: page.id, title, plannedOn: today })

const req = buildDayDraftRequest(w, page, zone)
const anchor = [...req.blocks.keys()][0]!
// The model names a to-do by the request's own key for it.
const carried = [...req.tasks].filter(([, t]) => ['Renew the passport', 'Email the landlord'].includes(t.title)).map(([key]) => key)
const suggestions: ModelSuggestion[] = [
  ...carried.map(taskId => ({ anchor, place: 'after' as const, kind: 'existing_todo' as const, taskId, lineId: '', text: '', why: '' })),
  ...['Book the dentist', 'Send the rent receipt'].map(text => ({ anchor, place: 'after' as const, kind: 'new_line' as const, taskId: '', lineId: '', text, why: '' })),
]
let n = 0
const items = itemsFromModel(req, suggestions, () => `seed-item-${++n}`)
await run({ type: 'set-draft', pageId: page.id, status: 'ready', items, moreOpen: [], allowedTaskIds: items.flatMap(i => i.taskId ? [i.taskId] : []), recipe: DRAFT_RECIPE })
console.log(JSON.stringify({ today, items: items.length, revision: w.revision }))
