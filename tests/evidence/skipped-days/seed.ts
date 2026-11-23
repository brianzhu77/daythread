// The store the #377 row checks run on (a throwaway path; replaced, never his data). Nine days ago holds four open
// to-dos; earlier days' drafts skipped them (by ✕ or Dismiss), so today's draft shows each kind of label:
//   Kathy homework app: skipped 8 days ago, 2 days ago, yesterday -> "skipped <M/D>, <wd>, <wd>" (the longest label)
//   Renew TRV: skipped yesterday -> "skipped <wd>"
//   Set up the Kathy ... teacher (long title): skipped 5 times -> "skipped 5 times"
//   Lenny's vet booking: never skipped -> no label, no Another day
// plus one new line. Usage: node --no-warnings tests/evidence/skipped-days/seed.ts <store-path>
import { rmSync } from 'node:fs'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
import { DRAFT_RECIPE, type DraftItem } from '../../../src/domain/day-draft.ts'
import type { Workspace } from '../../../src/domain/types.ts'

const S = process.argv[2]
if (!S) { console.error('Usage: node --no-warnings tests/evidence/skipped-days/seed.ts <store-path>'); process.exit(2) }
for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
const r = new R(S, undefined, { allowMissingLegacy: true })
let w: Workspace = await r.load()
const run = async (action: unknown) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action } as never)).workspace }
const zone = 'America/Vancouver'
const day = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(Date.now() + offset * 86_400_000))
await run({ type: 'set-timezone', timezone: zone })
await run({ type: 'ensure-day', date: day(-9) })
const first = w.pages.find(p => p.type === 'daily' && p.date === day(-9))!
const TITLES = { kathy: 'Kathy homework app', trv: 'Renew TRV', long: 'Set up the Kathy homework app on the iPad and share it with her teacher', lenny: 'Lenny’s vet booking' }
for (const title of Object.values(TITLES)) await run({ type: 'add-task', pageId: first.id, title, plannedOn: day(-9) })
const id = (k: keyof typeof TITLES) => w.tasks.find(t => t.title === TITLES[k])!.id
const all = (Object.keys(TITLES) as (keyof typeof TITLES)[]).map(id)
const skips: Record<number, (keyof typeof TITLES)[]> = { [-8]: ['kathy', 'long'], [-5]: ['long'], [-4]: ['long'], [-2]: ['kathy', 'long'], [-1]: ['kathy', 'trv', 'long'] }
const carried = (prefix: string) => all.map((taskId, i) => ({ id: `${prefix}-${i}`, anchor: '', place: 'after', source: 'model', state: 'open', taskId }) as DraftItem)
for (const [offset, which] of Object.entries(skips)) {
  await run({ type: 'ensure-day', date: day(Number(offset)) })
  const p = w.pages.find(x => x.type === 'daily' && x.date === day(Number(offset)))!
  const items = carried(`d${offset}`)
  await run({ type: 'set-draft', pageId: p.id, status: 'ready', items, moreOpen: [], allowedTaskIds: all, recipe: DRAFT_RECIPE })
  await run({ type: 'skip-draft', pageId: p.id, itemIds: which.map(k => items[all.indexOf(id(k))]!.id) })
}
await run({ type: 'ensure-day', date: day(0) })
const page = w.pages.find(p => p.type === 'daily' && p.date === day(0))!
const line: DraftItem = { id: 'today-line', anchor: '', place: 'after', source: 'model', state: 'open', block: { id: 'today-line-b', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Finish packing before Wednesday', styles: {} }], children: [] } }
await run({ type: 'set-draft', pageId: page.id, status: 'ready', items: [line, ...carried('today')], moreOpen: [], allowedTaskIds: all, recipe: DRAFT_RECIPE })
console.log(JSON.stringify({ today: day(0), revision: w.revision }))
