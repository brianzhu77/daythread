// B60 10: what a tick costs. A workspace of Brian's size (40 day pages of 40 lines, one chip each) and the same with a database of 10,000 rows, on real Postgres in a disposable schema.
// CPU is this process's, a stand-in for the Worker's: the same JavaScript, not the same machine. firstCpuMs is the first tick in the process, with nothing parsed yet, as a cold Worker has it; the rest is the median of N ticks after it, with nothing due.
// Usage: DATABASE_TEST_URL=postgres://… node --no-warnings tests/evidence/reminders/tick-cost.ts [runs]
import postgres from 'postgres'
import { postgresClient } from '../../../src/server/db/sql.ts'
import { PostgresWorkspaceRepository } from '../../../src/server/postgres-repository.ts'
import { PushStore } from '../../../src/server/push/store.ts'
import { runTick } from '../../../src/server/push/server.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const url = process.env.DATABASE_TEST_URL
if (!url) { console.error('Usage: DATABASE_TEST_URL=postgres://… node --no-warnings tests/evidence/reminders/tick-cost.ts [runs] (a disposable database)'); process.exit(2) }
const runs = Number(process.argv[2] ?? 7), schema = 'daythread_check_b60', sqlRaw = postgres(url, { prepare: false, max: 4, onnotice: () => {} })
await sqlRaw.unsafe(`drop schema if exists ${schema} cascade`)
const sql = postgresClient(sqlRaw), repo = new PostgresWorkspaceRepository(sql, schema), push = new PushStore(sql, schema)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const line = (id: string, content: unknown[]) => ({ id, type: 'paragraph', props: {}, content, children: [] })
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace as Workspace }
for (let back = 0; back < 40; back++) {
  const date = iso(new Date(Date.now() - back * 86_400_000)), pageOf = () => ws.pages.find(p => p.date === date)!
  await run({ type: 'ensure-day', date })
  const lines = Array.from({ length: 40 }, (_, i) => line(`${date}-${i}`, [text(`Line ${i} of ${date}, with about the words a line holds`)]))
  lines[0] = line(`${date}-c`, [text('Dentist '), { type: 'dateMention', props: { eventId: `ev-${date}`, date, time: '23:59' } }])
  await run({ type: 'save-editor', pageId: pageOf().id, expectedContent: pageContentKey(pageOf()), document: JSON.stringify(lines) })
}
const workspaceId = await repo.workspaceIdFor(null)
await push.subscribe(workspaceId, { endpoint: 'https://push.invalid/b60', p256dh: 'p', auth: 'a' })
const send = async () => 'ok' as const
const tick = () => runTick({ store: push, loadWorkspace: id => repo.loadWorkspace(id), send, now: new Date() })
const measure = async (label: string) => {
  const cpu: number[] = [], wall: number[] = []
  let first = 0
  for (let i = 0; i <= runs; i++) {
    const c = process.cpuUsage(), w = performance.now()
    const { workspaces } = await tick()
    if (workspaces !== 1) throw new Error('The tick read nothing, so this measures nothing')
    const used = process.cpuUsage(c)
    if (i) { cpu.push((used.user + used.system) / 1000); wall.push(performance.now() - w) } else first = Math.round((used.user + used.system) / 100) / 10
  }
  const mid = (l: number[]) => Math.round([...l].sort((a, b) => a - b)[Math.floor(l.length / 2)]! * 10) / 10
  const pages = (await sqlRaw.unsafe(`select count(*)::int as n, coalesce(sum(length(document)), 0)::bigint as chars from ${schema}.pages`))[0]!
  console.log(JSON.stringify({ label, pages: pages.n, chars: Number(pages.chars), firstCpuMs: first, cpuMs: mid(cpu), wallMs: mid(wall) }))
}
await measure('his size')
await run({ type: 'create-database', pageId: 'big', homeBlockId: null, title: 'Big' })
const rows = Array.from({ length: 10_000 }, (_, i) => ({ pageId: crypto.randomUUID(), title: `Row ${i}`, values: {} }))
await run({ type: 'add-rows', databaseId: 'big', rows, at: new Date().toISOString() })
await measure('with 10,000 rows')
await sqlRaw.unsafe(`drop schema if exists ${schema} cascade`)
await sqlRaw.end()
