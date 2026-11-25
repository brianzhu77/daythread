// What the 1,000-repeat limit costs (repeating-to-dos.md §6 "Bound the number per workspace", §7 "the tick's real speed on a repeating to-do"):
// a workspace of 1,001 to-dos over ten day pages, timed with no repeat and with 1,000, as the median of 21 runs each.
// No browser and no database: the domain commands and the screen's pure functions, as the server and the page run them.
// Usage: node --no-warnings tests/evidence/repeating-to-dos/limit.ts   (prints one JSON object; times are milliseconds)
import { applyCommand, createEmptyWorkspace } from '../../../src/domain/workspace.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { addDays } from '../../../src/domain/database.ts'
import { dueTodoRepeats, todoRepeatLimits } from '../../../src/domain/todo-repeats.ts'
import { repeatPages, repeatsIn } from '../../../src/components/todo-repeat-view.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const today = '2026-11-23', at = '2026-11-23T10:00:00.000Z', runs = 21, pages = 10, total = todoRepeatLimits.total + 1
let revision = 0
const apply = (ws: Workspace, action: Action) => applyCommand(ws, { operationId: `op-${++revision}`, expectedRevision: ws.revision, action }).workspace
const line = (n: number, day: string) => ({ id: `line-${n}`, type: 'task', props: { taskId: `editor-task:line-${n}`, role: 'plan', planDate: day }, content: [{ type: 'text', text: `To-do ${n}`, styles: {} }], children: [] })

/** 1,001 to-dos over ten day pages, today and the nine days after it. */
function build(): Workspace {
  let ws = createEmptyWorkspace()
  for (let d = 0; d < pages; d++) {
    const day = addDays(today, d)
    ws = apply(ws, { type: 'ensure-day', date: day })
    const page = ws.pages.find(p => p.id === `day:${day}`)!
    const lines = Array.from({ length: total }, (_, n) => n).filter(n => n % pages === d).map(n => line(n, day))
    ws = apply(ws, { type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify(lines), today })
  }
  return ws
}
/** The first `count` to-dos repeat daily; the last one never does. */
function repeating(base: Workspace, count: number): Workspace {
  let ws = base
  for (let n = 0; n < count; n++) ws = apply(ws, { type: 'set-todo-repeat', taskId: idOf(ws, n), repeat: { every: 'day', interval: 1, from: 'schedule' }, today, at })
  return ws
}
const idOf = (ws: Workspace, n: number) => ws.tasks.find(t => t.title === `To-do ${n}`)!.id

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
const round = (n: number) => Math.round(n * 100) / 100
/** `run` gets a fresh structuredClone of `ws` each time; only the call is timed. */
function time(ws: Workspace, run: (fresh: Workspace) => unknown): number {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const fresh = structuredClone(ws)
    const start = performance.now()
    run(fresh)
    samples.push(performance.now() - start)
  }
  return round(median(samples))
}
const tick = (taskId: string): Action => ({ type: 'task-status', taskId, status: 'done', today })

function measure(ws: Workspace, count: number) {
  const never = idOf(ws, total - 1), first = idOf(ws, 0)
  const nextCreated = (fresh: Workspace) => applyCommand(fresh, { operationId: `timed-${++revision}`, expectedRevision: fresh.revision, action: tick(first) }).receipt.nextTodos?.length ?? 0
  if (count > 0 && nextCreated(structuredClone(ws)) !== 1) throw new Error('the tick of a repeating to-do made no next one: the timing would mean nothing')
  return {
    repeats: ws.todoRepeats?.length ?? 0,
    tickNeverRepeats: time(ws, fresh => applyCommand(fresh, { operationId: `timed-${++revision}`, expectedRevision: fresh.revision, action: tick(never) })),
    tickRepeating: count > 0 ? time(ws, fresh => applyCommand(fresh, { operationId: `timed-${++revision}`, expectedRevision: fresh.revision, action: tick(first) })) : null,
    repeatsIn: time(ws, fresh => repeatsIn(fresh)),
    dueTodoRepeats: time(ws, fresh => dueTodoRepeats(fresh, today)),
    repeatPagesForATick: time(ws, fresh => repeatPages(fresh, tick(first))),
    todoRepeatsJsonBytes: JSON.stringify(ws.todoRepeats ?? []).length,
  }
}

const plain = build()
const full = repeating(plain, todoRepeatLimits.total)
console.log(JSON.stringify({ todos: plain.tasks.length, dayPages: pages, runs, medianMs: { noRepeats: measure(plain, 0), withRepeats: measure(full, todoRepeatLimits.total) } }, null, 2))
