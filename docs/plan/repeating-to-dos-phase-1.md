# Repeating to-dos, phase 1 (no screen): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repeat is stored in its own table, names one current to-do, and finishing that to-do makes the next one,
planned on its next day. This phase has no screen: commands, the mend on opening the app, storage, tests.

**Architecture:** A pure module (`src/domain/todo-repeats.ts`) holds the type, the schedule and the words. The reducer
in `src/domain/workspace.ts` gets one new command (`set-todo-repeat`) and three hooks: `task-status` makes or takes
back the next one, `edit-todos` passes that on, `run-repeats` mends a finished current one. Storage follows task links
exactly: optional on `Workspace`, `Rows`, `RowDiff` and `WorkspaceChanges`, one Postgres table created inline.

**Tech Stack:** TypeScript run by Node 24 type stripping, `node:test`, zod, PGlite in tests, Postgres in production.

**Spec:** `docs/design/repeating-to-dos.md` (approved by Brian 2026-11-24). §4 is the rules, §6 the builder's notes.

**Phases 2 and 3** (the menu, editor, icon and notices; export and the To-dos column) get their own plans once this
phase's interfaces exist in code.

## Global Constraints

- English only in code, comments, commit messages and docs.
- No new dependency.
- Erasable TypeScript only (no `enum`, no parameter properties), and value imports carry the `.ts` extension in any
  file a test reaches. Type-only imports may omit it.
- A to-do with no repeat must not change in any way: the whole existing suite stays green, untouched.
- Copy is exact: `Repeats every week`, `Repeat off`, `Reopen it first`, `Nothing to change`, `Invalid repeat`,
  `That to-do was deleted`, `That to-do is in Trash`, `A to-do needs words`, `1,000 repeating to-dos at most`.
- The receipt's `message` for a tick stays `Done` / `Cancelled` / `Reopened`: an older tab reads only that.
- Run tests as CI does: `TZ=America/Vancouver node --test <file>`. Typecheck: `npm run typecheck`.
- Commits: `feat(repeats): …` / `test(repeats): …`, one per task. Do not push. Do not open a PR.
- The behaviour tests in `tests/todo-repeats-schedule.test.ts` and `tests/todo-repeats.test.ts` are the spec in
  executable form and were written first. **Never change an asserted value or message in them to make a test pass.**
  If a test fails because of its own setup (a helper used wrongly, an action shape), fix the setup, and say so in the
  report. If a test seems to contradict the spec, stop and report it.

## Review Focus

Each has a test in `tests/todo-repeats.test.ts` or `tests/todo-repeats-schedule.test.ts` already (named in brackets).

1. The next one's day page is in Trash: it lands on a new live page for that day (`…day page is in Trash…`, Task 3).
2. A finished current one whose page is in Trash: not mended, and not reported due, or every app open would write a
   revision and clear Undo (`…whose page is in Trash is not mended…`, Task 4).
3. A to-do that two repeats remember as their previous one: reopening checks every repeat, takes back one at most
   (`a to-do two repeats remember…`, Task 3).
4. The next one's id is already a live to-do: it is adopted, no second task or line (`…already exists is adopted…`,
   Task 3).
5. A schedule too long to walk (`maxWalk`) has ended; nothing hangs or throws (`a schedule too long to walk…`, Task 1).

## File structure

| File | Responsibility |
| --- | --- |
| `src/domain/repeats.ts` (modify) | Export the one new schedule function, `firstOccurrenceAfter`. |
| `src/domain/todo-repeats.ts` (create) | `TodoRepeat`, the next day, the mend's day, the words, what is due. Pure: imports `./repeats.ts`, `./database.ts` (`addDays`) and types only. Never `./workspace.ts`. |
| `src/domain/types.ts` (modify) | `Workspace.todoRepeats?`, `Receipt.nextTodos?`, the `set-todo-repeat` action. |
| `src/domain/command-schema.ts` (modify) | The action's zod schema. |
| `src/domain/workspace.ts` (modify) | The `set-todo-repeat` case; `advanceRepeat` and `takeNextBack` beside `planOn`; hooks in `task-status`, `edit-todos`, `run-repeats`. |
| `src/domain/todos-source.ts` (modify) | Cancel from a To-dos view sends `today`. |
| `src/domain/workspace-changes.ts` (modify) | The browser's changes carry `todoRepeats`. |
| `src/server/workspace-rows.ts` (modify) | `TodoRepeatRow`, `Rows.repeats?`, `RowDiff.repeats?`, both converters. |
| `src/server/postgres-repository.ts` (modify) | The `todo_repeats` table, read and write. |
| `src/server/outbox-replay.ts`, `src/components/outbox.ts` (modify) | The `repeat:<id>` row key, server and browser. |
| `src/components/draw-ahead.ts` (modify) | The new action's draw rule and held-notice words. |
| `src/components/app-shell.tsx`, `task-row.tsx`, `page-editor.tsx` (modify) | The mend's gate on open; Cancel and Restore send `today`. |
| `tests/todo-repeats-storage.test.ts` (create) | Rows, older inverse, browser changes, PGlite store. |

---

### Task 1: The schedule and the words

**Files:**
- Modify: `src/domain/repeats.ts` (`occurrences`, about line 22)
- Create: `src/domain/todo-repeats.ts`
- Modify: `src/domain/types.ts` (`Receipt`, `Workspace`)
- Test: `tests/todo-repeats-schedule.test.ts` (exists, 10 tests)

**Interfaces:**
- Consumes: `occurrences(repeat, weekStart)` and `Repeat` as they are; `addDays` from `./database.ts`.
- Produces:

```ts
// src/domain/repeats.ts
/** The first schedule day strictly after `after`; null when the walk ends first. */
export function firstOccurrenceAfter(repeat: Pick<Repeat, 'every' | 'interval' | 'start' | 'weekdays'>, after: string, weekStart: WeekStart = 0): string | null

// src/domain/todo-repeats.ts
export interface TodoRepeat {
  id: string
  /** The current to-do, and the schedule day it was made for. Planned moves with Another day; this doesn't. */
  taskId: string; slot: LocalDate
  /** The one before, so reopening it can take the next one back. One step only. */
  previous?: { taskId: string; slot: LocalDate }
  /** Where the schedule starts. Fixed, so monthly from the 31st stays the 31st after a February. */
  start: LocalDate
  every: 'day' | 'week' | 'month' | 'year'; interval: number
  /** Weekly and `from: 'schedule'` only, 0 is Sunday. The start's weekday when absent. */
  weekdays?: number[]
  from: 'schedule' | 'done'
  until?: LocalDate
  createdAt: string
}
export type TodoRepeatRule = Pick<TodoRepeat, 'every' | 'interval' | 'weekdays' | 'from' | 'until'>
export const todoRepeatLimits = { total: 1_000 } // a mutable object, as linkLimits is: a test lowers it
export const repeatTaskId = (repeatId: string, slot: LocalDate): string // `${repeatId.slice(0, 100)}.${slot}`
/** Repeats whose current to-do is in `ws.tasks`. One whose to-do is gone is kept, not in force. */
export function standingRepeats(ws: Pick<Workspace, 'todoRepeats' | 'tasks'>): TodoRepeat[]
/** The standing repeat this to-do is the current one of. */
export function repeatOf(ws: Pick<Workspace, 'todoRepeats' | 'tasks'>, taskId: string): TodoRepeat | undefined
export function nextDay(repeat: TodoRepeat, finishedOn: LocalDate, weekStart: WeekStart = 0): LocalDate | null
export function mendDay(repeat: TodoRepeat, finishedOn: LocalDate | null, today: LocalDate, weekStart: WeekStart = 0): LocalDate | null
export function repeatWords(rule: TodoRepeatRule): string
export interface DueTodoRepeat { repeat: TodoRepeat; on: LocalDate }
/** Standing repeats whose current to-do is finished and whose mend day exists. With `live`, only to-dos in it. */
export function dueTodoRepeats(ws: Pick<Workspace, 'todoRepeats' | 'tasks' | 'weekStart'>, today: LocalDate, live?: ReadonlySet<string>): DueTodoRepeat[]

// src/domain/types.ts
// Workspace: /** Repeating to-dos (todo-repeats.ts), in a table of their own. Absent until there's one. */
todoRepeats?: import("./todo-repeats.ts").TodoRepeat[];
// Receipt: /** The to-dos a repeat made in this command, for the notice. */
nextTodos?: Array<{ taskId: string; on: LocalDate }>;
```

- [ ] **Step 1: Run the tests and see them fail.** `TZ=America/Vancouver node --test tests/todo-repeats-schedule.test.ts`.
  Expected: FAIL, `Cannot find module …/src/domain/todo-repeats.ts`.
- [ ] **Step 2: `firstOccurrenceAfter` in `repeats.ts`.** Widen `occurrence`/`occurrences` to the `Pick` above; walk
  `occurrences` and return the first date `> after`.
- [ ] **Step 3: `todo-repeats.ts`.** The two day functions are the only algorithm:

```ts
const step = (r: TodoRepeat, day: LocalDate) => firstOccurrenceAfter({ every: r.every, interval: r.interval, start: day }, day)
const within = (r: TodoRepeat, d: LocalDate | null) => (d && (!r.until || d <= r.until) ? d : null)
// nextDay: schedule → firstOccurrenceAfter(r, later of r.slot and finishedOn, weekStart); done → step(r, finishedOn)
// mendDay: schedule → firstOccurrenceAfter(r, later of r.slot and addDays(today, -1), weekStart)
//          done → finishedOn ? later of step(r, finishedOn) and today : step(r, today)
// both through within()
```

  `repeatWords`: `every day|week|month|year`, or `every N days|weeks|months|years`; then, for `from: 'schedule'`
  with `weekdays`, ` on Mon, Thu` (sorted 0 to 6, three-letter English names); for `from: 'done'`,
  `, from when it's done` and no weekdays. `dueTodoRepeats`: a done to-do's `finishedOn` is its `doneOn ?? null`; a
  cancelled one's is `null`.
- [ ] **Step 4: The two `types.ts` fields.**
- [ ] **Step 5: Run.** Same command. Expected: 10 pass. Then `npm run typecheck`: no new error outside
  `tests/todo-repeats.test.ts` (it needs Task 2's action).
- [ ] **Step 6: Commit.** `feat(repeats): the schedule of a repeating to-do`

### Task 2: `set-todo-repeat`

**Files:**
- Modify: `src/domain/types.ts` (the `Action` union), `src/domain/command-schema.ts` (after `link-tasks`, line 92),
  `src/domain/workspace.ts` (a case after `link-tasks`, line 1042), `src/components/draw-ahead.ts`
- Test: `tests/todo-repeats.test.ts`: `setting a repeat changes nothing…`, `what is refused…`, `over the limit…`,
  `the command passes the schema…`

**Interfaces:**
- Consumes: Task 1's module; `plannedOn`, `liveTaskIds`, `isBlankTask`, `date`, `isoTime`, `newId`, `DomainError`.
- Produces:

```ts
| { type: "set-todo-repeat"; taskId: string; repeat: import("./todo-repeats.ts").TodoRepeatRule | null; today: LocalDate; at: string }
```

- [ ] **Step 1: Run the four tests, see them fail.**
  `TZ=America/Vancouver node --test --test-name-pattern='setting a repeat|what is refused|over the limit|passes the schema' tests/todo-repeats.test.ts`
- [ ] **Step 2: The action and its schema.** `every` one of four, `interval` an integer 1 to 999, `weekdays` optional,
  1 to 7 integers 0 to 6, `from` `schedule` or `done`, `until` an optional day; `repeat` nullable; `today` a day;
  `at` as `link-tasks` has it.
- [ ] **Step 3: The case.** In this order, each failure a `DomainError`:
  1. The to-do isn't in `state.tasks`: `That to-do was deleted`.
  2. `repeat === null`: remove the repeat whose `taskId` is this to-do; none: `Nothing to change`. Message
     `Repeat off`. No status check: Off is allowed on any current one.
  3. `interval` not an integer 1 to 999, or `weekdays` given and empty or holding anything but integers 0 to 6:
     `Invalid repeat`. `until` and `today` through `date()` (`Invalid calendar date`).
  4. Status not open: `Reopen it first`. `isBlankTask`: `A to-do needs words`. Not in `liveTaskIds`: `That to-do is in Trash`.
  5. Weekdays are kept only for `every: 'week'` with `from: 'schedule'`, sorted and unique, and dropped when they are
     exactly the weekday of the anchor (the existing repeat's `slot`, else the start below).
  6. No repeat yet: `start` is `plannedOn(state, id)` when it has one and isn't paused, else `today`; `slot = start`;
     `id: newId()`, `createdAt: isoTime(action.at)`. Absent fields are omitted, never `undefined`.
  7. A repeat exists: if `every`, `interval` or the kept weekdays differ, `start = slot`. `from` and `until` alone
     leave `start`. Nothing differs: `Nothing to change`. The current to-do's day never moves.
  8. `standingRepeats(state).length > todoRepeatLimits.total`: `` `${total.toLocaleString("en-US")} repeating to-dos at most` ``.
  9. `delete state.todoRepeats` when the list is empty. Return `` { message: `Repeats ${repeatWords(rule)}`, entityId } ``.
- [ ] **Step 4: `draw-ahead.ts`.** `'set-todo-repeat': 'ahead'`, with the held words
  `['Repeat not saved', 'to-do', 'repeat may already be saved']`. Then `npm run typecheck`, and give every other
  per-action table it names an entry in the style of `link-tasks`.
- [ ] **Step 5: Run.** The command from step 1: 4 pass. `TZ=America/Vancouver node --test tests/draw-ahead.test.ts`: pass.
- [ ] **Step 6: Commit.** `feat(repeats): set, change and turn off a to-do's repeat`

### Task 3: Finishing makes the next; reopening takes it back

**Files:**
- Modify: `src/domain/workspace.ts` (two functions after `planOn`, line 594; `task-status`, line 1043; `edit-todos`,
  line 1766), `src/domain/todos-source.ts` (line 146)
- Test: `tests/todo-repeats.test.ts`: every test not named in Tasks 2 and 4

**Interfaces:**
- Consumes: `nextDay`, `repeatTaskId`; `ensureDay`, `createTask`, `planOn`, `taskRows`, `plannedOn`, `removeNodes`,
  `docOf`, `setDocument`, `inlineText`, `textRun`, `newId`.
- Produces (private to `workspace.ts`):

```ts
/** Makes the repeat's next to-do on `on` (or adopts a live one with its id) and moves the repeat on to it. */
function advanceRepeat(state: Workspace, repeat: TodoRepeat, current: Task, on: string, createdOn: string): { taskId: string; on: string }
/** `t` was just reopened: a repeat that remembers it takes its next one back, while that one is as it was made. */
function takeNextBack(state: Workspace, t: Task): void
```

  `execute`'s declared return type gains `nextTodos?: Receipt["nextTodos"]`, and so does `result` in `applyCommandAs`.

- [ ] **Step 1: Run the file, note what fails.** `TZ=America/Vancouver node --test tests/todo-repeats.test.ts`.
- [ ] **Step 2: `advanceRepeat`.**
  1. `id = repeatTaskId(repeat.id, on)`. A task with that id in `state.tasks`: adopt it (step 5 only).
  2. Drop a tombstone with that id from `state.deletedTasks`.
  3. The line to copy: the current to-do's plan row on its planned day's page, else its first row (`taskRows`), else
     none. Copy its `content` deep. In the copy, a `dateMention` gets `date` moved by `on − repeat.slot` days and a
     new `eventId` (`newId()`), its `time` kept; a `pageRef` gets a new `refId`, as the copy at line 897 does. No row:
     `[textRun(current.title)]`.
  4. `createTask(state, inlineText(content, on), ensureDay(state, on), createdOn, id)`. `deadlineOn` and
     `attentionOn`, when the current one has them, moved by the same number of days. `planOn(state, next, on)`, then
     give that plan row the copied `content` and no children. Its `version` stays 1.
  5. `repeat.previous = { taskId: current.id, slot: repeat.slot }; repeat.taskId = id; repeat.slot = on`.
- [ ] **Step 3: `takeNextBack`.** For each repeat whose `previous.taskId` is `t.id`: its next one is as made when it is
  in `state.tasks`, open, not paused, `version === 1`, has exactly one row, and `plannedOn` is `repeat.slot`. Then
  remove that row from its page, remove the task from `state.tasks` (no tombstone), set `taskId = t.id`,
  `slot = previous.slot`, delete `previous`, and stop. Otherwise leave everything.
- [ ] **Step 4: `task-status`.** Keep `was = t.status` before the write. From open to done or cancelled, with
  `action.today`, and a repeat whose `taskId` is this to-do, and `nextDay(repeat, today, state.weekStart ?? 0)`
  not null: `advanceRepeat(…, today)` and return it as `nextTodos: [made]`. From done or cancelled to open:
  `takeNextBack`. The message and `doneOn` are untouched.
- [ ] **Step 5: `edit-todos` and `todos-source.ts`.** Collect `nextTodos` from each nested `execute` and return them
  when there are any. In `todoChange`, the cancelled action gains `today`.
- [ ] **Step 6: Run.** The whole file: every test passes except `Cancel skips this one…`, `the mend after a tick…` and
  `…whose page is in Trash is not mended…`, which need Task 4. Then
  `TZ=America/Vancouver node --test tests/task-links.test.ts tests/task-commands.test.ts tests/todo-rules.test.ts tests/todos-source.test.ts tests/carried.test.ts`: all pass.
- [ ] **Step 7: Commit.** `feat(repeats): finishing the current to-do makes the next one`

### Task 4: The mend on opening the app

**Files:**
- Modify: `src/domain/workspace.ts` (`run-repeats`, line 1621), `src/components/app-shell.tsx` (line 76),
  `src/components/task-row.tsx` (line 32), `src/components/page-editor.tsx` (line 2546)
- Test: `tests/todo-repeats.test.ts`: `Cancel skips this one…`, `the mend after a tick…`,
  `…whose page is in Trash is not mended…`

**Interfaces:**
- Consumes: `dueTodoRepeats`, `advanceRepeat`, `liveTaskIds`.

- [ ] **Step 1: Run the three tests, see them fail.**
- [ ] **Step 2: `run-repeats`.** After the template loop:
  `for (const { repeat, on } of dueTodoRepeats(state, action.today, liveTaskIds(state)))` call `advanceRepeat` with
  the repeat from `state.todoRepeats`, its current task, `on` and `action.today`. The message and the receipt are
  as before: the mend says nothing.
- [ ] **Step 3: The gate in `app-shell.tsx`.** Today it returns unless `dueRepeats` or `dueRules` has something. Add a
  third reason: `workspace.todoRepeats?.length`, and `dueTodoRepeats(workspace, today)` non-empty, and then the same
  call with `liveTaskIds(workspace)` non-empty. The cheap call first: `liveTaskIds` reads every page.
- [ ] **Step 4: Cancel and Restore send the day.** The `task-status` sent by `task-row.tsx:32` and
  `page-editor.tsx:2546` gains `today` (the same today helper each file already uses for a tick).
- [ ] **Step 5: Run.** `TZ=America/Vancouver node --test tests/todo-repeats.test.ts tests/todo-repeats-schedule.test.ts tests/repeats.test.ts`:
  all pass. `npm run typecheck`: clean.
- [ ] **Step 6: Commit.** `feat(repeats): mend a finished current to-do on opening the app`

### Task 5: Storage

**Files:**
- Modify: `src/server/workspace-rows.ts`, `src/server/postgres-repository.ts`, `src/server/outbox-replay.ts`
  (`writeKeys`, line 40), `src/components/outbox.ts` (`predictedWrites`, line 32), `src/domain/workspace-changes.ts`,
  `docs/design/outbox.md` (the list of tables that carry a revision column)
- Create: `tests/todo-repeats-storage.test.ts`

**Interfaces:**
- Produces:

```ts
// workspace-rows.ts
/** A repeating to-do's rule: its own table, which an older build never reads, so its saves and Undo leave it alone. */
export interface TodoRepeatRow { id: string; task_id: string; slot: string; previous_task_id: string | null; previous_slot: string | null; starts_on: string; every_unit: TodoRepeat['every']; every_count: number; /** JSON, "[1,4]"; null when absent. */ weekdays: string | null; counts_from: TodoRepeat['from']; ends_on: string | null; created_at: string }
// Rows:    /** Absent from a store before repeating to-dos. */ repeats?: TodoRepeatRow[]
// RowDiff: /** Absent in one written before repeating to-dos, which then leaves them as they are. */ repeats?: RowSet<TodoRepeatRow>
// workspace-changes.ts, WorkspaceChanges: /** Repeating to-dos, whole, when any changed. */ todoRepeats?: TodoRepeat[]
```

```sql
create table if not exists ${s}.todo_repeats (
  workspace_id uuid not null references ${s}.workspaces (id) on delete cascade,
  id text not null, task_id text not null, slot text not null, previous_task_id text, previous_slot text,
  starts_on text not null, every_unit text not null, every_count integer not null, weekdays text,
  counts_from text not null, ends_on text, created_at text not null,
  primary key (workspace_id, id)
);
alter table ${s}.todo_repeats enable row level security;
```

- [ ] **Step 1: Write `tests/todo-repeats-storage.test.ts`, failing.** A `setup()` that makes a to-do on Monday
  2026-11-23, sets it weekly and ticks it (so the repeat has `previous`), and a second repeat with
  `{ every: 'week', interval: 2, from: 'schedule', weekdays: [1, 4], until: '2027-01-01' }`. Tests:
  1. `repeats go through the rows and back, an inverse from before them leaves them, and the browser's changes carry them`:
     modelled line for line on `tests/task-links.test.ts:122`. `workspaceOf(rowsOf(ws)).todoRepeats` deep-equals
     `ws.todoRepeats`; `planWrites` of the tick has `write.repeats.upsert.length === 1` and its inverse upserts the
     row as it was; `applyDiff(after, inverseWithoutRepeatsKey)` leaves `todoRepeats` as they are;
     `applyChanges(before, changesBetween(before, after)).todoRepeats` deep-equals `after.todoRepeats`; and a
     workspace with none has no `todoRepeats` key after the round trip.
  2. `the row check sees a repeat`: `writeKeys(write)` includes `` `repeat:${id}` ``, and
     `predictedWrites(before, after)` includes the same key and `` `task:${nextId}` ``.
  3. `on the database: a schema from before gets the table, the repeat survives a restart, and Undo comes from the inverse`:
     PGlite, modelled on `tests/comments-property.test.ts:101` and `tests/shot2-storage.test.ts:115`.
     `drop table daythread.todo_repeats`, a new repository's `prepare()` brings it back with RLS on; set and tick
     through `repo.execute`; a second repository instance's `load()` has the same `todoRepeats` and the next to-do;
     Undo of the tick through `execute` puts the repeat back on the first to-do; then tick again, strip the
     `repeats` key from that operation's stored `inverse`, Undo, and the repeat row is as the tick left it.
  4. `SQLite keeps repeats in its document`: the fixture of `tests/v2-storage.test.ts`, set, tick, a second
     instance's `load()`.
- [ ] **Step 2: Run it, see it fail.** `TZ=America/Vancouver node --test tests/todo-repeats-storage.test.ts`
- [ ] **Step 3: `workspace-rows.ts`.** `repeatRow` and `repeatOfRow` beside `linkRow` and `linkOf` (absent fields
  omitted on the way back, `weekdays` through `JSON`); `workspaceOf` adds `todoRepeats` only when there are rows,
  sorted by `created_at` then `id`; `rowsOf`, `planWrites` and `applyDiff` treat `repeats` exactly as `links`.
- [ ] **Step 4: `workspace-changes.ts`.** `todoRepeats` beside `links` in `changesBetween` and `applyChanges`.
- [ ] **Step 5: `postgres-repository.ts`.** The DDL above after `task_links`; `'todo_repeats'` in the list `complete()`
  requires (line 75), in `outboxRowTables` (line 43) and as `repeat: 'todo_repeats'` in `rowTableOf` (line 45);
  a `repeatColumns` list; the read in `readRows` (line 257); the write in `writeDiff` (line 305).
- [ ] **Step 6: The row key.** `add('repeat', write.repeats)` in `writeKeys`;
  `diff('repeat', before.todoRepeats, after.todoRepeats)` in `predictedWrites`.
- [ ] **Step 7: Run.** The new file passes. Then
  `TZ=America/Vancouver node --test tests/shot2-storage.test.ts tests/v2-storage.test.ts tests/comments-property.test.ts tests/task-links.test.ts tests/outbox-replay.test.ts`:
  all pass (a test that lists the store's tables gets `todo_repeats` added, nothing else changes).
- [ ] **Step 8: `docs/design/outbox.md`.** Add `todo_repeats` where the tables with a revision column are listed.
- [ ] **Step 9: Commit.** `feat(repeats): store repeats in a table of their own`

### Task 6: The phase's gate

- [ ] **Step 1:** `npm run typecheck`. Expected: clean.
- [ ] **Step 2:** `TZ=America/Vancouver FUTURE_DAYS_CONTRACT=1 npm test`. Expected: 0 fail. Tests that need
  `DATABASE_TEST_URL` are skipped; say so.
- [ ] **Step 3:** `npm run build`. Expected: builds.
- [ ] **Step 4:** `git diff main --stat -- src/components` shows only `draw-ahead.ts`, `outbox.ts`, `app-shell.tsx`,
  `task-row.tsx`, `page-editor.tsx`, a few lines each: nothing a person can see changed.

## Not in this phase

- Any screen: the menu item, the editor, the icon, the notice that names the next day (phase 2).
- A tick drawn ahead by `edit-todos` in the browser would also draw the next line. Nothing can make a repeat before
  phase 2, which must hold that prediction back (spec §3).
- The floor build's evidence run on real Postgres (`tests/evidence/…/floor.ts`) and the R1-18 measurement: with the
  screen, before the feature can be reached.
- Pruning repeats whose to-do is gone for good. They are kept and don't count toward the limit.
- A rule on "a to-do is added" does not run for a next one the mend makes, as `run-repeats` runs no rules.
