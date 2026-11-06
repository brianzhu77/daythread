// Independent rerun of the author floor fixture on isolated PGlite, NOT real Postgres.
// Actual floor source: 9417eea2. Usage: node tests/evidence/todo-dependency/ratchet-floor.ts <floor-worktree>
import { PGlite } from '@electric-sql/pglite'
import { PostgresWorkspaceRepository as Current } from '../../../src/server/postgres-repository.ts'
import { pgliteClient } from '../../../src/server/db/sql.ts'
import { blockedNow } from '../../../src/domain/task-links.ts'
import { liveTaskIds, plannedOn } from '../../../src/domain/workspace.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'

const [floorPath] = process.argv.slice(2)
if (!floorPath) { console.error('Usage: DATABASE_TEST_URL=… node --no-warnings tests/evidence/todo-dependency/floor.ts <floor-worktree>'); process.exit(2) }
const { PostgresWorkspaceRepository: Floor } = await import(`${floorPath}/src/server/postgres-repository.ts`)
const floorSql = await import(`${floorPath}/src/server/db/sql.ts`), floorDoc = await import(`${floorPath}/src/domain/editor-document.ts`)
const schema = 'ratchet_links', db = new PGlite(), client = pgliteClient(db)
const sql = { unsafe: (s: string) => client.query(s), end: () => db.close() }
await sql.unsafe(`drop schema if exists ${schema} cascade`)
const today = '2026-11-05', tomorrow = '2026-11-06', at = '2026-11-05T10:00:00.000Z'
let failed = 0
const check = (name: string, ok: boolean, detail: unknown = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(detail).slice(0, 400)) }
try {
  const current = new Current(client, schema), floor = new Floor(floorSql.pgliteClient(db), schema)
  let ws = await current.load()
  const run = async (repo: { execute: Function }, action: object) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }); ws = r.workspace; return r }
  const line = (id: string, title: string, planDate = today) => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate }, content: [{ type: 'text', text: title, styles: {} }], children: [] })
  const save = async (repo: { execute: Function }, seed: Function, contentKey: Function, pageId: string, edit: (doc: any[]) => any[]) => {
    const page = ws.pages.find(p => p.id === pageId)!
    return run(repo, { type: 'save-editor', pageId, expectedContent: contentKey(page), document: JSON.stringify(edit(structuredClone(seed(page, ws)))), today })
  }
  await run(current, { type: 'ensure-day', date: today })
  await save(current, editorSeed, pageContentKey, `day:${today}`, () => [line('a', 'Alpha'), line('b', 'Bravo'), line('c', 'Charlie')])
  const id = (title: string) => ws.tasks.find(t => t.title === title)!.id
  const [A, B, C] = ['Alpha', 'Bravo', 'Charlie'].map(id)
  await run(current, { type: 'link-tasks', taskId: A, add: [B], remove: [], at })
  await run(current, { type: 'link-tasks', taskId: C, add: [A], remove: [], at })
  const links = JSON.stringify(ws.links)
  check('this build: two links, both in force', blockedNow(ws, liveTaskIds(ws)).size === 2, ws.links)

  // The floor, on the same tables.
  ws = await floor.load()
  check('the floor loads', ws.tasks.length === 3)
  await run(floor, { type: 'rename-task', taskId: A, title: 'Alpha renamed' })
  await run(floor, { type: 'task-status', taskId: A, status: 'done', today })
  await run(floor, { type: 'task-status', taskId: A, status: 'open', today })
  await run(floor, { type: 'plan-task', taskId: A, date: tomorrow, from: today, today })
  await run(floor, { type: 'set-task-dates', taskId: B, deadlineOn: '2026-11-20' })
  const lineDays = ws.pages.filter(p => p.type === 'daily').map(p => p.id)
  // A's last line: wherever its plan line is now.
  const home = ws.pages.find(p => (p.document ?? '').includes(A) && p.id === `day:${tomorrow}`) ?? ws.pages.find(p => (p.document ?? '').includes(A))!
  const deleted = await save(floor, floorDoc.editorSeed, floorDoc.pageContentKey, home.id, doc => doc.filter((n: any) => n.props?.taskId !== A))
  const gone = !ws.tasks.some(t => t.id === A) && ws.pages.every(p => !(p.document ?? '').includes(`"taskId":"${A}"`))
  await run(floor, { type: 'undo', targetOperationId: deleted.receipt.operationId })
  check('the floor deleted A\'s last line and undid it', gone && ws.tasks.some(t => t.id === A), { gone, days: lineDays })
  const raw = await sql.unsafe(`select blocked_id, blocker_id from ${schema}.task_links order by created_at, id`)
  check('the floor left the table alone', raw.length === 2, raw)

  // Back on this build.
  ws = await current.load()
  check('this build: the same links', JSON.stringify(ws.links) === links, { now: ws.links, was: links })
  const a = ws.tasks.find(t => t.id === A)!, b = ws.tasks.find(t => t.id === B)!
  check('the floor plan stands', plannedOn(ws, A) === tomorrow, plannedOn(ws, A))
  check('the floor\'s edits stand', a.title === 'Alpha renamed' && a.status === 'open' && b.deadlineOn === '2026-11-20', { a, b })
  const marks = blockedNow(ws, liveTaskIds(ws))
  check('both in force again', marks.get(A)?.by[0]?.id === B && marks.get(C)?.by[0]?.id === A, [...marks])
  // And this build's own delete and Undo of A, through the store's inverse.
  const home2 = ws.pages.find(p => (p.document ?? '').includes(`"taskId":"${A}"`))!
  const del = await save(current, editorSeed, pageContentKey, home2.id, doc => doc.filter((n: any) => n.props?.taskId !== A))
  check('this build: deleting A keeps its links, not in force', ws.links?.length === 2 && blockedNow(ws, liveTaskIds(ws)).size === 0)
  await run(current, { type: 'undo', targetOperationId: del.receipt.operationId })
  ws = await current.load()
  check('and Undo brings them back in force', blockedNow(ws, liveTaskIds(ws)).size === 2, ws.links)
} finally {
  await sql.unsafe(`drop schema if exists ${schema} cascade`)
  await sql.end()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
