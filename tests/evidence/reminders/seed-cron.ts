// B60 on a local Worker: a throwaway schema with a chip five minutes ago, and a device that signed up half an hour ago.
// Usage: node --no-warnings tests/evidence/reminders/seed-cron.ts <postgres-url> <schema> <endpoint> <p256dh> <auth> [owner]  (a disposable database, never his)
import { execSync } from 'node:child_process'
import postgres from 'postgres'
import { asOwner } from '../../../src/server/auth/request-owner.ts'
import { postgresClient } from '../../../src/server/db/sql.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { PostgresWorkspaceRepository } from '../../../src/server/postgres-repository.ts'
import { PushStore } from '../../../src/server/push/store.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'
const [url, schema, endpoint, p256dh, auth, owner = '11111111-1111-4111-8111-111111111111'] = process.argv.slice(2) as [string, string, string, string, string, string?]
if (!url || !schema?.startsWith('daythread_check') || !endpoint) { console.error('Usage: node --no-warnings tests/evidence/reminders/seed-cron.ts <postgres-url> <daythread_check_…> <endpoint> <p256dh> <auth> [owner]'); process.exit(2) }
const raw = postgres(url, { prepare: false, max: 2, onnotice: () => {} }), sql = postgresClient(raw)
await raw.unsafe(`drop schema if exists ${schema} cascade`)
const repo = new PostgresWorkspaceRepository(sql, schema), push = new PushStore(sql, schema)
// The wall clock from the system, not Node: its time zone data can be older than the Worker's (British Columbia stayed on UTC-7 this November, and Node's still says UTC-8).
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone, [date, time] = execSync('date -v-5M "+%F %H:%M"').toString().trim().split(' ') as [string, string]
const id = await repo.workspaceIdFor(owner)
await asOwner(owner, async () => {
  let ws = await repo.load()
  const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace as Workspace }
  await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'rem-doc' })
  const page = () => ws.pages.find(p => p.id === 'rem-doc')!
  await run({ type: 'save-editor', pageId: 'rem-doc', expectedContent: pageContentKey(page()), document: JSON.stringify([{ id: 'l1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Dentist ', styles: {} }, { type: 'dateMention', props: { eventId: 'ev1', date, time: time.slice(0, 5) } }], children: [] }]) })
})
await sql.query(`update ${schema}.workspaces set timezone = $2 where id = $1::uuid`, [id, zone])
await push.subscribe(id, { endpoint, p256dh, auth })
await sql.query(`update ${schema}.push_subscriptions set created_at = now() - interval '30 minutes'`)
console.log('seeded', date, time.slice(0, 5))
await raw.end()
