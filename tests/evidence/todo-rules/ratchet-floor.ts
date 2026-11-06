// Independent rerun adapted from author's fixture on isolated PGlite, NOT real Postgres. Actual floor 9417eea2.
import { plannedOn } from '../../../src/domain/workspace.ts'
import { PGlite } from '@electric-sql/pglite'
import { PostgresWorkspaceRepository as Current } from '../../../src/server/postgres-repository.ts'
import { pgliteClient } from '../../../src/server/db/sql.ts'
import { writeSteps } from '../../../src/domain/buttons.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'

const [floorPath] = process.argv.slice(2)
if (!floorPath) { console.error('Usage: DATABASE_TEST_URL=… node --no-warnings tests/evidence/todo-rules/floor.ts <floor-worktree>'); process.exit(2) }
const { PostgresWorkspaceRepository: Floor } = await import(`${floorPath}/src/server/postgres-repository.ts`)
const floorSql = await import(`${floorPath}/src/server/db/sql.ts`)
const schema = 'ratchet_rules', db = new PGlite(), client = pgliteClient(db)
const sql = { unsafe: (s: string) => client.query(s), end: () => db.close() }
await sql.unsafe(`drop schema if exists ${schema} cascade`)
const today = '2026-11-05'
let failed = 0
const check = (name: string, ok: boolean, detail: unknown = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(detail).slice(0, 400)) }
try {
  const current = new Current(client, schema), floor = new Floor(floorSql.pgliteClient(db), schema)
  let ws = await current.load()
  const run = async (repo: { execute: Function }, action: object) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }); ws = r.workspace; return r }
  const line = (id: string, title: string) => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate: today }, content: [{ type: 'text', text: title, styles: {} }], children: [] })
  await run(current, { type: 'create-database', pageId: 'log', homeBlockId: null, title: 'Log' })
  await run(current, { type: 'ensure-day', date: today })
  const day = ws.pages.find(p => p.id === `day:${today}`)!
  await run(current, { type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify([line('a', 'Alpha'), line('b', 'Bravo'), line('c', 'Charlie')]), today })
  const steps = writeSteps([{ id: 's', kind: 'add-row', databaseId: 'log', databaseName: 'Log', title: 'Ticked', set: [] }])
  await run(current, { type: 'change-database', pageId: 'source:tasks', change: { kind: 'addAutomation', automation: { id: 'r', name: 'Log a tick', active: true, triggers: [{ kind: 'property-edited', propertyId: 'status', name: 'Status' }], steps } } })
  const id = (title: string) => ws.tasks.find(t => t.title === title)!.id
  await run(current, { type: 'task-status', taskId: id('Alpha'), status: 'done', today })
  const rules = JSON.stringify(ws.todoAutomations)
  const logged = () => ws.pages.filter(p => p.parentId === 'log').length
  check('this build: the rule ran on a tick', logged() === 1)

  ws = await floor.load()
  await run(floor, { type: 'task-status', taskId: id('Bravo'), status: 'done', today })
  await run(floor, { type: 'plan-task', taskId: id('Charlie'), date: '2026-11-06', from: today, today })
  const changed = await run(floor, { type: 'set-week-start', weekStart: 1 })
  await run(floor, { type: 'undo', targetOperationId: changed.receipt.operationId })
  check('the floor ran no rule, as it doesn\'t know them', logged() === 1, logged())
  const [row] = await sql.unsafe(`select todo_automations from ${schema}.workspaces`)
  check('the floor left the column alone', row?.todo_automations === rules, row)

  ws = await current.load()
  check('this build: the rule as it was', JSON.stringify(ws.todoAutomations) === rules, ws.todoAutomations)
  check('the floor planned Charlie', plannedOn(ws, id('Charlie')) === '2026-11-06', plannedOn(ws,id('Charlie')))
  check('the floor\'s edits stand', ws.tasks.find(t => t.title === 'Bravo')!.status === 'done' && (ws.weekStart ?? 0) === 0)
  await run(current, { type: 'task-status', taskId: id('Charlie'), status: 'done', today })
  check('and it runs again', logged() === 2, logged())
} finally {
  await sql.unsafe(`drop schema if exists ${schema} cascade`)
  await sql.end()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
