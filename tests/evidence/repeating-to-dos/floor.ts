// A rollback with repeats (repeating-to-dos.md §4, §7 "The floor build ticks a repeating to-do and deletes its line, and an older tab ticks one against the new server"),
// on a real Postgres, with real writes by the floor build:
// three to-dos on this build (Alpha weekly, Bravo daily, Charlie daily); the floor ticks Alpha and deletes Bravo's last line; back on this build the
// repeats table is untouched, Bravo's repeat is kept and not in force, the mend makes Alpha's missed next one once, an older tab's tick still makes the
// next one, a Cancel with no day is mended, and Undo puts the repeat back.
// Usage: DATABASE_TEST_URL=postgres://… node --no-warnings tests/evidence/repeating-to-dos/floor.ts <floor-worktree>  (a disposable database; its daythread_test_repeats schema is dropped)
import postgres from 'postgres'
import { PostgresWorkspaceRepository as Current } from '../../../src/server/postgres-repository.ts'
import { postgresClient } from '../../../src/server/db/sql.ts'
import { dueTodoRepeats, repeatTaskId, standingRepeats } from '../../../src/domain/todo-repeats.ts'
import { plannedOn } from '../../../src/domain/workspace.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'

const [floorPath] = process.argv.slice(2), url = process.env.DATABASE_TEST_URL
if (!floorPath || !url) { console.error('Usage: DATABASE_TEST_URL=… node --no-warnings tests/evidence/repeating-to-dos/floor.ts <floor-worktree>'); process.exit(2) }
const { PostgresWorkspaceRepository: Floor } = await import(`${floorPath}/src/server/postgres-repository.ts`)
const floorSql = await import(`${floorPath}/src/server/db/sql.ts`), floorDoc = await import(`${floorPath}/src/domain/editor-document.ts`)
const schema = 'daythread_test_repeats', sql = postgres(url, { prepare: false, max: 4, onnotice: () => {} })
await sql.unsafe(`drop schema if exists ${schema} cascade`)
const today = '2026-11-05', at = '2026-11-05T10:00:00.000Z'
let failed = 0
const check = (name: string, ok: boolean, detail: unknown = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(detail).slice(0, 400)) }
try {
  const current = new Current(postgresClient(sql), schema), floor = new Floor(floorSql.postgresClient(sql), schema)
  let ws = await current.load()
  const run = async (repo: { execute: Function }, action: object) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }); ws = r.workspace; return r }
  const line = (id: string, title: string, planDate = today) => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'plan', planDate }, content: [{ type: 'text', text: title, styles: {} }], children: [] })
  const save = async (repo: { execute: Function }, seed: Function, contentKey: Function, pageId: string, edit: (doc: any[]) => any[]) => {
    const page = ws.pages.find(p => p.id === pageId)!
    return run(repo, { type: 'save-editor', pageId, expectedContent: contentKey(page), document: JSON.stringify(edit(structuredClone(seed(page, ws)))), today })
  }
  const rows = async () => JSON.stringify(await sql.unsafe(`select id, task_id, slot, previous_task_id, previous_slot, starts_on, every_unit, every_count, weekdays, counts_from, ends_on, finished_on, created_at from ${schema}.todo_repeats order by id`))
  const repeatOf = (taskId: string) => ws.todoRepeats?.find(r => r.taskId === taskId)
  const onDay = (taskId: string) => ws.pages.find(p => p.type === 'daily' && (p.document ?? '').includes(`"taskId":"${taskId}"`))?.date ?? null

  // 1. This build: three to-dos today, each repeating.
  await run(current, { type: 'ensure-day', date: today })
  await save(current, editorSeed, pageContentKey, `day:${today}`, () => [line('a', 'Alpha'), line('b', 'Bravo'), line('c', 'Charlie')])
  const id = (title: string) => ws.tasks.find(t => t.title === title)!.id
  const [A, B, C] = ['Alpha', 'Bravo', 'Charlie'].map(id)
  await run(current, { type: 'set-todo-repeat', taskId: A, repeat: { every: 'week', interval: 1, from: 'schedule' }, today, at })
  await run(current, { type: 'set-todo-repeat', taskId: B, repeat: { every: 'day', interval: 1, from: 'schedule' }, today, at })
  await run(current, { type: 'set-todo-repeat', taskId: C, repeat: { every: 'day', interval: 1, from: 'schedule' }, today, at })
  const stored = await rows(), repeatIds = { A: repeatOf(A)!.id, B: repeatOf(B)!.id, C: repeatOf(C)!.id }
  check('this build: three repeats, standing', ws.todoRepeats?.length === 3 && standingRepeats(ws).length === 3, ws.todoRepeats)

  // 2. The floor, on the same tables: it ticks Alpha (no next one) and deletes Bravo's last line.
  ws = await floor.load()
  check('the floor loads', ws.tasks.length === 3, ws.tasks.length)
  const ticked = await run(floor, { type: 'task-status', taskId: A, status: 'done', today })
  check('the floor ticked Alpha and made no next one', ws.tasks.find(t => t.id === A)?.status === 'done' && ws.tasks.length === 3 && !ticked.receipt?.nextTodos?.length, ticked.receipt)
  await save(floor, floorDoc.editorSeed, floorDoc.pageContentKey, `day:${today}`, doc => doc.filter((n: any) => n.props?.taskId !== B))
  check('the floor deleted Bravo\'s last line, and Bravo with it', !ws.tasks.some(t => t.id === B) && ws.pages.every(p => !(p.document ?? '').includes(`"taskId":"${B}"`)), ws.tasks.map(t => t.title))

  // 3. Raw SQL: the repeats table is as this build left it.
  const raw = await sql.unsafe(`select id from ${schema}.todo_repeats`)
  check('the floor left todo_repeats alone: three rows, unchanged', raw.length === 3 && (await rows()) === stored, { raw: raw.length })

  // 4. Back on this build.
  ws = await current.load()
  check('this build: three repeats, two stand (Bravo\'s is kept, not in force)', ws.todoRepeats?.length === 3 && standingRepeats(ws).length === 2 && !standingRepeats(ws).some(r => r.id === repeatIds.B), { all: ws.todoRepeats?.length, standing: standingRepeats(ws).length })
  const due = dueTodoRepeats(ws, today)
  check('the mend names Alpha\'s repeat only', due.length === 1 && due[0]!.repeat.id === repeatIds.A && due[0]!.on >= today, due)

  // 5. run-repeats makes Alpha's next one, once.
  await run(current, { type: 'run-repeats', today, time: '09:00', at })
  const made = repeatOf(repeatTaskId(repeatIds.A, due[0]!.on)), nextId = made?.taskId ?? ''
  const nextDay = onDay(nextId)
  check('run-repeats: Alpha\'s next one exists, planned on a day from today, with its line on that page', Boolean(made) && ws.tasks.some(t => t.id === nextId) && plannedOn(ws, nextId) === due[0]!.on && nextDay !== null && nextDay >= today, { made, nextDay, due: due[0]!.on })
  // The to-dos and where each repeat stands, not the repeats' key order (a saved copy and a loaded one differ there).
  const standing = () => JSON.stringify([ws.tasks.map(t => t.id).sort(), (ws.todoRepeats ?? []).map(r => `${r.id}:${r.taskId}:${r.slot}`).sort()])
  const afterFirst = standing()
  await run(current, { type: 'run-repeats', today, time: '09:00', at })
  check('a second run-repeats makes nothing', standing() === afterFirst, ws.tasks.length)
  check('the mend left Charlie\'s repeat as it was', ws.todoRepeats?.find(r => r.id === repeatIds.C)?.taskId === C, ws.todoRepeats)

  // 6. An older tab against this server: its tick sends today, so the server makes the next one; the tab shows its plain "Task completed" and nothing more.
  const tick = await run(current, { type: 'task-status', taskId: C, status: 'done', today })
  const nextC = tick.receipt?.nextTodos
  check('an older tab\'s tick of Charlie: "Done" and one next to-do', tick.receipt?.message === 'Done' && nextC?.length === 1 && ws.tasks.some(t => t.id === nextC[0]!.taskId), tick.receipt)

  // 7. This build's Undo of that tick puts the repeat back on Charlie, and takes the next one away. (Undo reaches the latest change only, so it comes
  // before the Cancel below.)
  await run(current, { type: 'undo', targetOperationId: tick.receipt.operationId })
  ws = await current.load()
  check('this build: Undo of the tick puts the repeat back on Charlie and takes the next one away', repeatOf(C)?.id === repeatIds.C && ws.tasks.find(t => t.id === C)?.status === 'open' && !ws.tasks.some(t => t.id === nextC![0]!.taskId) && !repeatOf(nextC![0]!.taskId), { repeat: ws.todoRepeats?.find(r => r.id === repeatIds.C), tasks: ws.tasks.length })

  // The same tab's Cancel sends no day (no Cancel does in an older build): nothing is made, and the next run-repeats makes it.
  const cancel = await run(current, { type: 'task-status', taskId: C, status: 'cancelled' })
  check('a Cancel with no day makes no next one', cancel.receipt?.message === 'Cancelled' && !cancel.receipt?.nextTodos?.length && repeatOf(C)?.taskId === C, cancel.receipt)
  const mend = dueTodoRepeats(ws, today).find(d => d.repeat.id === repeatIds.C)
  await run(current, { type: 'run-repeats', today, time: '09:00', at })
  const nextCancelled = mend ? repeatOf(repeatTaskId(repeatIds.C, mend.on)) : undefined
  check('the next run-repeats makes it, on a day from today', Boolean(mend && nextCancelled) && mend!.on >= today && ws.tasks.some(t => t.id === nextCancelled!.taskId), { mend: mend?.on, nextCancelled })
} finally {
  await sql.unsafe(`drop schema if exists ${schema} cascade`)
  await sql.end()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
