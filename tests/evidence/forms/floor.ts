// A form through a rollback (forms.md §6, G7-8), on a real Postgres with real writes by the floor build: a form made here, with its questions,
// state and count; the floor renames the view, sorts it, adds a property and a row, and undoes the rename; back here, the form as it was.
// Usage: DATABASE_TEST_URL=postgres://… node --no-warnings tests/evidence/forms/floor.ts <floor-worktree>  (a disposable database; its daythread_test_forms schema is dropped)
import postgres from 'postgres'
import { PostgresWorkspaceRepository as Current } from '../../../src/server/postgres-repository.ts'
import { postgresClient } from '../../../src/server/db/sql.ts'

const [floorPath] = process.argv.slice(2), url = process.env.DATABASE_TEST_URL
if (!floorPath || !url) { console.error('Usage: DATABASE_TEST_URL=… node --no-warnings tests/evidence/forms/floor.ts <floor-worktree>'); process.exit(2) }
const { PostgresWorkspaceRepository: Floor } = await import(`${floorPath}/src/server/postgres-repository.ts`)
const floorSql = await import(`${floorPath}/src/server/db/sql.ts`)
const schema = 'daythread_test_forms', sql = postgres(url, { prepare: false, max: 4, onnotice: () => {} })
await sql.unsafe(`drop schema if exists ${schema} cascade`)
const at = '2026-11-05T10:00:00.000Z'
let failed = 0
const check = (name: string, ok: boolean, detail: unknown = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(detail).slice(0, 400)) }
try {
  const current = new Current(postgresClient(sql), schema), floor = new Floor(floorSql.postgresClient(sql), schema)
  let ws = await current.load()
  const run = async (repo: { execute: Function }, action: object) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }); ws = r.workspace; return r }
  const C = (repo: { execute: Function }, change: object) => run(repo, { type: 'change-database', pageId: 'runs', change })
  await run(current, { type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
  await C(current, { kind: 'addProperty', property: { id: 'km', name: 'Distance', type: 'number' } })
  await C(current, { kind: 'addView', view: { id: 'f', name: 'Log a run', layout: 'form', columns: [], sort: [], filter: [] } })
  const view = () => ws.pages.find(p => p.id === 'runs')!.database!.views.find(v => v.id === 'f')!
  await C(current, { kind: 'updateView', viewId: 'f', form: { ...view().form!, questions: view().form!.questions.map(q => (q.propertyId === 'km' ? { ...q, wording: 'How far?', required: true } : q)), submit: { title: 'Logged' } } })
  await run(current, { type: 'answer-form', databaseId: 'runs', viewId: 'f', pageId: 'ans-1', title: 'Morning', values: { km: 5 }, at })
  const kept = JSON.stringify({ layout: view().layout, form: view().form })

  ws = await floor.load()
  check('the floor loads it', view().layout === 'form' && Boolean(view().form))
  const renamed = await C(floor, { kind: 'updateView', viewId: 'f', name: 'Runs form' })
  await C(floor, { kind: 'updateView', viewId: 'f', sort: [{ by: 'km', direction: 'desc' }] })
  await C(floor, { kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } })
  await run(floor, { type: 'add-row', databaseId: 'runs', pageId: 'r-floor', title: 'From the floor', values: { km: 1 }, at })
  await C(floor, { kind: 'updateView', viewId: 'f', name: 'Log a run' })
  void renamed
  check('the floor kept the layout and the form through its own writes', JSON.stringify({ layout: view().layout, form: view().form }) === kept, { now: { layout: view().layout, form: view().form } })

  ws = await current.load()
  check('this build: the form as it was', JSON.stringify({ layout: view().layout, form: view().form }) === kept)
  check('the floor\'s edits stand', view().sort[0]?.by === 'km' && ws.pages.some(p => p.id === 'r-floor') && ws.pages.find(p => p.id === 'runs')!.database!.properties.some(p => p.id === 'note'))
  await run(current, { type: 'answer-form', databaseId: 'runs', viewId: 'f', pageId: 'ans-2', title: 'Evening', values: { km: 3 }, at })
  check('and it takes answers again', view().form?.responses === 2 && ws.pages.some(p => p.id === 'ans-2'))
} finally {
  await sql.unsafe(`drop schema if exists ${schema} cascade`)
  await sql.end()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
