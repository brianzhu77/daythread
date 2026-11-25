# Repeating to-dos, phase 2 (the screen): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brian can set, see, change and turn off a to-do's repeat from the screen. The notice names the next day, and
a to-do with no repeat looks and behaves exactly as it does today.

**Architecture:** Everything a test can decide lives in one pure module (`src/components/todo-repeat-view.ts`): the
words, the editor's field-to-rule mapping, the index behind the icon, and which pages a command must hold. Three small
seams carry the rest:

- `drawnWorkspace` in `draw-ahead.ts` keeps anything a repeat does off screen until the server answers.
- `sendHolding` in `editor-flush.ts` sends a command the way row actions do (flush, hold, command, apply) through every
  open editor whose page it rewrites.
- `noticeWithNext` is applied once, inside `run`.

The screen itself is one new component file (`todo-repeat.tsx`), modelled on `blockers.tsx`.

**Tech Stack:** TanStack Start, React 19, TypeScript run by Node 24 type stripping in tests, `node:test`, HeroUI v3 and
`@floating-ui/react` through the existing `EditorShell`, Playwright (already a devDependency) for evidence scripts.

**Spec:** `docs/design/repeating-to-dos.md` (approved by Brian 2026-11-24). §3 is what this phase builds, §4 the rules,
§5 the four "it fails" conditions, §6 the builder's notes, §7 the release checks. The prototype Brian saw is the
reference for structure and copy only. Do not copy its code.

**Phase 3** (export, and a read-only Repeat column in To-dos views) is not in this plan.

## Global Constraints

- English only. No new dependency. Do not install Playwright browsers. If a browser script cannot run where you are,
  say so in your report; Task 10 runs them.
- Erasable TypeScript only. Value imports carry the `.ts` extension in any file a test reaches
  (`todo-repeat-view.ts`, `draw-ahead.ts`, `editor-flush.ts`). `.tsx` files import them without it, as the rest of
  `src/components` does.
- **A to-do with no repeat must not change in any way.** The whole existing suite stays green and untouched. Each
  task says how it protects this.
- Copy is exact, with a straight apostrophe as phase 1's `repeatWords` has it:
  - Menu and icon: `Repeat…`, `Repeat · Every week…`, `Repeats every week` (accessible name and `title`).
  - Fields: `Repeat`, `Every`, `From`, `Ends`.
  - Options: `Off`, `Daily`, `Weekly`, `Monthly`, `Yearly`, `Its day`, `When it's done`, `Never`, `On a date`.
  - Last line: `Next Mon, Dec 7`, `Next Sun, Nov 29 if done today`, `Ends after this one`.
  - Notices: `Task completed · Next Mon, Dec 7`, `Done · Next Mon, Dec 7`, `Cancelled · Next Mon, Dec 14`.
  - The sheet's `Done`. `…` is U+2026 and `·` is U+00B7.
- Tests run as CI does: `TZ=America/Vancouver node --test <file>`. Typecheck: `npm run typecheck`.
- Commits: `feat(repeats): …` / `test(repeats): …`, one per task. Do not push. Do not open a PR.
- The test files Task 1 writes are the spec in executable form. **Never change an asserted value or message in them to
  make a test pass.** If a test fails because of its own setup, fix the setup and say so in the report. If a test
  seems to contradict the spec, stop and report it.
- Do not edit `tests/todo-repeats.test.ts`, `tests/todo-repeats-schedule.test.ts` or
  `tests/todo-repeats-storage.test.ts`.

## Review Focus

No task's node tests exercise these. Each is attached to the task whose reviewer must look for it.

1. A second tap on the box while the hold is still saving the other page's words, before the tick is stored: ignored,
   one Done write, one next to-do (Task 5; `hold.mjs` H5).
2. The held editor closes mid-way (a peek shut, the page left): the tick still lands once, nothing is set on a dead
   editor, and the notice still shows (Task 5; `left.current` in `held`).
3. The mend is due while today's page mounted with a recovered draft (dirty from its first render): the mend still
   runs once, and the page shows either no conflict or its existing one with the words kept, never a lost line
   (Task 5).
4. `set-todo-repeat` is drawn ahead and then refused by the server (the limit reached elsewhere, the to-do ticked on
   another device): the icon and the menu's words go back, and the refusal is said once in its own words. It is not
   `Repeat not saved · can’t do this now`, and not said twice (Task 7).
5. Week starts on Monday (`weekStart: 1`): the weekday row starts with M, and `Next …` is the day the server then
   makes. Every node test here runs with Sunday (Task 7).

## File structure

| File | Responsibility |
| --- | --- |
| `tests/todo-repeat-view.test.ts`, `tests/todo-repeat-draw.test.ts`, `tests/editor-hold.test.ts`, `tests/todo-repeats-mend-guard.test.ts` (create) | The behaviour, written first. |
| `src/domain/workspace.ts` (modify) | `run-repeats`: one repeat that throws no longer refuses the command. |
| `src/components/todo-repeat-view.ts` (create) | Pure: words, the editor's mapping, the icon's index, pages to hold, the mend's key. Imports domain modules and types only. Never React. |
| `src/components/draw-ahead.ts` (modify) | `drawnWorkspace`: a pending change as drawn, with nothing a repeat does. |
| `src/components/editor-flush.ts` (modify) | The hold registry and `sendHolding`. |
| `src/components/use-day.tsx` (modify) | `predicted(true)` draws through `drawnWorkspace`; `runHeld`; the notice's words and its Undo's holds. |
| `src/components/app-shell.tsx` (modify) | The mend is asked once per set of due repeats, and sent held; `RepeatEditorHost`. |
| `src/components/page-editor.tsx` (modify) | `held` (from `onServer`), its registration; `Repeat…` in both menus; the mark on a line; Cancel's notice. |
| `src/components/repeat-fields.tsx` (create) | `RepeatEvery`, `RepeatWeekdays` and their names, moved from `database-menu.tsx` unchanged so both editors share them. |
| `src/components/todo-repeat.tsx` (create) | `RepeatMark`, `openRepeatEditor`, `RepeatEditorHost`. |
| `src/components/property-editors.tsx`, `icons.tsx`, `blockers.tsx`, `database-menu.tsx`, `tasks-screen.tsx`, `task-row.tsx`, `database-block.tsx`, `src/styles.css` (modify) | One export or a few lines each, named in the tasks. |
| `tests/evidence/repeating-to-dos/*` (create) | Seed, screen checks, the hold checks, R1-18 weight, the limit, the floor run, pixels. |
| `scripts/align-fixtures.ts`, `scripts/check-alignment.mjs` (modify) | One repeating fixture row; the mark measured on its first line. |

---

### Task 1: The behaviour tests, failing (mechanical)

**Files:**
- Create: `tests/todo-repeat-view.test.ts`, `tests/todo-repeat-draw.test.ts`, `tests/editor-hold.test.ts`,
  `tests/todo-repeats-mend-guard.test.ts`

**Interfaces:**
- Consumes: `tests/v2-helpers.ts` (`harness`, `dayId`, `todo`); phase 1's `set-todo-repeat`, `task-status`,
  `edit-todos`, `run-repeats`; `capture` from `src/components/outbox.ts`.
- Produces: the names later tasks must export, exactly as imported below.

- [ ] **Step 1: `tests/todo-repeat-view.test.ts`.**

```ts
// Repeating to-dos, the screen (docs/design/repeating-to-dos.md §3): its words, the editor's fields, the index behind
// the icon and what a command must hold, as pure functions. The copy and the dates are the design's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mendKey, nextDayLabel, nextLine, noticeWithNext, repeatFields, repeatMarkName, repeatMenuLabel, repeatPages, repeatsIn, ruleAfter, undoHoldPages, type RepeatEdit } from '../src/components/todo-repeat-view.ts'
import { dueTodoRepeats, type TodoRepeat, type TodoRepeatRule } from '../src/domain/todo-repeats.ts'
import type { Action, Workspace } from '../src/domain/types.ts'
import { dayId, harness, todo } from './v2-helpers.ts'

type H = ReturnType<typeof harness>
// Nov 23, 2026 is a Monday.
const mon = '2026-11-23', tue = '2026-11-24', sat = '2026-11-28', nextMon = '2026-11-30', dec7 = '2026-12-07', dec14 = '2026-12-14'
const at = '2026-11-23T10:00:00.000Z'
const weekly: TodoRepeatRule = { every: 'week', interval: 1, from: 'schedule' }
const repeat = (over: Partial<TodoRepeat> = {}): TodoRepeat => ({ id: 'r', taskId: 't', slot: mon, start: mon, every: 'week', interval: 1, from: 'schedule', createdAt: at, ...over })

/** To-dos planned on Monday's page, one per title. */
function setup(...titles: string[]) {
  const h = harness()
  h.day(mon)
  h.save(dayId(mon), d => [...d, ...titles.map((title, i) => todo(`r-${i}`, title, 'plan', mon))], { today: mon })
  return h
}
const setRepeat = (h: H, taskId: string, rule: TodoRepeatRule = weekly) => h.run({ type: 'set-todo-repeat', taskId, repeat: rule, today: mon, at })
const status = (taskId: string, to: 'done' | 'cancelled' | 'open', today: string | null = mon) => ({ type: 'task-status', taskId, status: to, ...(today ? { today } : {}) }) as Action
/** The floor build's tick: done, and the repeat still names it. */
const floorTick = (h: H, taskId: string) => { h.ws = { ...h.ws, tasks: h.ws.tasks.map(t => (t.id === taskId ? { ...t, status: 'done' as const, doneOn: mon, version: t.version + 1 } : t)) } }
/** Pages that were there before and whose document the command rewrote. */
const rewritten = (before: Workspace, after: Workspace) => before.pages.filter(p => after.pages.find(q => q.id === p.id)?.document !== p.document).map(p => p.id)

test('the menu item and the icon say the rule', () => {
  assert.equal(repeatMenuLabel(undefined), 'Repeat…')
  assert.equal(repeatMenuLabel(weekly), 'Repeat · Every week…')
  assert.equal(repeatMenuLabel({ every: 'week', interval: 2, weekdays: [1, 4], from: 'schedule' }), 'Repeat · Every 2 weeks on Mon, Thu…')
  assert.equal(repeatMenuLabel({ every: 'day', interval: 5, from: 'done' }), "Repeat · Every 5 days, from when it's done…")
  assert.equal(repeatMarkName(weekly), 'Repeats every week')
})

test('a notice keeps its own words and adds the day when the command made exactly one next to-do', () => {
  const made = (on: string) => ({ nextTodos: [{ taskId: 'x', on }] })
  assert.equal(noticeWithNext('Task completed', made(dec7), tue), 'Task completed · Next Mon, Dec 7')
  assert.equal(noticeWithNext('Done', made(dec7), tue), 'Done · Next Mon, Dec 7')
  assert.equal(noticeWithNext('Cancelled', made(dec14), tue), 'Cancelled · Next Mon, Dec 14')
  assert.equal(noticeWithNext('Done', {}, tue), 'Done', 'no repeat: the words it has today')
  assert.equal(noticeWithNext('3 to-dos changed', { nextTodos: [{ taskId: 'x', on: dec7 }, { taskId: 'y', on: dec14 }] }, tue), '3 to-dos changed')
  assert.equal(nextDayLabel(dec7, tue), 'Mon, Dec 7')
  assert.equal(noticeWithNext('Done', made('2027-11-24'), tue), 'Done · Next Wed, Nov 24, 2027', 'another year says so')
})

test("the editor's last line: the next day, 'if done today' when it counts from the finish, and no day once it has ended", () => {
  assert.equal(nextLine(repeat({ slot: nextMon }), tue), 'Next Mon, Dec 7')
  assert.equal(nextLine(repeat(), tue), 'Next Mon, Nov 30')
  assert.equal(nextLine(repeat({ every: 'day', interval: 5, from: 'done', slot: tue, start: tue }), tue), 'Next Sun, Nov 29 if done today')
  assert.equal(nextLine(repeat({ until: '2026-11-29' }), tue), 'Ends after this one')
  assert.equal(nextLine(repeat({ every: 'year', slot: tue, start: tue }), tue), 'Next Wed, Nov 24, 2027')
})

test('the fields the editor shows, for a repeat and for none', () => {
  assert.deepEqual(repeatFields(undefined), { every: 'off', interval: 1, showWeekdays: false, from: 'schedule', ends: 'never', until: '' })
  assert.deepEqual(repeatFields(repeat()), { every: 'week', interval: 1, showWeekdays: true, from: 'schedule', ends: 'never', until: '' })
  assert.equal(repeatFields(repeat({ from: 'done' })).showWeekdays, false, "weekdays aren't offered with When it's done")
  assert.deepEqual(repeatFields(repeat({ every: 'month', interval: 3, until: '2027-01-31' })), { every: 'month', interval: 3, showWeekdays: false, from: 'schedule', ends: 'date', until: '2027-01-31' })
})

test('one edit in the editor is one rule to send', () => {
  // Off to a rhythm: every 1, from its day, never ending.
  assert.deepEqual(ruleAfter(undefined, { field: 'every', value: 'week' }, tue), weekly)
  assert.equal(ruleAfter(undefined, { field: 'every', value: 'off' }, tue), undefined, 'nothing to turn off')
  assert.equal(ruleAfter(undefined, { field: 'interval', value: 2 }, tue), undefined)
  assert.equal(ruleAfter(repeat(), { field: 'every', value: 'off' }, tue), null)
  // A new rhythm keeps Every, From and Ends, and drops the weekdays.
  assert.deepEqual(ruleAfter(repeat({ interval: 2, weekdays: [1, 4], until: '2027-01-01' }), { field: 'every', value: 'month' }, tue), { every: 'month', interval: 2, from: 'schedule', until: '2027-01-01' })
  assert.deepEqual(ruleAfter(repeat(), { field: 'interval', value: 2 }, tue), { every: 'week', interval: 2, from: 'schedule' })
  for (const bad of [0, 1000, 1.5, Number.NaN]) assert.equal(ruleAfter(repeat(), { field: 'interval', value: bad }, tue), undefined, String(bad))
  // Weekdays: sorted, once each; its own day alone is what no weekdays says.
  assert.deepEqual(ruleAfter(repeat(), { field: 'weekdays', value: [4, 1, 4] }, tue), { every: 'week', interval: 1, weekdays: [1, 4], from: 'schedule' })
  assert.deepEqual(ruleAfter(repeat({ weekdays: [1, 4] }), { field: 'weekdays', value: [1] }, tue), weekly)
  assert.deepEqual(ruleAfter(repeat({ weekdays: [1, 4] }), { field: 'weekdays', value: [4] }, tue), { every: 'week', interval: 1, weekdays: [4], from: 'schedule' })
  assert.equal(ruleAfter(repeat(), { field: 'weekdays', value: [] }, tue), undefined, 'a weekly repeat always has a day')
  assert.equal(ruleAfter(repeat({ every: 'day' }), { field: 'weekdays', value: [1, 4] }, tue), undefined)
  // "When it's done" keeps no weekdays.
  assert.deepEqual(ruleAfter(repeat({ weekdays: [1, 4] }), { field: 'from', value: 'done' }, tue), { every: 'week', interval: 1, from: 'done' })
  // Ends: four weeks after the later of its own day and today, until he picks; Never takes it off.
  assert.deepEqual(ruleAfter(repeat(), { field: 'ends', value: 'date' }, tue), { ...weekly, until: '2026-12-22' })
  assert.deepEqual(ruleAfter(repeat({ slot: nextMon }), { field: 'ends', value: 'date' }, tue), { ...weekly, until: '2026-12-28' })
  assert.deepEqual(ruleAfter(repeat({ until: '2026-12-22' }), { field: 'until', value: '2027-03-01' }, tue), { ...weekly, until: '2027-03-01' })
  assert.deepEqual(ruleAfter(repeat({ until: '2026-12-22' }), { field: 'ends', value: 'never' }, tue), weekly)
  assert.equal(ruleAfter(repeat({ until: '2026-12-22' }), { field: 'until', value: '' }, tue), undefined, 'a cleared date field sends nothing')
  // The same rule again sends nothing: the command would refuse it ("Nothing to change").
  assert.equal(ruleAfter(repeat(), { field: 'interval', value: 1 }, tue), undefined)
  assert.equal(ruleAfter(repeat(), { field: 'weekdays', value: [1] }, tue), undefined)
  assert.equal(ruleAfter(repeat(), { field: 'from', value: 'schedule' }, tue), undefined)
})

test('every rule the editor sends is one the command takes, each with its own Undo', () => {
  const h = setup('Weekly review'), id = h.task('Weekly review').id
  const now = () => repeatsIn(h.ws).get(id)
  const send = (edit: RepeatEdit) => {
    const rule = ruleAfter(now(), edit, tue)
    assert.notEqual(rule, undefined, JSON.stringify(edit))
    return h.run({ type: 'set-todo-repeat', taskId: id, repeat: rule as TodoRepeatRule | null, today: tue, at }).receipt
  }
  assert.equal(send({ field: 'every', value: 'week' }).message, 'Repeats every week')
  assert.equal(now()?.slot, mon, 'its own day, not the day he set it')
  assert.equal(send({ field: 'interval', value: 2 }).message, 'Repeats every 2 weeks')
  assert.equal(send({ field: 'weekdays', value: [1, 4] }).message, 'Repeats every 2 weeks on Mon, Thu')
  assert.equal(send({ field: 'from', value: 'done' }).message, "Repeats every 2 weeks, from when it's done")
  send({ field: 'ends', value: 'date' })
  assert.equal(now()?.until, '2026-12-22')
  const until = send({ field: 'until', value: '2027-03-01' })
  assert.equal(now()?.until, '2027-03-01')
  h.run({ type: 'undo', targetOperationId: until.operationId })
  assert.equal(now()?.until, '2026-12-22', 'one Undo, one edit')
  send({ field: 'ends', value: 'never' })
  assert.equal(now()?.until, undefined)
  assert.equal(send({ field: 'every', value: 'off' }).message, 'Repeat off')
  assert.equal(now(), undefined)
  assert.equal(h.ws.todoRepeats, undefined)
})

test('the index behind the icon: once per copy of the workspace, open current ones only, nothing where no to-do repeats', () => {
  const plain = setup('Alpha'), other = setup('Bravo')
  assert.equal(repeatsIn(plain.ws).size, 0)
  assert.equal(repeatsIn(plain.ws), repeatsIn(other.ws), 'one shared empty map: a workspace with no repeat pays nothing')
  const h = setup('Weekly review', 'Alpha'), id = h.task('Weekly review').id
  setRepeat(h, id)
  const index = repeatsIn(h.ws)
  assert.deepEqual([...index.keys()], [id])
  assert.equal(index.get(id)?.every, 'week')
  assert.equal(repeatsIn(h.ws), index, 'worked out once for this copy')
  const made = h.run(status(id, 'done')).receipt.nextTodos![0]!
  assert.deepEqual([...repeatsIn(h.ws).keys()], [made.taskId], 'the finished one carries none; the next one does')
  // Its to-do deleted: the repeat is kept, not in force.
  h.save(dayId(nextMon), d => d.filter(n => n.props?.taskId !== made.taskId), { today: mon })
  assert.equal(repeatsIn(h.ws).size, 0)
  assert.equal(h.ws.todoRepeats?.length, 1)
  const floor = setup('Weekly review'), floorId = floor.task('Weekly review').id
  setRepeat(floor, floorId)
  floorTick(floor, floorId)
  assert.equal(repeatsIn(floor.ws).size, 0, 'finished and still named by its repeat: no icon')
})

test('the pages a command rewrites because of a repeat are the ones the reducer rewrites, and none without a repeat', () => {
  const h = setup('Weekly review', 'Alpha'), id = h.task('Weekly review').id, alpha = h.task('Alpha').id
  assert.deepEqual(repeatPages(h.ws, status(id, 'done')), [], 'no repeat anywhere')
  setRepeat(h, id)
  assert.deepEqual(repeatPages(h.ws, status(alpha, 'done')), [], 'a to-do that does not repeat')
  assert.deepEqual(repeatPages(h.ws, status(id, 'done')), [], 'its next day has no page yet, so no editor can be open on it')
  h.day(nextMon)
  const before = h.ws
  assert.deepEqual(repeatPages(before, status(id, 'done')), [dayId(nextMon)])
  assert.deepEqual(repeatPages(before, status(id, 'cancelled')), [dayId(nextMon)])
  assert.deepEqual(repeatPages(before, status(id, 'cancelled', null)), [], 'a Cancel with no day makes nothing')
  assert.deepEqual(repeatPages(before, { type: 'edit-todos', items: [{ taskId: id, changes: [{ columnId: 'status', value: 'done' }] }], today: mon }), [dayId(nextMon)])
  assert.deepEqual(repeatPages(before, { type: 'plan-task', taskId: id, date: tue, today: mon }), [])
  h.run(status(id, 'done'))
  assert.deepEqual(rewritten(before, h.ws), [dayId(nextMon)], 'the reducer agrees')
  // Reopening takes the next one's line back off that page.
  const ticked = h.ws
  assert.deepEqual(repeatPages(ticked, status(id, 'open')), [dayId(nextMon)])
  h.run(status(id, 'open'))
  assert.deepEqual(rewritten(ticked, h.ws), [dayId(nextMon)])
  // An ended repeat makes nothing.
  h.run({ type: 'set-todo-repeat', taskId: id, repeat: { ...weekly, until: '2026-11-29' }, today: mon, at })
  assert.deepEqual(repeatPages(h.ws, status(id, 'done')), [])
})

test('the mend: the day pages it will write, and a key that asks once for each set of due repeats', () => {
  const h = setup('Weekly review'), id = h.task('Weekly review').id
  setRepeat(h, id)
  h.day(nextMon)
  floorTick(h, id)
  const mend: Action = { type: 'run-repeats', today: sat, time: '09:00', at }
  assert.deepEqual(repeatPages(h.ws, mend), [dayId(nextMon)])
  const due = dueTodoRepeats(h.ws, sat)
  assert.equal(mendKey(due), `${due[0]!.repeat.id}@${nextMon}`)
  assert.equal(mendKey([{ repeat: repeat({ id: 'b' }), on: mon }, { repeat: repeat({ id: 'a' }), on: tue }]), 'a@2026-11-24 b@2026-11-23', 'the same set in any order is the same key')
  assert.equal(mendKey([]), '')
  const before = h.ws
  h.run(mend)
  assert.deepEqual(rewritten(before, h.ws), [dayId(nextMon)])
  assert.deepEqual(repeatPages(h.ws, mend), [])
  assert.equal(mendKey(dueTodoRepeats(h.ws, sat)), '')
})

test('what an Undo must hold: the pages the command was held for, and wherever the next one it made has a line now', () => {
  const h = setup('Weekly review'), id = h.task('Weekly review').id
  setRepeat(h, id)
  const done = h.run(status(id, 'done'))
  assert.deepEqual(undoHoldPages(h.ws, done.receipt, []), [dayId(nextMon)], 'the page the tick made')
  assert.deepEqual(undoHoldPages(h.ws, done.receipt, [dayId(nextMon), 'p']), [dayId(nextMon), 'p'])
  assert.deepEqual(undoHoldPages(h.ws, {}, []), [])
})
```

- [ ] **Step 2: `tests/todo-repeat-draw.test.ts`.**

```ts
// What is drawn before the server answers (repeating-to-dos.md §3): the tick, at once; never the next to-do or its line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawnWorkspace } from '../src/components/draw-ahead.ts'
import { capture } from '../src/components/outbox.ts'
import { repeatsIn } from '../src/components/todo-repeat-view.ts'
import { repeatTaskId, type TodoRepeatRule } from '../src/domain/todo-repeats.ts'
import type { Action, Command, Workspace } from '../src/domain/types.ts'
import { applyCommand } from '../src/domain/workspace.ts'
import { dayId, harness, todo } from './v2-helpers.ts'

// Nov 23, 2026 is a Monday.
const mon = '2026-11-23', sat = '2026-11-28', nextMon = '2026-11-30'
const at = '2026-11-23T10:00:00.000Z'
const weekly: TodoRepeatRule = { every: 'week', interval: 1, from: 'schedule' }
/** A weekly to-do and a plain one on Monday's page; next Monday's page is there too. */
function setup(repeating = true) {
  const h = harness()
  h.day(mon)
  h.save(dayId(mon), d => [...d, todo('r-1', 'Weekly review', 'plan', mon), todo('r-2', 'Alpha', 'plan', mon)], { today: mon })
  const id = h.task('Weekly review').id
  if (repeating) h.run({ type: 'set-todo-repeat', taskId: id, repeat: weekly, today: mon, at })
  h.day(nextMon)
  return { h, id, alpha: h.task('Alpha').id }
}
const command = (ws: Workspace, action: Action, operationId = 'drawn-1'): Command => ({ operationId, expectedRevision: ws.revision, action })
const status = (taskId: string, to: 'done' | 'cancelled' | 'open' = 'done') => ({ type: 'task-status', taskId, status: to, today: mon }) as Action
const lines = (ws: Workspace) => ws.pages.map(p => [p.id, p.document])
const stateOf = (ws: Workspace, id: string) => { const t = ws.tasks.find(x => x.id === id)!; return { status: t.status, doneOn: t.doneOn } }

test('a tick not yet answered is drawn as the tick alone: no next to-do, no line, no page touched', () => {
  const { h, id } = setup(), before = h.ws
  for (const action of [status(id), status(id, 'cancelled'), { type: 'edit-todos', items: [{ taskId: id, changes: [{ columnId: 'status', value: 'done' }] }], today: mon } as Action]) {
    const drawn = drawnWorkspace(before, command(before, action))
    assert.notEqual(stateOf(drawn, id).status, 'open', action.type)
    assert.equal(drawn.tasks.length, before.tasks.length, 'no next to-do')
    assert.deepEqual(lines(drawn), lines(before), 'no page document changes')
    assert.deepEqual(drawn.todoRepeats, before.todoRepeats)
    assert.equal(drawn.revision, before.revision + 1)
    assert.equal(repeatsIn(drawn).size, 0, 'the finished one carries no icon')
  }
  assert.deepEqual(stateOf(drawnWorkspace(before, command(before, status(id))), id), { status: 'done', doneOn: mon })
})

test('a reopen not yet answered leaves the next one on screen, and the mend draws nothing', () => {
  const { h, id } = setup()
  h.run(status(id))
  const ticked = h.ws
  const reopened = drawnWorkspace(ticked, command(ticked, status(id, 'open')))
  assert.equal(stateOf(reopened, id).status, 'open')
  assert.equal(reopened.tasks.length, ticked.tasks.length)
  assert.deepEqual(lines(reopened), lines(ticked))
  const floor = setup()
  floor.h.ws = { ...floor.h.ws, tasks: floor.h.ws.tasks.map(t => (t.id === floor.id ? { ...t, status: 'done' as const, doneOn: mon, version: t.version + 1 } : t)) }
  const mended = drawnWorkspace(floor.h.ws, command(floor.h.ws, { type: 'run-repeats', today: sat, time: '09:00', at }))
  assert.equal(mended.tasks.length, floor.h.ws.tasks.length)
  assert.deepEqual(lines(mended), lines(floor.h.ws))
})

test('setting a repeat and turning it off are drawn at once; set and ticked while both are unsent, it is a finished to-do with no next one', () => {
  const { h, id } = setup(false)
  let ws = h.ws
  const n = ws.tasks.length
  ws = drawnWorkspace(ws, command(ws, { type: 'set-todo-repeat', taskId: id, repeat: weekly, today: mon, at }, 'a'))
  assert.equal(repeatsIn(ws).get(id)?.every, 'week')
  const ticked = drawnWorkspace(ws, command(ws, status(id), 'b'))
  assert.equal(ticked.tasks.length, n)
  assert.equal(ticked.todoRepeats?.length, 1)
  assert.equal(repeatsIn(ticked).size, 0)
  const off = drawnWorkspace(ws, command(ws, { type: 'set-todo-repeat', taskId: id, repeat: null, today: mon, at }, 'c'))
  assert.equal(off.todoRepeats, undefined)
})

test('with no repeat in the workspace, what is drawn is the command, nothing less', () => {
  const { h, alpha } = setup(false)
  const c = command(h.ws, status(alpha))
  assert.deepEqual(drawnWorkspace(h.ws, c), applyCommand(h.ws, c).workspace)
})

test('what is stored for sending still names the next to-do, its repeat and its page, so the row check knows', () => {
  const { h, id } = setup()
  const repeatId = h.ws.todoRepeats![0]!.id
  const { writes } = capture(h.ws, status(id), 'tick', false).entry
  for (const key of [`task:${id}`, `task:${repeatTaskId(repeatId, nextMon)}`, `repeat:${repeatId}`, `page:${dayId(nextMon)}`]) assert.ok(writes.includes(key), key)
})
```

- [ ] **Step 3: `tests/editor-hold.test.ts`.**

```ts
// A command sent the way row actions send (repeating-to-dos.md §6): through every open editor whose page it rewrites,
// flush → hold → command → apply. Whatever an editor does, the command goes exactly once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerEditorHold, sendHolding, trackLeaveSave, type EditorHold } from '../src/components/editor-flush.ts'

const receipt = { operationId: 'op', message: 'Done' }

test('with no page to hold, the command goes at once, as it always did', async () => {
  let sent = 0
  const out = sendHolding([], async () => { sent++; return receipt })
  assert.equal(sent, 1, 'sent in the same turn: a tick with no repeat is unchanged')
  assert.equal(await out, receipt)
})

test('a page with no editor open is not held', async () => {
  let sent = 0
  assert.equal(await sendHolding(['nobody'], async () => { sent++; return receipt }), receipt)
  assert.equal(sent, 1)
})

test('each open editor saves and holds before the command, and shows its page after, outermost first; a page named twice is held once', async () => {
  const log: string[] = []
  const editor = (name: string): EditorHold => async send => { log.push(`${name}: saved, held`); const r = await send(); log.push(`${name}: shows its page, lets go`); return r }
  const offA = registerEditorHold('a', editor('a')), offB = registerEditorHold('b', editor('b'))
  try {
    assert.equal(await sendHolding(['a', 'b', 'a', 'c'], async () => { log.push('sent'); return receipt }), receipt)
    assert.deepEqual(log, ['a: saved, held', 'b: saved, held', 'sent', 'b: shows its page, lets go', 'a: shows its page, lets go'])
  } finally { offA(); offB() }
})

test('a command is never lost to a hold: an editor that sends nothing, or throws, still leaves it sent once', async () => {
  const holds: Array<[string, EditorHold]> = [
    ['returns without sending', async () => null],
    ['throws before sending', async () => { throw new Error('editor gone') }],
    ['throws after sending', async send => { await send(); throw new Error('could not show the page') }],
  ]
  for (const [name, hold] of holds) {
    let sent = 0
    const off = registerEditorHold('a', hold)
    try {
      assert.equal(await sendHolding(['a'], async () => { sent++; return receipt }), receipt, name)
      assert.equal(sent, 1, name)
    } finally { off() }
  }
})

test("a closing editor's save lands before the command is sent", async () => {
  let land!: () => void, sent = false
  trackLeaveSave(new Promise<void>(resolve => { land = resolve }))
  const out = sendHolding(['a'], async () => { sent = true; return receipt })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(sent, false)
  land()
  assert.equal(await out, receipt)
  assert.equal(sent, true)
})

test('an editor that has closed is no longer held, and closing an old one leaves the new one registered', async () => {
  let held = 0
  const hold: EditorHold = async send => { held++; return send() }
  const first = registerEditorHold('a', hold), second = registerEditorHold('a', async send => { held += 10; return send() })
  first()
  await sendHolding(['a'], async () => receipt)
  assert.equal(held, 10)
  second()
  await sendHolding(['a'], async () => receipt)
  assert.equal(held, 10)
})
```

- [ ] **Step 4: `tests/todo-repeats-mend-guard.test.ts`.**

```ts
// The mend on opening the app (repeating-to-dos.md §6): one repeat whose next to-do can't be made must not refuse the
// whole command, which also makes repeating rows and runs scheduled rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueTodoRepeats, type TodoRepeatRule } from '../src/domain/todo-repeats.ts'
import { plannedOn } from '../src/domain/workspace.ts'
import { dayId, harness, todo } from './v2-helpers.ts'

// Nov 23, 2026 is a Monday.
const mon = '2026-11-23', sat = '2026-11-28', nextMon = '2026-11-30'
const at = '2026-11-23T10:00:00.000Z'
const rules: Record<string, TodoRepeatRule> = { 'Weekly review': { every: 'week', interval: 1, from: 'schedule' }, 'Water the plants': { every: 'day', interval: 1, from: 'schedule' } }

for (const order of [['Weekly review', 'Water the plants'], ['Water the plants', 'Weekly review']]) {
  test(`a repeat the mend can't make a next one for is left as it was, and the others are mended (${order.join(', ')})`, () => {
    const h = harness()
    h.day(mon)
    h.save(dayId(mon), d => [...d, todo('r-1', 'Weekly review', 'plan', mon), todo('r-2', 'Water the plants', 'plan', mon)], { today: mon })
    const weeklyId = h.task('Weekly review').id, dailyId = h.task('Water the plants').id
    for (const title of order) h.run({ type: 'set-todo-repeat', taskId: h.task(title).id, repeat: rules[title]!, today: mon, at })
    // Nov 30's page id is taken by a document, so making that day's page throws ("Page id already in use").
    h.run({ type: 'create-document', title: 'In the way', body: '', pageId: dayId(nextMon) })
    // The floor build's ticks: both done, and both repeats still name them.
    h.ws = { ...h.ws, tasks: h.ws.tasks.map(t => ({ ...t, status: 'done' as const, doneOn: mon, version: t.version + 1 })) }
    assert.deepEqual(Object.fromEntries(dueTodoRepeats(h.ws, sat).map(d => [d.repeat.taskId, d.on])), { [weeklyId]: nextMon, [dailyId]: sat })
    const before = h.ws
    const mend = h.run({ type: 'run-repeats', today: sat, time: '09:00', at })
    assert.equal(mend.receipt.message, 'Nothing due', 'the mend says nothing')
    const daily = h.ws.todoRepeats!.find(r => r.previous?.taskId === dailyId)
    assert.ok(daily, 'the daily one moved on to its next')
    assert.equal(plannedOn(h.ws, daily.taskId), sat)
    assert.equal(h.ws.tasks.length, before.tasks.length + 1, 'one next to-do, and nothing half made')
    assert.deepEqual(h.ws.todoRepeats!.find(r => r.taskId === weeklyId), before.todoRepeats!.find(r => r.taskId === weeklyId), 'the stuck one is as it was')
    assert.equal(h.ws.pages.find(p => p.id === dayId(nextMon))?.type, 'document')
    assert.deepEqual(dueTodoRepeats(h.ws, sat).map(d => d.repeat.taskId), [weeklyId], 'still due: the next open tries again')
  })
}
```

- [ ] **Step 5: Run each file and see it fail for the right reason.**
  `TZ=America/Vancouver node --test tests/todo-repeat-view.test.ts tests/todo-repeat-draw.test.ts tests/editor-hold.test.ts tests/todo-repeats-mend-guard.test.ts`
  Expected:
  - The first two FAIL with `Cannot find module …/src/components/todo-repeat-view.ts`.
  - `editor-hold` FAILS with `does not provide an export named 'registerEditorHold'`.
  - `mend-guard` FAILS twice with `Page id already in use`.
  - `npm run typecheck` fails in these four files only. That is expected until Task 5.
- [ ] **Step 6: Commit.** `test(repeats): behaviour tests for the screen, and the phase 2 plan`

### Task 2: The mend survives one repeat it cannot make (integration)

**Files:**
- Modify: `src/domain/workspace.ts` (`run-repeats`, the mend loop at lines 1765–1769)
- Test: `tests/todo-repeats-mend-guard.test.ts` (2 tests)

**Interfaces:**
- Consumes: `dueTodoRepeats`, `advanceRepeat`, `task`, `liveTaskIds` as they are.
- Produces: no signature change. `run-repeats` no longer throws because of one repeat.

**No-repeat protection:** the loop body runs only when `state.todoRepeats?.length` and a repeat is due, so a workspace
with no repeat takes the same path as today. The whole existing suite is the check.

- [ ] **Step 1: Run the two tests and see them fail** with `Page id already in use`.
- [ ] **Step 2: Guard each due repeat.** `execute` holds `state` by reference, so a restore must replace its contents,
  and every object inside it is then new. Find the repeat again by id on each turn:

```ts
for (const due of dueTodoRepeats(state, action.today, liveTaskIds(state))) {
  const kept = structuredClone(state);
  try {
    const repeat = state.todoRepeats!.find((r) => r.id === due.repeat.id)!;
    if (!advanceRepeat(state, repeat, task(state, repeat.taskId), due.on, action.today)) repeat.slot = due.on;
  } catch {
    // One repeat that can't make its next must not stop repeating rows, scheduled rules or the other repeats.
    for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key];
    Object.assign(state, kept);
  }
}
```

  Keep the existing comment above the loop. `task-status` is **not** guarded: a snapshot there would be paid on every
  repeating tick (see "Decisions for Brian").
- [ ] **Step 3: Run.** The file: 2 pass. Then
  `TZ=America/Vancouver node --test tests/todo-repeats.test.ts tests/todo-repeats-schedule.test.ts tests/todo-repeats-storage.test.ts tests/repeats.test.ts tests/automations.test.ts`:
  all pass.
- [ ] **Step 4: Commit.** `fix(repeats): one repeat the mend can't make doesn't refuse the rest`

### Task 3: The pure module (integration)

**Files:**
- Create: `src/components/todo-repeat-view.ts`
- Test: `tests/todo-repeat-view.test.ts` (10 tests)

**Interfaces:**
- Consumes: `nextDay`, `repeatWords`, `dueTodoRepeats`, `DueTodoRepeat`, `TodoRepeat`, `TodoRepeatRule` from
  `../domain/todo-repeats.ts`; `addDays` from `../domain/database.ts`; `taskRows` from `../domain/workspace.ts`;
  `todoStatus` from `../domain/todos-source.ts`; `fromIso` from `./dates.ts`.
- Produces:

```ts
/** Open to-dos that are some repeat's current one, by to-do id; worked out once for each copy of the workspace. */
export function repeatsIn(ws: Workspace): ReadonlyMap<string, TodoRepeat>
/** `Repeat…`, or `Repeat · Every week…` once it repeats. */
export function repeatMenuLabel(rule: TodoRepeatRule | undefined): string
/** The icon's accessible name: `Repeats every week`. */
export function repeatMarkName(rule: TodoRepeatRule): string
/** `Mon, Dec 7`; with the year when it isn't `today`'s: `Wed, Nov 24, 2027`. */
export function nextDayLabel(on: LocalDate, today: LocalDate): string
/** A notice's words with the next one's day, when the command made exactly one; otherwise `text` itself. */
export function noticeWithNext(text: string, receipt: Pick<Receipt, 'nextTodos'>, today: LocalDate): string
/** The editor's last line: `Next Mon, Dec 7`, `Next Sun, Nov 29 if done today`, or `Ends after this one`. */
export function nextLine(repeat: TodoRepeat, today: LocalDate, weekStart?: WeekStart): string
export interface RepeatFields { every: 'off' | TodoRepeat['every']; interval: number; showWeekdays: boolean; from: TodoRepeat['from']; ends: 'never' | 'date'; until: LocalDate | '' }
export function repeatFields(repeat: TodoRepeat | undefined): RepeatFields
export type RepeatEdit =
  | { field: 'every'; value: RepeatFields['every'] } | { field: 'interval'; value: number } | { field: 'weekdays'; value: number[] }
  | { field: 'from'; value: TodoRepeat['from'] } | { field: 'ends'; value: 'never' | 'date' } | { field: 'until'; value: string }
/** The rule one edit sends: null turns the repeat off; undefined sends nothing (no change, or a value that can't be stored). */
export function ruleAfter(repeat: TodoRepeat | undefined, edit: RepeatEdit, today: LocalDate): TodoRepeatRule | null | undefined
/** Pages already there whose document a command rewrites because of a repeat: the next one's line made or taken back. */
export function repeatPages(ws: Workspace, action: Action): string[]
/** Pages an Undo of that command must hold: the ones it was held for, and wherever a to-do it made has a line now. */
export function undoHoldPages(ws: Workspace, receipt: Pick<Receipt, 'nextTodos'>, held: readonly string[]): string[]
/** The due repeats as one string, `id@day` sorted and joined by a space: the app asks the mend once for each. */
export function mendKey(due: readonly DueTodoRepeat[]): string
```

**No-repeat protection:** every function returns at once on a workspace with no repeat. `repeatsIn` gives one shared
empty map, `repeatPages` gives `[]`, `undoHoldPages` gives `held` as it is without reading a page, and
`noticeWithNext` gives the same string. The tests pin each.

- [ ] **Step 1: Run the file and see it fail** (module not found).
- [ ] **Step 2: Write the module.** Decisions an implementer can't make alone:
  - `repeatsIn`: a `WeakMap<Workspace, Map>` cache, as `blockedIn` in `blockers.tsx`. With `!ws.todoRepeats?.length`,
    return a module-level empty map without touching `ws.tasks`. Otherwise include a repeat when its `taskId` is a
    task whose `status === 'open'`. Do not call `liveTaskIds` (it reads every page): a line that is drawn is live.
  - `repeatMenuLabel`: `repeatWords(rule)` with its first letter upper-cased, inside `Repeat · …`.
  - `nextDayLabel`: `fromIso(on).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })`,
    plus `year: 'numeric'` when `on.slice(0, 4) !== today.slice(0, 4)`.
  - `nextLine`: `nextDay(repeat, today, weekStart)`. Null gives `Ends after this one`. `from === 'done'` appends
    ` if done today`.
  - `repeatFields.showWeekdays`: `every === 'week' && from === 'schedule'`.
  - `ruleAfter`:
    - With no repeat, only `every` (not `off`) sends: `{ every, interval: 1, from: 'schedule' }`.
    - A new `every` keeps `interval`, `from` and `until`, and drops `weekdays`.
    - `interval` must be an integer 1 to 999.
    - `weekdays` only when weekly and `from: 'schedule'`, never empty, sorted and unique, and omitted when it is
      exactly the weekday of `repeat.slot` (`new Date(`${slot}T12:00:00Z`).getUTCDay()`, as the command does).
    - `from: 'done'` drops `weekdays`.
    - `ends: 'date'` sets `until` to `repeat.until ?? addDays(later of slot and today, 28)`.
    - `until` must match `/^\d{4}-\d{2}-\d{2}$/`.
    - Omit absent fields, never `undefined`. If the result equals the current rule field for field, return `undefined`.
  - `repeatPages`: return `[]` unless `ws.todoRepeats?.length`. "The live day page of a date" is the page with
    `type === 'daily'`, that `date` and no `trashedAt` (what the private `dayPage` in `workspace.ts` reads). None
    means no id.
    - `task-status` to `done` or `cancelled`, with `today`, on an open to-do that is a repeat's `taskId`: the live day
      page of `nextDay(repeat, today, ws.weekStart ?? 0)`.
    - `task-status` to `open` on a to-do that is not open and is some repeat's `previous.taskId`: every page in
      `taskRows(ws, repeat.taskId)`.
    - `edit-todos`: for each item with a change whose `columnId === todoStatus.id`, both of the above for that to-do,
      whatever the value (over-approximating only holds an editor for nothing).
    - `run-repeats`: the live day page of each `dueTodoRepeats(ws, action.today)` entry's `on`.
    - Anything else: `[]`. Unique ids, in first-seen order.
- [ ] **Step 3: Run.** `TZ=America/Vancouver node --test tests/todo-repeat-view.test.ts`: 10 pass.
- [ ] **Step 4: Commit.** `feat(repeats): the screen's words, fields and index, as pure functions`

### Task 4: Nothing a repeat does is drawn before the server answers (judgment)

**Files:**
- Modify: `src/components/draw-ahead.ts`, `src/components/use-day.tsx` (`predicted`, line 302),
  `src/components/app-shell.tsx` (the gate, lines 72–79)
- Test: `tests/todo-repeat-draw.test.ts` (5 tests)

**Interfaces:**
- Consumes: `applyCommand` from `../domain/workspace.ts`; `mendKey` from Task 3.
- Produces:

```ts
// draw-ahead.ts
/**
 * A pending change as it is drawn before the server answers: the command by the domain's own code, except that no
 * repeat makes its next to-do or takes one back (repeating-to-dos.md §3: the next line is never drawn ahead of the server).
 */
export function drawnWorkspace(ws: Workspace, command: Command): Workspace
```

**How prediction is drawn today.** `predicted(true)` in `use-day.tsx` applies every pending outbox entry that is
`drawn` to the server's workspace with `applyCommand`, and `adopt` and `showOutbox` put the result on screen. An entry
is drawn when it was stored before this load, was left after a failed send, or its type is `ahead`.

- A tick (`task-status`, rule `own`) is therefore drawn once it is kept offline.
- A tick from a To-dos view (`edit-todos`, rule `ahead`) is drawn at once.
- A kept `run-repeats` is drawn too.

Each would draw the next to-do and its line. An open editor on that page would then show a line the server does not
have, or, with unsaved words, its conflict state.

**The change.** For anything but `set-todo-repeat`, apply the command to the workspace without its `todoRepeats` and
put them back after. The reducer then sees no repeat, so it neither advances nor takes back, and the tick itself is
unchanged. `predicted()` with no argument (what later changes are built on) and `capture` (what is stored and sent)
stay as they are. The last test pins that.

**No-repeat protection:** with `!ws.todoRepeats?.length`, `drawnWorkspace` is `applyCommand(ws, command).workspace`,
the call `predicted` makes today. The fourth test pins it. Also run `tests/outbox-client.test.ts`,
`tests/tap-feedback.test.ts` and `tests/draw-ahead.test.ts`.

- [ ] **Step 1: Run the file and see 5 fail** (`drawnWorkspace` is not exported).
- [ ] **Step 2: `drawnWorkspace`.** If `command.action.type === 'set-todo-repeat'` or there are no repeats, return the
  plain result. Otherwise destructure `todoRepeats` off `ws`, apply to the rest, and return
  `{ ...result, todoRepeats }`. Import `applyCommand` with the `.ts` extension. `draw-ahead.ts` had only type imports
  until now.
- [ ] **Step 3: `predicted`.** In the loop at line 302, when `shown` is true use `drawnWorkspace(ws, command)`,
  otherwise keep `applyCommand(…).workspace`. Nothing else in the function changes.
- [ ] **Step 4: The mend's gate.** With the mend no longer drawn, a `run-repeats` kept offline leaves the repeat due
  on screen, and the effect at `app-shell.tsx:72` (it re-runs on every revision) would store another one each time.
  - Add `const askedMend = useRef('')`.
  - Compute `mend` as `mendKey(dueTodoRepeats(workspace, today, liveTaskIds(workspace)))` when
    `workspace.todoRepeats?.length && dueTodoRepeats(workspace, today).length`, else `''`. Keep the cheap call first.
  - The third reason becomes `mend !== '' && mend !== askedMend.current`.
  - Set `askedMend.current = mend` on the line before `run(` is called, for whichever reason it is sent.
- [ ] **Step 5: Run.**
  `TZ=America/Vancouver node --test tests/todo-repeat-draw.test.ts tests/draw-ahead.test.ts tests/outbox-client.test.ts tests/tap-feedback.test.ts tests/outbox-schedule.test.ts`:
  all pass.
- [ ] **Step 6: Commit.** `feat(repeats): the next to-do is never drawn ahead of the server`

### Task 5: A command that rewrites an open page goes the way row actions do (judgment)

**Files:**
- Create: `tests/evidence/repeating-to-dos/seed.ts`, `tests/evidence/repeating-to-dos/hold.mjs`
- Modify: `src/components/editor-flush.ts`, `src/components/use-day.tsx`, `src/components/page-editor.tsx`
  (`onServer`, lines 2513–2537; a registration beside line 1166), `src/components/task-row.tsx` (line 32),
  `src/components/database-block.tsx` (lines 655 and 1577), `src/components/app-shell.tsx` (line 78)
- Test: `tests/editor-hold.test.ts` (6 tests)

**Interfaces:**
- Consumes: `repeatPages` (Task 3); `holdEditor`, `flushRef`, `applyServerPage`, `historyPending`, `left` in
  `page-editor.tsx`.
- Produces:

```ts
// editor-flush.ts
/** An open editor's way to take a command from outside it that rewrites its page: save what was typed, hold typing, run `send`, show the server's page. */
export type EditorHold = (send: () => Promise<Receipt | null>) => Promise<Receipt | null>
export function registerEditorHold(pageId: string, hold: EditorHold): () => void
/** Runs `send` exactly once, inside the hold of every open editor among `pageIds`, outermost first. With no page it is `send()` itself, called at once. */
export function sendHolding(pageIds: readonly string[], send: () => Promise<Receipt | null>): Promise<Receipt | null>

// use-day.tsx, on the context beside `run`, with `run`'s own type
/** `run`, held: when the action makes or takes back a repeat's next to-do on a page open in an editor, that editor saves, holds and shows the server's page (repeating-to-dos.md §6). Anything else is `run` exactly. */
runHeld: WorkspaceContextValue['run']
// RunOptions
/** The pages this run was held for (`runHeld`), for its notice's Undo. */
held?: readonly string[]

// page-editor.tsx (private)
/** Flush → hold → `send` → show the server's page. `sent: false`: another server change is on its way here, or what he typed can't be saved, and `send` was not called. */
async function held(send: () => Promise<Receipt | null>, word: string, alwaysShow = false): Promise<{ sent: boolean; receipt: Receipt | null }>
```

**How it works today.**
- A tick is `toggleTask` → `runTick` → `run(action)` (`use-day.tsx:782–806`). It never touches an editor, because
  until phase 1 a tick changed no document.
- A row action is `rowAct` → `onServer` (`page-editor.tsx:2513`): wait for a save in flight, flush, give up if still
  dirty, `holdEditor()`, `run`, then `applyServerPage` if the page's key moved.
- When a page changes under an editor with unsaved words, the effect at `page-editor.tsx:1279` sets
  `Page changed elsewhere · draft kept`.

**The change.** `runHeld` asks `repeatPages` which existing pages the command will rewrite, and `sendHolding` wraps
the `run` call in each of those pages' `held`. Every sender that can finish, reopen or mend a repeat's to-do uses
`runHeld`: `runTick`, `onServer` (Cancel and Restore), Cancel in `task-row.tsx`, both `edit-todos` senders, and the
mend.

**What can go wrong, and what proves it does not:**

| Risk | Rule | Proof |
| --- | --- | --- |
| The tick is lost because an editor is busy, can't save, or throws | `sendHolding` calls `send` exactly once whatever a hold does | `editor-hold` test 4 |
| A to-do with no repeat ticks later, or differently | No pages means `send()` in the same turn; `runHeld` then returns `run(...)` itself | `editor-hold` test 1; `repeatPages` tests; `hold.mjs` H6 |
| Deadlock: a flush queued behind the command that waits for it | `sendHolding` is only called before `run`, never from inside a queued job | Review of the call sites; H1 finishes within 5 s |
| His own save of that page lands between the tick being stored and sent, and the outbox's row check holds the tick as "changed elsewhere" (a repeating tick now writes `page:<next day>`) | The flush, and any closing editor's save, lands before `run` is called, so the tick is stored on the newer revision | `editor-hold` test 5; H1 with a save in flight |
| He types on that page during the round trip, so a conflict shows | The editor is held (`isEditable = false`) until its page is shown | H1, H2 |
| The page shows its old lines after | `held` applies the server's page when its key moved | H1, H2: the new line is in the DOM |
| A second tap during the hold sends a second tick | The tick mark is set before `sendHolding`, and `tapTarget` ignores a tap while it is `saving` | H5 |
| The editor closed meanwhile | `held` returns the receipt and touches nothing when `left.current` | Review Focus 2 |
| Reopening, Cancel, Restore, a To-dos view, or the mend rewrites the page unheld | All go through `runHeld` | H3, H4; grep in Step 8 |
| Offline: the page can't be saved | The tick still goes, unheld; nothing is drawn (Task 4); later that page meets the conflict state it already has | H7; "Decisions for Brian" 2 and 3 |

**No-repeat protection:** `repeatPages` is `[]` for any command that touches no repeat, without running the reducer,
and `runHeld` then returns `run(source, notice, operationId, options)` with the same arguments in the same turn.
`onServer` behaves as before for every action, because `held` is its old body.

- [ ] **Step 1: The seed.** `tests/evidence/repeating-to-dos/seed.ts`, modelled line for line on
  `tests/evidence/todo-dependency/seed.ts`. Usage:
  `node --no-warnings tests/evidence/repeating-to-dos/seed.ts <store-path> <today> [plain]`. A throwaway SQLite file.
  - Today's page, in this order, all planned today:
    - `a` `Weekly review`
    - `b` `Water the plants`
    - `c` `Take the bins out`
    - `d` `Book the dentist`
    - `e` `Reply about the offsite`
    - `f` `Send the signed lease form back to the landlord before the end of the month`
    - a paragraph `p` `Last line`
  - Tomorrow's page (`ensure-day`, then `save-editor`): a reference line `ref-c` for Take the bins out
    (`props: { taskId: <its id>, role: 'reference', planDate: '' }`) and a paragraph `tp` `Tomorrow notes`.
  - A document `notes` with a reference line `ref-a` for Weekly review, and a document `lists` holding a To-dos view
    (as the dependency seed's `lists`).
  - `set-task-dates` on Book the dentist: `deadlineOn` today + 3.
  - Unless the third argument is `plain`, `set-todo-repeat` with `today` and `at` now:
    - `a` weekly
    - `b` `{ every: 'day', interval: 5, from: 'done' }`
    - `c` daily
    - `f` `{ every: 'week', interval: 2, from: 'schedule', weekdays: [<today's weekday>, <(that + 3) % 7>] }`
- [ ] **Step 2: `hold.mjs`, written before the code and seen to fail.** Model its harness on
  `tests/evidence/todo-dependency/dependency.mjs`: same `scenario`, `row`, `store`, `notices` helpers; reseed per
  scenario; `serviceWorkers: 'block'`. Usage: `node tests/evidence/repeating-to-dos/hold.mjs <base-url> <store-path>
  [chromium|webkit]`.

  "No conflict" means that at every sample (every 200 ms for 3 s after the action) `.editor-save-line.is-conflict`
  has no match and no element's text contains `changed elsewhere` or `draft kept`. "Typed" means the stored document
  of that page contains the typed word.

  | | Do | Must hold |
  | --- | --- | --- |
  | H1 | Open `/day/<tomorrow>`. Type `kept` at the end of `Tomorrow notes` and, without waiting, tick the reference line Take the bins out | No conflict. The stored tomorrow page has `kept` and exactly one new task row whose `taskId` ends `.<tomorrow>`. The notice is `Task completed · Next <Mon, Dec 7 form of tomorrow>`. The editor is editable again |
  | H2 | Open `/day/<today>?peek=day%3A<tomorrow>&side=1` at 1280. Type `kept` in the peek's `Tomorrow notes`, then tick Take the bins out in the main pane | As H1, in the peek |
  | H3 | After H1's tick, type `more` on tomorrow's page and press the notice's `Undo` | No conflict. The stored page has `kept` and `more` and no row for the next to-do. The to-do is open and is its repeat's current one |
  | H4 | After H1's tick, type `more`, then tap the same box again | As H3, with notice `Task reopened` |
  | H5 | As H1, but `dblclick` the box | One `task-status` request with `done`, one next to-do |
  | H6 | Open `/day/<today>`. Type `kept` at the end of `Last line` and at once tick Book the dentist (no repeat) | The `task-status` POST leaves within 300 ms of the tap. It is not made to wait for the save |
  | H7 | Open `/day/<tomorrow>`. `context.setOffline(true)`. Type `kept`, tick the reference line | No notice contains `Next`. The DOM has no new task row. After `setOffline(false)` and 6 s, the store has exactly one next to-do. Report what the page then shows: either no conflict, or the existing conflict line with `kept` still in the editor. Never a lost word |

  Adjust selectors to the DOM as you find it. Never change an expected outcome. If the peek URL does not open a day
  page beside a day page, report it and run H2 by hand in Task 10.

  Build and serve:
  `npm run build && DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=<store> npx vite preview --host 127.0.0.1 --port 3391`.
  Run it now. Expected: H1 to H4 FAIL with a conflict.
- [ ] **Step 3: Run `tests/editor-hold.test.ts` and see it fail** (no such export).
- [ ] **Step 4: `editor-flush.ts`.**
  - A `holders` map and `registerEditorHold`, shaped as `flushers` and `registerEditorFlush` are. The disposer removes
    only its own entry.
  - `sendHolding` is an `async` function:
    1. With `!pageIds.length`, `return send()` before any `await`.
    2. Otherwise `await Promise.all([...leaving])`.
    3. Take the holds of the unique page ids that have one.
    4. Wrap `send` so it can run only once and its promise is remembered.
    5. Nest the holds outermost first:
       `holds.reduceRight((inner, hold) => () => hold(inner), once)()`, inside `try`/`catch`.
    6. If the wrapped `send` never ran, run it. Return its remembered promise's result. A hold that throws after
       sending must not reject the call.
  - `import type { Receipt } from '../domain/types'`: a type import only, so the file stays loadable by a test.
- [ ] **Step 5: `use-day.tsx`.**
  - `RunOptions.held`.
  - After `runRef.current = run` (line 773), add `runHeld`, a `useCallback` over `run` and `predicted`:
    - `pages` is `repeatPages(predicted() ?? wsRef.current, source)` when `source` is an action and a workspace is
      loaded, else `[]`.
    - With no pages, `return run(source, notice, operationId, options)`.
    - Else `return sendHolding(pages, () => run(source, notice, operationId, { ...options, held: pages }))`.
  - In `runTick` (line 793), `run(` becomes `runHeld(`. `updateTicks` stays above it, so the box still shows the tap
    in the same turn.
  - Add `runHeld` to `WorkspaceContextValue`, to `value` and to its dependency list.
- [ ] **Step 6: `page-editor.tsx`.**
  - Take `runHeld` from `useWorkspace()` at line 490.
  - Rename `onServer`'s body to `held(send, word, alwaysShow)` with the signature above.
    - The first line, `if (historyPending.current)`, returns `{ sent: false, receipt: null }`.
    - So does the line that gives up while still dirty.
    - `run(action, notice, operationId, options)` becomes `send()`.
    - Everything else stays line for line.
  - `onServer` keeps its signature. It computes `word` as before and returns
    `(await held(() => runHeld(action, notice, operationId, options), word, alwaysShow)).receipt`.
  - Keep `const heldRef = useRef(held); heldRef.current = held` (as `flushRef` is kept), and register beside line 1166:

```ts
useEffect(() => registerEditorHold(page.id, async send => {
  const taken = await heldRef.current(send, 'Saving…')
  // Busy with a change of its own, or what he typed can't be saved now: the command still goes, and this page's next save meets the state it already has for a change made elsewhere.
  return taken.sent ? taken.receipt : send()
}), [page.id])
```

- [ ] **Step 7: The other senders.** Take `runHeld` from `useWorkspace()` and use it in place of `run` at
  `task-row.tsx:32` (Cancel), `database-block.tsx:655` and `:1577` (the two `edit-todos` senders; the same call also
  sends `set-values-many`, which `runHeld` passes straight through), and `app-shell.tsx:78` (`run-repeats`).
- [ ] **Step 8: Check no sender was missed.** `grep -rn "task-status'\|edit-todos'\|run-repeats'" src/components`
  shows every line that builds one of those actions. Each must reach `runHeld`, directly or through `runTick` or
  `onServer`. List them in your report.
- [ ] **Step 9: Run.**
  `TZ=America/Vancouver node --test tests/editor-hold.test.ts tests/task-ticks.test.ts tests/outbox-client.test.ts tests/tap-feedback.test.ts`:
  all pass. `npm run typecheck`: clean, including Task 1's files. Rebuild, then `hold.mjs` in Chromium and WebKit: H1
  to H6 pass, and H7 reports what it saw. If you cannot run a browser, say so.
- [ ] **Step 10: Commit.** `feat(repeats): a tick that writes an open page saves and holds it first`

### Task 6: The notice names the next day (integration)

**Files:**
- Modify: `src/components/use-day.tsx` (`Notice`, lines 153–157; `push`, lines 604–608; `run`'s success path, lines
  692–697), `src/components/page-editor.tsx` (`rowNotice`, line 2509; `rowAct`, lines 2539–2569; `undoRowAction`,
  lines 2571–2577; ⌘Z, line 2924)
- Test: `tests/todo-repeat-view.test.ts` (already green: `noticeWithNext`, `undoHoldPages`)

**Interfaces:**
- Consumes: `noticeWithNext`, `undoHoldPages`, `repeatPages` (Task 3); `sendHolding`, `RunOptions.held` (Task 5);
  `todayIso`.
- Produces: `Notice.undoHolds?: readonly string[]` (the pages its Undo holds, as the command was held).

**Decision.** The words are added in one place, where `run` turns a receipt into a notice. Every sender (a line's box,
Tasks, a To-dos view's box and bar) gets them and none can forget. Each screen's own words are untouched.

**No-repeat protection:** with no `nextTodos`, `noticeWithNext` returns its input and `undoHoldPages` returns `[]`, so
the notice object has the same fields as today. Offline nothing changes: a kept change builds no notice today (`run`
returns before it), and the drain that sends it later never builds one. Do not add one.

- [ ] **Step 1: `run`.** Where `spec` is computed (line 692), take the caller's notice as before. If there is one,
  replace its `text` with `noticeWithNext(text, result.receipt, todayIso())`. Add `undoHolds` when
  `undoHoldPages(result.workspace, result.receipt, options.held ?? [])` is not empty. The three branches below it
  (`rules?.scheduled`, `withRules`, plain) use this `spec` unchanged.
- [ ] **Step 2: `push`.** The Undo's `onPress` sends through `sendHolding(spec.undoHolds ?? [], () => …)` around the
  `runRef.current?.(…)` call it has. With no holds that is the same call in the same turn.
- [ ] **Step 3: Cancel on a day page.** In `rowAct`:
  - Before `onServer`, keep `const holds = repeatPages(latest() ?? latestWorkspace.current, action)`.
  - The notice text for `cancel` is `noticeWithNext('Cancelled', receipt, today)`.
  - Store `holds: undoHoldPages(latest() ?? latestWorkspace.current, receipt, holds)` on `rowNotice.current`.
  - `undoRowAction(operationId, holds = [])` wraps its `onServer` call in
    `sendHolding(holds.filter(id => id !== page.id), …)`. Its own page is held by `onServer`.
  - Both callers (the toast's Undo and ⌘Z at line 2924) pass the stored holds.
- [ ] **Step 4: Run.** `npm run typecheck`: clean.
  `TZ=America/Vancouver node --test tests/todo-repeat-view.test.ts tests/tap-feedback.test.ts`: pass. Rebuild and run
  `hold.mjs`: H1's and H3's notice assertions pass.
- [ ] **Step 5: Commit.** `feat(repeats): the tick's notice names the next day`

### Task 7: The Repeat editor, from the menus (integration)

**Files:**
- Create: `src/components/repeat-fields.tsx`, `src/components/todo-repeat.tsx`
- Modify: `src/components/database-menu.tsx` (lines 1012–1046, and their uses at 1020, 1064, 1069, 1071),
  `src/components/property-editors.tsx` (`ShellProps`, line 127; `EditorShell`, line 160),
  `src/components/app-shell.tsx` (after `BlockerPickerHost`, line 117), `src/components/page-editor.tsx` (lines 288
  and 2600), `src/components/tasks-screen.tsx` (line 127), `src/styles.css`

**Interfaces:**
- Consumes: `repeatsIn`, `repeatFields`, `ruleAfter`, `nextLine`, `repeatMenuLabel` (Task 3); `useWide`,
  `EditorShell`; `useWorkspace().run`; `todayIso`.
- Produces:

```ts
// repeat-fields.tsx: moved from database-menu.tsx, bodies unchanged
export const weekdayNames: readonly string[]
export const everyNames: { day: 'Daily'; week: 'Weekly'; month: 'Monthly'; year: 'Yearly' }   // was `repeatWords` there
export const inWeekOrder: (days: readonly number[], weekStart: number) => number[]
export function RepeatEvery(props: { repeat: { interval: number }; set: (next: { interval: number }) => void }): JSX.Element
/** `label`: the row's word, `On` unless given. */
export function RepeatWeekdays(props: { repeat: { weekdays?: number[]; start: string }; weekStart: number; set: (days: number[]) => void; label?: string }): JSX.Element

// property-editors.tsx
export function EditorShell(props: ShellProps): JSX.Element   // ShellProps.property becomes Pick<Property, 'name'>

// todo-repeat.tsx
export function openRepeatEditor(taskId: string, anchor: HTMLElement | null): void
export function RepeatEditorHost(): JSX.Element | null
```

**No-repeat protection:**
- The database Repeat menu must look and act as before. The move changes no markup, and the CSS change only widens
  selectors with `:is()`.
- A to-do's menu gains one item under `Blocked by…`. That is the feature.
- No other DOM changes for a to-do with no repeat.
- Task 10's `pixels.mjs` compares the screens with every menu closed.

- [ ] **Step 1: Move the shared fields.** Cut `weekdayNames`, `inWeekOrder`, the `repeatWords` constant (renamed
  `everyNames`), `RepeatEvery` and `RepeatWeekdays` into `repeat-fields.tsx`, with the narrowed prop types above and
  the one new optional `label` (the row's visible word, default `On`). Import them back into `database-menu.tsx`.
  `npm run typecheck` is clean and the database menu is unchanged.
- [ ] **Step 2: Export `EditorShell`.** Add `export`, and change `ShellProps.property` to `Pick<Property, 'name'>`. It
  only reads the name.
- [ ] **Step 3: `todo-repeat.tsx`, the host.** The store and `openRepeatEditor` are `blockers.tsx` lines 66–70 again.
  The host:
  - Returns `null` unless open, a workspace is loaded and the to-do exists. An effect closes it when the to-do is gone
    or no longer `open`.
  - Reads `repeat = repeatsIn(workspace).get(taskId)`, `fields = repeatFields(repeat)`, `today = todayIso()`,
    `weekStart = workspace.weekStart ?? 0`.
  - `send(edit)`: `rule = ruleAfter(repeat, edit, today)`; nothing when `undefined`. Otherwise
    `run({ type: 'set-todo-repeat', taskId, repeat: rule, today, at: new Date().toISOString() }, r => ({ text: r.message, undoOperationId: r.operationId }), undefined, { inlineRefusal, onRefused })`.
    - `inlineRefusal` is
      `/[\d,]+ repeating to-dos at most|Reopen it first|That to-do was deleted|That to-do is in Trash|A to-do needs words|Invalid repeat|Nothing to change/`.
    - `onRefused` toasts the message for 6 s, except `Nothing to change`, which says nothing.
  - Renders
    `<EditorShell wide={useWide()} anchor={anchor} property={{ name: 'Repeat' }} rowTitle={task.title} onDismiss={close} minWidth={312} maxWidth={312}>`
    around `<div className="todo-repeat-editor">` holding, in this order, with the database menu's classes
    (`database-menu-row database-repeat-field`, `database-repeat-every`, `database-menu-quiet`):
    1. `Repeat`: a `select` with `aria-label="Repeat"` and options `Off`, `Daily`, `Weekly`, `Monthly`, `Yearly`
       (values `off`, `day`, `week`, `month`, `year`).
    2. Only when it repeats: `Every`, with `RepeatEvery` and the unit after it (`week`, or `weeks` when the interval
       isn't 1).
    3. When `fields.showWeekdays`:
       `<RepeatWeekdays label="" repeat={{ weekdays: repeat.weekdays, start: repeat.slot }} …>`.
    4. `From`: a `select` with `aria-label="From"` and options `Its day` (`schedule`) and `When it's done` (`done`).
    5. `Ends`: a `select` with `aria-label="Ends"` and options `Never` and `On a date`.
    6. When `fields.ends === 'date'`: a row with an empty label and
       `<input type="date" aria-label="Ends on" min={today} value={fields.until}>`.
    7. `<p className="database-menu-quiet">{nextLine(repeat, today, weekStart)}</p>`.
  - Every control is a native `select`, `input` or `button` in that DOM order, which is what makes it reachable by
    keyboard. Esc and a click outside close it (the shell does both). Every change is sent at once, so there is
    nothing to save on closing.
- [ ] **Step 4: CSS.** Add one rule:
  `.todo-repeat-editor { display: grid; }`.
  Then, wherever a selector reads `.database-menu` directly before `input:not([type=checkbox])`, `select`, or
  `.database-repeat-days button` (lines 2214–2216, 2318–2321, 2324 and 2542 today), change `.database-menu` to
  `:is(.database-menu, .todo-repeat-editor)`. No declaration changes, so the fields here are the database Repeat
  menu's, at both widths and in dark.
- [ ] **Step 5: Mount it.** `<RepeatEditorHost />` after `<BlockerPickerHost />` in `app-shell.tsx`.
- [ ] **Step 6: `Repeat…` in the three menus,** as the second item of the group that holds `Blocked by…`. Offer it
  when the to-do repeats or has words (`repeat || t.title.trim()`): a to-do with no words can't repeat.
  - `page-editor.tsx:288` (the line's `⋯`): `{ label: repeatMenuLabel(repeat), onSelect: () => openRepeatEditor(t!.id, taskLine.current) }`,
    with `const repeat = workspace ? repeatsIn(workspace).get(t.id) : undefined` beside `planned`.
  - `page-editor.tsx:2600` (the phone bar's `more`): the same item after `Blocked by…`, reading
    `repeatsIn(latestWorkspace.current)`. Its `onSelect` clears the selection as its neighbour does, and anchors to
    the same `.editor-task` element.
  - `tasks-screen.tsx:127`: the same item, anchored to `row.current`.
  A line on a document page still has no menu (`rowMenu` returns null without a page date). Do not add one.
- [ ] **Step 7: See it work.** `npm run dev` (SQLite, sign-in off, http://127.0.0.1:3000). On today's page:
  1. Add a to-do. Open its `⋯`, choose `Repeat…`, choose `Weekly`.
  2. The notice reads `Repeats every week` with Undo.
  3. The menu item now reads `Repeat · Every week…`.
  4. `Off` gives `Repeat off`.
  5. At 390 wide the same from the selection bar's `⋯`, as a sheet with `Done`.
  6. The database Repeat menu on any table's template still looks and works as before.
  `npm run typecheck` and `npm run build`: clean.
- [ ] **Step 8: Commit.** `feat(repeats): Repeat… in a to-do's menu, and its editor`

### Task 8: The mark (integration)

**Files:**
- Modify: `src/components/icons.tsx`, `src/components/blockers.tsx` (line 31), `src/components/todo-repeat.tsx`,
  `src/components/page-editor.tsx` (lines 290–293), `src/components/tasks-screen.tsx` (lines 114–116),
  `src/styles.css`, `scripts/align-fixtures.ts` (after line 235), `scripts/check-alignment.mjs` (line 193)

**Interfaces:**
- Consumes: `repeatsIn`, `repeatMarkName` (Task 3); `openRepeatEditor` (Task 7).
- Produces:

```ts
// icons.tsx
export const RepeatIcon: () => JSX.Element        // the set's own <Icon size={14}>, two arrows round a loop
// blockers.tsx
export const noCaret: { onMouseDown(e: React.MouseEvent): void; onPointerDown(e: React.PointerEvent): void }   // now exported, unchanged
// todo-repeat.tsx
/** The repeat icon at a line's end: not text, a tap opens the editor. */
export function RepeatMark(props: { taskId: string; rule: TodoRepeatRule }): JSX.Element
```

**No-repeat protection:** in `EditorTask` the trailing group's condition gains `|| repeat`, and `repeat` is
`undefined` for every to-do that isn't a repeat's open current one. Its DOM is then byte for byte what it is today,
and so is a Tasks row's. `pixels.mjs` (Task 10) proves it on the built app.

- [ ] **Step 1: The icon.** In `icons.tsx`, with the file's `Icon` at `size={14}` (stroke 1.75, current colour):
  `<path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />`.
- [ ] **Step 2: `RepeatMark`.**
  `<button type="button" contentEditable={false} className="repeat-mark" aria-label={repeatMarkName(rule)} title={repeatMarkName(rule)} aria-haspopup="dialog" {...noCaret} onClick={e => openRepeatEditor(taskId, e.currentTarget)}><RepeatIcon /></button>`.
  It holds no text, so a copy of the line leaves it out. `noCaret` keeps the caret and the phone's keyboard where
  they were.
- [ ] **Step 3: On a line.** In `EditorTask`:
  - `const repeat = workspace && seen?.status === 'open' ? repeatsIn(workspace).get(seen.id) : undefined`. `seen` is
    the tapped state, so the mark goes with the date tag the moment the box is ticked. Use this one value for Task
    7's menu item too.
  - The group at line 290 shows when `hasDateFacts(seen) || since || repeat`, and ends with
    `{repeat && <RepeatMark taskId={seen.id} rule={repeat} />}` after `Since`.
  - It is the same on a plan line, a reference line and a document page. A template's rows have no task
    (`rowsOnly`), so no mark.
- [ ] **Step 4: In Tasks and Upcoming.** In `ListTaskRow`, after the `Not today` tag and before `RowMenu`:
  `{!done && repeat && <RepeatMark taskId={task.id} rule={repeat} />}`, with `repeat` from
  `repeatsIn(workspace).get(task.id)`.
- [ ] **Step 5: CSS,** beside `.editor-since` (line 1100):

```css
/* Repeating to-dos: the mark at a line's end, with the deadline and Since. An icon alone, so the words wrap as they do without it. */
.repeat-mark { position:relative; flex:none; display:inline-grid; place-content:center; width:24px; height:24px; min-height:0; padding:0; border:0; border-radius:var(--radius-control); background:transparent; color:var(--ink-3); cursor:pointer; }
@media (hover:hover) { .repeat-mark:hover { background:var(--app-surface); color:var(--ink); } }
/* A finger's target without a taller row: 44 wide and the line's own 32 high, so it never reaches into the next line. */
@media (hover:none) { .repeat-mark::before { content:''; position:absolute; inset:-4px -10px; } }
.task-row .repeat-mark { margin-top:10px; }
@media (hover:none) { .task-row .repeat-mark::before { inset:-10px; } }
```

  Tokens only, so dark needs nothing. The focus ring is the global one. If the gate in Step 7 shows the mark more
  than 1 px off its line's centre, correct the margin, not the gate.
- [ ] **Step 6: The gate's fixture.** In `scripts/align-fixtures.ts`, add one open to-do `Fixture repeating to-do` to
  the scratch day's to-dos. After the `task-status` lines (234–235) add
  `ws = await run({ type: 'set-todo-repeat', taskId: task('Fixture repeating to-do').id, repeat: { every: 'week', interval: 1, from: 'schedule' }, today, at: new Date().toISOString() })`.
  In `scripts/check-alignment.mjs` line 193, add `['repeat mark', '.repeat-mark']` to the list of a task row's parts
  measured on its first line.
- [ ] **Step 7: Run the gate.**
  1. `cp tests/fixtures/v1/workspace.sqlite <scratch>/w.sqlite`.
  2. `DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=<scratch>/w.sqlite TZ=America/Vancouver node scripts/align-fixtures.ts`.
  3. Build and serve that copy (the command in Task 5 Step 2).
  4. `node scripts/check-alignment.mjs http://127.0.0.1:3391 /day/2026-10-21 /day/<today> /day/2026-12-31`.
  Expected: exit 0, and the output lists `repeat mark` for the fixture row at 1280 and 390. If you cannot run a
  browser, say so.
- [ ] **Step 8: Commit.** `feat(repeats): the repeat icon on a line, in Tasks and Upcoming`

### Task 9: Evidence scripts (integration)

**Files:**
- Create in `tests/evidence/repeating-to-dos/`: `repeat.mjs`, `pixels.mjs`, `weight-seed.ts`, `day-weight.mjs`,
  `limit.ts`, `floor.ts`, `README.md`

**Interfaces:**
- Consumes: Task 5's `seed.ts`; the dependency evidence files as models (`dependency.mjs`, `weight-seed.ts`,
  `day-weight.mjs`, `floor.ts` in `tests/evidence/todo-dependency/`).
- Produces: scripts that print `PASS`/`FAIL` lines and exit 1 on any failure, as the models do.

- [ ] **Step 1: `repeat.mjs`,** on `dependency.mjs`'s harness. `today` is the real day, because the app reads the
  clock. Labels are worked out with the same `toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })`.
  Run every scenario in Chromium and WebKit.

  | | Width | Do | Must hold |
  | --- | --- | --- | --- |
  | R1 | 1280 and 390 | Open `/` | Reply about the offsite and Take the bins out have the same row height (44 at 1280, 32 at 390). `.repeat-mark` count is 4. Book the dentist has a date tag and no mark. The long line's words wrap to the same number of lines as with `plain` seed. The mark's centre is within 1 px of its row's checkbox centre |
  | R2 | 1280 | Reply about the offsite: `⋯` → `Repeat…` → `Weekly` | Notice `Repeats every week`. The store has a repeat for it. Its line has a mark named `Repeats every week`. The menu item reads `Repeat · Every week…`. `Undo` removes the repeat and the mark |
  | R3 | 1280 | Click Weekly review's mark | A dialog with: Repeat = `Weekly`; Every `1` `week`; seven day buttons, today's weekday pressed and disabled; From = `Its day`; Ends = `Never`; last line `Next <today + 7>`. From → `When it's done`: the day buttons go and the line ends ` if done today`. Ends → `On a date`: a date field holding today + 28. `Off`: only the Repeat select is left and the store has no repeat for it |
  | R4 | 1280 | Keyboard only: Tab to Weekly review's mark, Enter, then Tab through | Focus reaches every control in order. Esc closes it and focus is on the mark again |
  | R5 | 1280 | Tick Take the bins out, then `Undo` | `Task completed · Next <tomorrow>`. One next to-do planned tomorrow, with its line on tomorrow's page. After Undo both are gone and tomorrow's document is what it was |
  | R6 | 1280 | Take the bins out: `⋯` → `Cancel task` | `Cancelled · Next <tomorrow>`. One next to-do |
  | R7 | 1280 | As the dependency script's "isn't text" scenario, on Weekly review | End then ArrowDown types on the next line. A copy of the line contains neither `Repeat` nor an extra character |
  | R8 | 390 | Tap Weekly review's mark | No element inside `[contenteditable=true]` has focus. A sheet shows with `Repeat`, the to-do's words and `Done`. Then: handle → bar → `More actions` offers `Repeat · Every week…` under `Blocked by…` |
  | R9 | 1280, `/tasks` | Look, then open a row's menu, then tick Take the bins out | Marks on the four repeating rows. The menu has the Repeat item under `Blocked by…`. Notice `Done · Next <tomorrow>`. `/tasks?view=upcoming` shows the next one under tomorrow, with a mark |
  | R10 | 1280, `/pages?page=notes` | Look, then click the mark | The reference line has a mark and no `⋯`. The editor opens |
  | R11 | 1280 | `context.setOffline(true)`, tick Take the bins out, client-side go to tomorrow, then back online | Offline: no notice contains `Next`, and no new line on tomorrow's page. Online after 6 s: exactly one next to-do, and no notice containing `Next` appears |
  | R12 | 1280 and 390, `colorScheme: 'dark'` | Open `/` and the editor | The mark's computed colour equals the computed `--ink-3`. Screenshots are saved for Task 10 |

- [ ] **Step 2: `pixels.mjs <base-a> <base-b> [shots-dir]`.** Two servers, on two copies of one store seeded with
  `plain` (no repeat): `<base-a>` is a build of the commit this branch left `main` at, `<base-b>` this branch.
  - For each of `/`, `/day/<tomorrow>`, `/tasks`, `/tasks?view=upcoming`, `/pages?page=notes`, at 1280×900 and
    390×780, light and dark: `page.screenshot({ animations: 'disabled', fullPage: true })` on both.
  - PASS when the two buffers are equal. On a difference, write both PNGs and FAIL.
  - Also open one to-do's `⋯` on both and compare the menu's items: the only difference allowed is `Repeat…` under
    `Blocked by…`.
- [ ] **Step 3: R1-18's day.** `weight-seed.ts <store> <today> [repeating]` is the dependency one with links replaced
  by `set-todo-repeat` (daily) on the first `repeating` of lines 0 to 24. Line 25 never repeats. `day-weight.mjs` is
  the dependency one, measuring four things: `words`, `typed`, `tick` (line-0) and `plainTick` (line-25). Reseed
  between runs, because a tick changes the store.
- [ ] **Step 4: `limit.ts`,** pure Node, no browser: `node --no-warnings tests/evidence/repeating-to-dos/limit.ts`.
  Build a workspace in memory with `applyCommand`: 1,001 to-dos over ten day pages. Time, as the median of 21 runs
  each, with 0 and with 1,000 repeats:
  - a tick of the to-do that never repeats
  - a tick of a repeating one
  - `repeatsIn` on a fresh `structuredClone`
  - `dueTodoRepeats`
  - `repeatPages` for a tick
  - the JSON size of `todoRepeats`
  Print one JSON object.
- [ ] **Step 5: `floor.ts <floor-worktree>`,** on `todo-dependency/floor.ts`: the same imports, the same `check`, a
  schema `daythread_test_repeats` dropped before and after.
  1. This build: three to-dos today. Alpha weekly, Bravo daily, Charlie daily.
  2. The floor loads. It ticks Alpha (`task-status` done, `today`), then deletes Bravo's last line with its own
     `save-editor`.
  3. Raw SQL: `todo_repeats` still has three rows, unchanged.
  4. This build loads: `todoRepeats.length === 3`; two stand (Bravo's is kept, not in force);
     `dueTodoRepeats(ws, today)` names Alpha's.
  5. `run-repeats`: Alpha's next exists, planned on a day ≥ today, with its line on that page. A second
     `run-repeats` makes nothing.
  6. An older tab against this server: Charlie ticked with `today` gives a receipt with `message === 'Done'` and one
     `nextTodos` entry. A Cancel with no `today` makes none, and the next `run-repeats` makes it.
  7. This build's Undo of step 6's tick puts the repeat back on Charlie.

  Every write is a real one on the Postgres at `DATABASE_TEST_URL`. The script only runs where that variable and a
  floor worktree exist. It is run by Brian, the Lead or CI, not by this task. `node --check` cannot read `.ts`; check
  it loads with `node --no-warnings tests/evidence/repeating-to-dos/floor.ts` and see it print its usage and exit 2.
- [ ] **Step 6: `README.md`.** For each script: what it proves (the §7 line it answers), the command, and a
  `Results` table left empty for Task 10.
- [ ] **Step 7: Commit.** `test(repeats): evidence scripts for the screen, the weight, the limit and the floor`

### Task 10: Screen checks and the phase's gate (judgment)

**Files:**
- Modify: `tests/evidence/repeating-to-dos/README.md` (results), `docs/design/repeating-to-dos.md` (status line 3:
  phase 2 built)

This task needs a browser. If Playwright's browsers are not installed, stop after Step 1 and report which steps were
not run. Do not install them, and do not mark any step done.

- [ ] **Step 1: The suite.**
  - `npm run typecheck`: clean.
  - `TZ=America/Vancouver FUTURE_DAYS_CONTRACT=1 npm test`: 0 fail. Say which tests were skipped for want of
    `DATABASE_TEST_URL`.
  - `npm run build`: builds.
- [ ] **Step 2: The scripted screen.** Build and serve on a throwaway store (Task 5 Step 2's command). Run `hold.mjs`
  and `repeat.mjs` in Chromium and in WebKit. Expected: every scenario PASS. H7 and R11 state what the page showed
  after coming back online.
- [ ] **Step 3: Unchanged, pixel for pixel.** Make a second worktree at this branch's merge base with `main`, build
  both, and serve each on its own copy of a `plain`-seeded store. `node tests/evidence/repeating-to-dos/pixels.mjs
  <base-a> <base-b> <shots>`: every screenshot equal. Remove the worktree after.
- [ ] **Step 4: The geometry gate.** Task 8 Step 7 again on the final build: exit 0, `repeat mark` measured at 1280
  and 390.
- [ ] **Step 5: The weight.** 9 runs each, alternating, of `day-weight.mjs` on stores seeded with 0 and with 25
  repeating to-dos. Record the medians. Pass:
  - `words`, `typed` and `plainTick` with repeats are within the no-repeat runs' own spread (max minus min) of the
    no-repeat median.
  - `tick` (a repeating to-do's, which also makes a to-do and a line) is recorded beside the no-repeat `tick`, not
    gated.
- [ ] **Step 6: The limit.** `limit.ts`. Pass, with 1,000 repeats against none:
  - the plain tick's median is within 10% or 2 ms;
  - `repeatsIn` is at most 2 ms;
  - `dueTodoRepeats` is at most 10 ms.
  Record every number. If one fails, report it and stop. Do not change `todoRepeatLimits`.
- [ ] **Step 7: By eye, at 1280 and 390, light and dark** (the saved screenshots, then the live app):
  - The mark sits in the trailing group after the deadline and `Since`.
  - A repeating line is exactly as tall as its neighbours.
  - The long line wraps as it does without a repeat.
  - The editor's fields line up as the database Repeat menu's do.
  - The sheet has a 44 px `Done` and 44 px day buttons.
  - Nothing is blue but the focus ring and the checked box.
- [ ] **Step 8: By hand, what no script here covers.** Do each, and write what you saw:
  - H2 by hand if its script could not open a day page in a peek.
  - Week starts Monday (Settings): the day row starts with M. Set weekly on two days, tick, and the next one's day is
    the editor's `Next …`.
  - The editor open while the same to-do is ticked in a second tab: it closes.
  - A drawn `Weekly` refused: in a second tab delete the to-do's line, then choose `Weekly` in the first before it
    reloads. The mark goes back and one notice says `That to-do was deleted`.
  - Tick, then tap the box again within the notice's time, on a page where the next one's page is not open: both
    notices, one to-do left.
  - A To-dos view: tick a repeating row's box (`Done · Next …`), and set Status to Done from the bar on three rows
    of which one repeats (`3 to-dos changed · Next …`).
- [ ] **Step 9: Not run here; name them in the report as open.**
  - A real iPhone or the Simulator: tap the mark with the keyboard up (the keyboard must not change), and tick a
    repeating reference line on the next one's own page with the keyboard up (see "Decisions for Brian" 4).
  - `floor.ts` on real Postgres with a floor worktree.
  - `pixels.mjs` on a copy of Brian's real data.
- [ ] **Step 10: Record and commit.** Fill the README's results. Set the design's status line to "Phases 1 and 2
  built; phase 3 not built". `git diff main --stat` shows no file outside this plan's table.
  `docs(repeats): phase 2 evidence`

## Not in this phase

- Export's "Repeats every week", and a read-only Repeat column in To-dos views (phase 3).
- A menu on a document page's lines. Its to-do is set from Tasks, and once it repeats its icon opens the editor.
- Holding an editor for a tick that is sent later by the outbox (stored offline, or before a reload). See "Decisions
  for Brian" 3.
- A guard on the tick itself when its next to-do can't be made. The tick is refused whole, as phase 1 left it.
- Pruning repeats whose to-do is gone for good.

## Decisions for Brian

The design was silent on each of these, or the code forced a choice. Each is built as stated unless he says otherwise.

| # | Decided | If that is wrong |
| --- | --- | --- |
| 1 | While a tick is unsent, nothing a repeat does is drawn. That means no next line (the design), and also a reopen does not take the next one back on screen until the server answers. | Offline only: a reopened to-do and its next one both show open until he is back online. Drawing the take-back would rewrite another page's document ahead of the server, which is what the design rules out. |
| 2 | If the next one's page has words that can't be saved right now (offline, or already in conflict), the tick still goes, unheld. | That page later shows the conflict line it already has for a change made elsewhere, with his words kept. The other choice was refusing the tick. |
| 3 | A tick stored offline and sent later is not held. A repeating tick now writes the next day's page, so the outbox's row check can hold it as `changed elsewhere · Keep mine · Discard` if that page was changed or made on another device meanwhile. | He sees the banner where a plain tick never showed one. This follows from phase 1's design (a tick writes a page); removing it means changing the server's row check for this case. |
| 4 | When the next line lands on the very page he ticks on (a copied or reference line, or a current one he moved), that editor is held for the round trip. | On a phone with the keyboard up, the keyboard may drop for that moment. This is rare by construction. The existing "button" merge path could add the line with no hold, but would not work for a reopen. |
| 5 | With unsaved words on the next one's page, the tick is stored only after that page's save lands. | A reload in that fraction of a second drops the tick though the box showed it. Row actions already behave so. |
| 6 | The icon is 14 px (the prototype's), not the icon set's 18 to 22. | It may look slight beside the 20 px tags. One number to change. |
| 7 | On a phone the icon's tap target on a line is 44 wide by the line's 32 high; in Tasks it is 44 by 44. | A full 44 high on a line would overlap the next line's icon. |
| 8 | A next day in another year shows the year: `Next Wed, Nov 24, 2027`. | Yearly repeats would otherwise read as this year. |
| 9 | An ended repeat's last line reads `Ends after this one` (the prototype's words). | Copy only. |
| 10 | `Repeat…` is not offered on a to-do with no words. | He can't find why a blank line won't repeat. The command would refuse it anyway. |
| 11 | The weekday row has no label, as the design's sketch shows (the database menu says `On`). The popover's accessible name is `Repeat`; the sheet's is `Repeat · {to-do}`. | Copy and naming only. |
| 12 | Every notice gains the day when exactly one next to-do was made, including a To-dos view's `1 to-do moved to Done` and the bar's `3 to-dos changed`. | `3 to-dos changed · Next Mon, Dec 7` doesn't say which of the three. |
| 13 | The mend skips a repeat it can't make and tries again on the next app open. The tick itself is not guarded. | A stuck repeat costs one silent command per app open. Guarding the tick would copy the workspace on every repeating tick. |
| 14 | The mend is sent held too. | When a mend is due as the app opens, today's page can't be typed into for that round trip. |
| 15 | The app asks for the mend once for each set of due repeats per session. | A mend that fails on the network waits for the next open, or for the set to change. |
| 16 | The measurement bars in Task 10 Steps 5 and 6. | They are mine, not the project's. R1-18 itself states only its own numbers. |
| 17 | In Tasks the icon goes when the row is ticked. | The row's date tag can move sideways by the icon's width in its last second. |
| 18 | Each valid keystroke in `Every` is a command, as in the database Repeat menu. | Typing `25` from `1` sends 2, then 25; Undo goes back to 2. |
| 19 | `Ends → On a date` starts four weeks after the later of its own day and today. `Every` accepts 1 to 999 (the prototype stopped at 99). | Defaults only. |

