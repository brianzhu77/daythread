// B98's migration rehearsal (docs/design/outbox.md §11, Lead 2e510161, Bumblebee 51adb708), on a LOCAL Postgres only:
// a backup's tables loaded into a schema the live build makes, migrated by this build, read by the live build and the
// floor build after it, and the rollback gap shown. Prints PASS/FAIL lines; exit code 1 on any FAIL.
//
// Usage: node --no-warnings tests/evidence/outbox/rehearse.ts <backup dir> <pg url> <schema> <live tree> <floor tree>
//   <backup dir>: one JSON array per table (workspaces.json, pages.json, tasks.json, ...), as our backups are taken.
//   <pg url>: a local database (127.0.0.1 or localhost); <schema> is dropped and made again there.
//   <live tree>, <floor tree>: checkouts of the build live at the time and of the floor build, each with node_modules.
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import postgres from 'postgres'

const [backupDir, url, schema, liveTree, floorTree] = process.argv.slice(2)
if (!backupDir || !url || !schema || !liveTree || !floorTree) {
  console.error('Usage: node --no-warnings tests/evidence/outbox/rehearse.ts <backup dir> <pg url> <schema> <live tree> <floor tree>'); process.exit(2)
}
const host = new URL(url).hostname
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) { console.error(`Refusing ${host}: the rehearsal runs on a local Postgres only.`); process.exit(2) }
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) { console.error('The schema must be a lowercase SQL identifier.'); process.exit(2) }

const results: boolean[] = []
const ok = (name: string, pass: boolean, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }

interface Build { name: string; Repo: any; client: (sql: any) => any; asOwner: <T>(id: string | undefined, fn: () => T) => T }
const build = async (name: string, tree: string): Promise<Build> => {
  const at = (p: string) => resolve(tree, p)
  const [{ PostgresWorkspaceRepository }, { postgresClient }, { asOwner }] = await Promise.all([
    import(at('src/server/postgres-repository.ts')), import(at('src/server/db/sql.ts')), import(at('src/server/auth/request-owner.ts')),
  ])
  return { name, Repo: PostgresWorkspaceRepository, client: postgresClient, asOwner }
}
const live = await build('live', liveTree), floor = await build('floor', floorTree), self = await build('this', resolve(import.meta.dirname, '../../..'))

const sql = postgres(url, { max: 4, onnotice: () => {} })
const repoOf = (b: Build) => new b.Repo(b.client(sql), schema)
// The tables a workspace lives in; others in a backup (accounts, sessions, push) belong to sign-in and stay out.
const tables = ['workspaces', 'pages', 'tasks', 'deleted_tasks', 'comment_threads', 'task_links', 'operations']
const newColumns = new Set(['row_revision', 'settings_revision', 'rows_tracked_through', 'rows_untracked_until', 'receipts_forgotten_through'])
const counts = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, Number((await sql.unsafe(`select count(*)::int as n from ${schema}.${t}`))[0]!.n)])))
/** The workspace as a build reads it, without what only Undo or replays use. */
const read = async (b: Build, owner: string) => { const ws = await b.asOwner(owner, () => repoOf(b).load()); const { undo: _u, receipts: _r, ...rest } = ws; return rest }

try {
  // 1. The live build makes the schema; the backup's rows go in as they are.
  await sql.unsafe(`drop schema if exists ${schema} cascade`)
  await repoOf(live).prepare()
  const loaded: Record<string, number> = {}
  for (const t of tables) {
    const file = join(backupDir, `${t}.json`)
    if (!existsSync(file)) { loaded[t] = 0; continue }
    const rows = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, unknown>>
    loaded[t] = rows.length
    if (rows.length) await sql.unsafe(`insert into ${schema}.${t} select * from json_populate_recordset(null::${schema}.${t}, $1::json)`, [JSON.stringify(rows)])
  }
  const accounts = (await sql.unsafe(`select user_id::text as id, (select count(*) from ${schema}.pages p where p.workspace_id = w.id)::int as pages from ${schema}.workspaces w where user_id is not null order by 2 desc`)) as Array<{ id: string; pages: number }>
  const owner = accounts[0]?.id
  ok('1 the live build made the schema and the backup loaded', Boolean(owner), `${Object.entries(loaded).map(([t, n]) => `${t} ${n}`).join(', ')}; ${accounts.length} account(s)`)
  if (!owner) throw new Error('No account in the backup')
  const before = await counts(), wsBefore = await read(live, owner)

  // 2. This build migrates, twice: the second finds nothing to do.
  const times: number[] = []
  for (let i = 0; i < 2; i++) { const started = performance.now(); await repoOf(self).prepare(); times.push(Math.round(performance.now() - started)) }
  const columns = (await sql.unsafe(`select table_name, column_name from information_schema.columns where table_schema = $1`, [schema])) as Array<{ table_name: string; column_name: string }>
  const added = columns.filter(c => newColumns.has(c.column_name)).map(c => `${c.table_name}.${c.column_name}`)
  ok('2 this build migrates, and again with nothing to do', added.length === 9, `${times[0]} ms, then ${times[1]} ms; added ${added.length} columns`)

  // 3. Nothing he has changed: the same rows, and the same workspace read by this build as the live build read before.
  const after = await counts(), wsAfter = await read(self, owner)
  ok('3 row counts and his workspace are the same after the migration (new columns aside)', isDeepStrictEqual(before, after) && isDeepStrictEqual(wsBefore, wsAfter), `${JSON.stringify(after)}`)

  // 3b. The live build keeps working on the migrated schema: the build serving between the migration and the deploy.
  const outboxBase = (await read(self, owner)).revision
  const liveWrite = await live.asOwner(owner, async () => { const r = repoOf(live), w = await r.load(); return r.execute({ operationId: `rehearse-live-${Date.now()}`, expectedRevision: w.revision, action: { type: 'ensure-day', date: '2099-01-01' } }) })
  ok('3b the live build loads and writes on the migrated schema', liveWrite.workspace.revision === outboxBase + 1, `revision ${outboxBase} → ${liveWrite.workspace.revision}`)

  // 4. The floor build too.
  const floorWrite = await floor.asOwner(owner, async () => { const r = repoOf(floor), w = await r.load(); return r.execute({ operationId: `rehearse-floor-${Date.now()}`, expectedRevision: w.revision, action: { type: 'ensure-day', date: '2099-01-02' } }) })
  ok('4 the floor build loads and writes on the migrated schema', floorWrite.workspace.revision === outboxBase + 2, `revision → ${floorWrite.workspace.revision}`)

  // 5. This build sees the stretch the older builds wrote unstamped, and holds a change based before it.
  const [w] = (await sql.unsafe(`select revision, rows_tracked_through as through from ${schema}.workspaces where user_id = $1::uuid`, [owner])) as Array<{ revision: number; through: number | null }>
  const day = (await read(self, owner)).pages.find((p: { date?: string }) => p.date === '2099-01-01')!
  let held = ''
  try {
    await self.asOwner(owner, () => repoOf(self).executeOutbox({ operationId: `rehearse-old-${Date.now()}`, expectedRevision: outboxBase, action: { type: 'add-task', pageId: day.id, title: 'Made before the rollback' } }, { baseRevision: outboxBase, ownRevisions: [], readsBeyond: false }))
  } catch (error) { held = (error as { reason?: string }).reason ?? String(error) }
  ok('5 this build sees the unstamped stretch and holds a change based before it', w!.through !== w!.revision && held === 'changed-since', `revision ${w!.revision}, last stamped ${w!.through ?? 'never'}, replay ${held || 'applied'}`)
} catch (error) {
  ok('rehearsal ran to the end', false, error instanceof Error ? error.message : String(error))
} finally {
  await sql.end()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
