# The model after shot 1 (v2)

Two kinds of record are stored. Everything else is read from the page documents.

| Stored | Fields |
| --- | --- |
| Page | `id`, `type` (daily, document), `date`, `title`, `url` (bookmark pages), `parentId`, `trashedAt`/`trashId`, `document` (the BlockNote JSON), `handoffDone`, `reviewSaved` |
| Task | `id`, `title`, `status`, `version`, `paused`, `deadlineOn`, `attentionOn` (start), `createdOn`, `sourcePageId`, `doneOn` |

The workspace keeps `deletedTasks` (the last 100 tasks deleted with their line, so ⌘Z brings one back whole), the
receipts and the one Undo slot, as before, and its `timezone` (the account's, `set-timezone`). `schemaVersion` is 2.

## Derived, never stored

- **Planned on a day**: a task row (`type: task`, `props.role: plan`) on that day's page. The newest day page with
  such a row is the task's plan (`plannedOn`). A row on an earlier day stays as history and shows "Moved to …".
- **Order**: document order, nested rows right after their parent.
- **Carry-over**: open, not paused, with a plan row on the previous day page and none on today's.
- **Events**: `@date` chips in any line of any live page (`chip-events.ts`).
- **Tags, Linked from, the task tree, Upcoming, the calendar**: from the documents and the task fields.

## Headings

The day template (`dayTemplate` in `editor-document.ts`) is TODO, Events, Good Stuffs, Notes: plain headings with one
empty row each. Nothing reads a heading's name except two display anchors: the event rows draw under a heading titled
"Events", and a brought line lands under the heading of the same name as on the previous day (else Notes). No cap,
no protected heading, no behaviour attached to a name.

## Commands

`save-editor` (the page's document; a born-here task whose last row goes is tombstoned; today's plan row removed one
at a time is Not today), `ensure-day`, `add-task`, `task-status`, `plan-task`, `plan-tasks`, `not-today`,
`remove-task-row`, `bring-line`, `handoff-done`, `save-review`, `create-document`, `make-link-pages`,
`apply-link-preview`, `rename-page`, `move-page`, `delete-page`, `restore-page`, `restore-batch`, `set-timezone`, `undo`.

Text is kept as typed, except U+0000, which no Postgres text column can hold: the domain drops it on the way in.

## Conversion from v1

`src/domain/convert-v1.ts` turns a v1 workspace (sections, placements, events, materials, captures) into v2,
deterministically. The SQLite store converts a layout-1..7 file in place on first open; the Postgres store converts a
v1 row as it is read and stores v2 on the next write. `tests/v2-convert.test.ts` runs it over
`tests/fixtures/v1/workspace.json`, built with the v1 code.

Cutover: back up the live row, deploy, open the app once. Rollback: restore the backup row and redeploy the old build.

## Storage after shot 2 (Postgres, one workspace per account)

`src/server/postgres-repository.ts` keeps the workspace as rows, every one carrying its `workspace_id`:

| Table | Holds |
| --- | --- |
| `workspaces` | `id`, `user_id` (one per account; null for the local workspace with sign-in off), `revision`, `timezone` |
| `pages` | one row per page, the document as text, exactly as written |
| `tasks` | one row per task |
| `deleted_tasks` | the tombstones, as the task's JSON |
| `operations` | one row per command: the receipt (replay) and an inverse (the rows as they were, for Undo); null for `ensure-day` and `undo` |

A command locks the workspace row, reads the rows, applies the domain command (`applyCommand`, unchanged) with the
one receipt it may be a replay of and, for an Undo, the previous state rebuilt from the target operation's inverse,
then writes only the rows that changed (`src/server/workspace-rows.ts` plans them and keeps positions stable, so an
append or a removal rewrites only the rows involved). Undo therefore needs no second copy of the workspace; walking
the log for multi-step Undo is possible later.

Row-level security is on with no policies (Supabase's Data API serves nothing to the publishable key); isolation is
the server's: every statement is scoped by the signed-in account's workspace id (`request-owner.ts`).

Shot 1's single row (`daythread.workspace`) is migrated on the first start of the shot 2 build into its account's
workspace (the local one when it was never linked) and the table is renamed `workspace_shot1`, the rollback copy.
The SQLite store on the Mac keeps its one-document layout: no accounts there.

Accounts: `src/server/auth/accounts.ts` (the account rows and the invite list), `server.ts` (sign-in, sign-up,
delete-account), `docs/ops/credentials.md` (the switches).
