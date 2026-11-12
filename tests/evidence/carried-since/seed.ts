// The store carried-since.mjs runs on: to-dos brought to each day by that day's draft, as Brian's TRV was (Bumblebee 66544b2c).
// Usage: node --no-warnings tests/evidence/carried-since/seed.ts <store-path> <today>  (a throwaway path; it's replaced)
import { rmSync } from 'node:fs'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
import { pageNodes } from '../../../src/domain/editor-document.ts'
import { addDays } from '../../../src/domain/workspace.ts'
const [S, today] = process.argv.slice(2)
if (!S || !today) { console.error('Usage: node --no-warnings tests/evidence/carried-since/seed.ts <store-path> <today>'); process.exit(2) }
for (const x of ['', '-wal', '-shm']) rmSync(S + x, { force: true })
const r = new R(S, undefined, { allowMissingLegacy: true }); let w: any = await r.load()
const run = async (action: any) => { w = (await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action })).workspace }
const dayId = (d: string) => w.pages.find((p: any) => p.type === 'daily' && p.date === d).id
const todos: [string, number, string | null][] = [
  ['Renew the TRV', 7, null],
  ['Six days only', 6, null],
  ['提交加拿大临时居民签证续签申请材料并预约生物信息采集', 9, null],
  ['File the taxes', 8, addDays(today, 3)],
]
for (const [title, days, deadline] of todos) {
  const typed = addDays(today, -days)
  await run({ type: 'ensure-day', date: typed })
  await run({ type: 'add-task', pageId: dayId(typed), title, plannedOn: typed, ...(deadline ? { deadlineOn: deadline } : {}) })
}
for (let n = 9; n >= 0; n--) {
  const date = addDays(today, -n)
  await run({ type: 'ensure-day', date })
  const due = w.tasks.filter((t: any) => t.createdOn < date)
  if (!due.length) continue
  const anchor = pageNodes(w.pages.find((p: any) => p.id === dayId(date)))[0].id
  await run({ type: 'set-draft', pageId: dayId(date), status: 'ready', moreOpen: [], allowedTaskIds: due.map((t: any) => t.id), items: due.map((t: any, i: number) => ({ id: `i${i}`, anchor, place: 'after', taskId: t.id, source: 'model', state: 'open' })) })
  await run({ type: 'apply-draft', pageId: dayId(date), itemIds: due.map((_: any, i: number) => `i${i}`), today: date })
}
console.log('to-dos', w.tasks.map((t: any) => `${t.title.slice(0, 12)}:${t.createdOn}`).join(', '))
