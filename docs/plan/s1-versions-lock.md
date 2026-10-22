# S1: per-row versions under one workspace lock

Status: **superseded** by `docs/plan/core-build.md` (no data migration, Brian b15c12ac). Its §2 version rule and §3
named-rows table carry over to the Postgres build (core-build §4); migration 7, the old-tab grace and the SQLite
versions don't. Plan: `docs/plan/supabase-data-model.md` §5 (step A1,
now S1 on the checklist) and §10 R1. Branch `feat/s1-versions` from main 36f0044.

## 1. What S1 changes, and what it leaves

**Changes:**
1. **Conflicts are checked per row, not on the one workspace revision.** A command states the versions of the rows it
   names. It is refused only if one of those rows changed since the client loaded it. Two tabs editing different pages
   or different tasks both succeed.
2. **Every row that changes gets a new version, and only those rows** (pages, tasks, events, materials). Captures keep
   their existing `proposalRevision`.
3. **Contract suite v2.** It replaces "different days at revision 0 → one stale loser" with "both succeed, serialized"
   and adds the cases in §5.

**Unchanged:**
- **The lock:** SQLite's `BEGIN IMMEDIATE` already makes every command run alone. That *is* the workspace lock (§10 R1).
  Postgres gets `SELECT … FOR UPDATE` on the workspace row in S5.
- **`revision`** stays a counter that moves on every committed change. Refresh and save-on-leave use it to drop older
  loads (`use-day.tsx` ~105). It just stops being the conflict check.
- **Undo** keeps today's rule (only if nothing changed since, whole workspace) until S2 replaces it with typed inverses.
- **Whole-workspace load. Decided (Lead a6b074ba):** per-screen reads move to S5, whose gate now measures the phone payload too. They change no stored data, and
  with the server next to the database a whole load is about 10 queries of about 1 ms each at his size. Deferring
  them also removes Ratchet's "a partial slice read as absence" risk from S1 entirely.

## 2. Versions

- **Migration 7:** a `version` column on `pages`, `events` and `materials`, set to 1 for existing rows (current and undo
  snapshots). `tasks.version` already exists. Rollback script 7 → 6: drop the three columns (the layout-6 build checks
  its columns), with no other data to hold.
- **One rule, applied once in `applyCommand` after the action runs:** for every page, task, event and material whose
  stored value differs from before, the version becomes `before + 1`.
  - A task's placements count as part of the task, so moving or excluding it moves the task's version.
  - Explicit `t.version++` calls in the domain stay; the rule only adds a bump where one is missing and never bumps
    twice in one command. So a version moves **if and only if** the row changed, which the existing guards
    (`expectedVersion`, `historyTaskVersions`, `afterVersion`) already rely on.
  - New rows start at 1.

## 3. What a command names, and what it must send

`expected` is a map `{ pages?: {id: version}, tasks?: {…}, events?: {…}, materials?: {…} }`. One domain function,
`namedRows(action, workspace)`, says which rows a command names, from its own fields. The client computes the map from
the workspace it holds, and the server recomputes the set from the action. **Every named row that exists must be in the
map with the current version, or the command is refused** ("Changed elsewhere", the B23 / save-on-leave paths as
today). A row named but not yet existing (an `ensure-day` page, a new task id) needs no entry.

| Action fields | Named rows |
| --- | --- |
| `pageId`, `sourcePageId`, `targetPageId`, `parentId` | those pages |
| `date` (`ensure-day`, `plan-task`, `not-today`, `review-*`, `handoff-done`, `save-review`, `*-draft`, `*-proposal`, `keep-block` `targetDate`, `bring-line`) | the day page for that date, if it exists |
| `from` (`plan-task`) | the day page for `from`, if it exists |
| `taskId`, `items[].taskId`, `updateTaskId` | those tasks |
| `materialId`, `materialIds` | those materials |
| `captureId` | none (it has `proposalRevision`) |
| `trashId` (`restore-batch`) | every page in the batch |
| `save-editor` | its page, **plus** every existing task and event whose title the new document changes through its row (`editor-document.ts` 138–152 rename them today, with a text check that stays as a second guard) |
| `undo` | none: the undo rule is unchanged (§1) |

**Rows a command changes without naming them** are a consequence of the named change, made under the lock against the
current state:
- the descendants of a deleted or moved page;
- the row removed from the source day when `plan-task` moves a task;
- a task's placements on other days;
- Good Stuffs material links found from the page's text.

These are not a lost-update risk: nothing is written from the client's copy of them. Each still gets its new version
under §2.

**Server-only actions** (model results, draft runs) keep `executeOnLatest`: they are built against the state inside
their own transaction and check their own identities (runId, attempt), as today.

**Old tabs after the deploy** send `expectedRevision` and no `expected`. For one release the server accepts that and
applies **today's strict global check**, so an old tab is never looser than before. After that release, a command
without `expected` is refused with "Daythread was updated · reload". That refusal goes through the **existing draft-kept path** ("Couldn't save · draft kept"),
and the reload restores the text through save-on-leave's stuck-draft rule, so nothing typed in a tab left open across
two releases is lost (Bumblebee 4950afc8).

## 4. Browser

- `run(workspace, action)` sends `expected = expectedFor(workspace, action)` (the same `namedRows`, shared code) with
  `expectedRevision` for the one-release fallback.
- The editor's save sends its page version and the versions of the tasks whose rows it edited. The local previews in
  `page-editor.tsx` (441 / 686 / 756 / 905) keep calling `applyCommand` on their own copy, so they pass the same map.
- A refused command reads "Changed elsewhere" for the named row. The save paths keep the draft and Load latest, as
  B23 / save-on-leave do now. Screens re-sync before any retry, as today.

## 5. Checks

**Contract suite v2** (`tests/repository-contract.ts`, the SQLite adapter, and Postgres in S5):
1. Two clients creating different days from the same snapshot: **both succeed**, serialized; revision moves by 2.
2. The same page saved from two snapshots: the second is refused, and recovers after a reload.
3. A task changed in one tab (status) and the same task planned from a stale tab: the second is refused. A
   **different** task from the stale tab succeeds.
4. Lost-response replay, a changed fingerprint refused, rollback after a storage failure after writes: kept from v1.
5. An old-client command with only `expectedRevision` gets the strict global check.
   After the grace release, an old client saving a page is refused through the draft-kept path; after the reload its
   draft is restored and saved once, with nothing duplicated (browser check).
6. Two budget reservations racing for the last of the day's budget: exactly one fits (the ledger already sums under
   the same transaction; the test pins it).

**Domain unit tests:**
- `namedRows` for every action type (a table-driven test, so a new action can't ship without an entry).
- The version rule: a row that didn't change keeps its version; a row changed by an explicit `++` and by the rule is
  bumped once.

**Migration:**
- 6 → 7 → 6 → 7 on a fresh copy of his data.
- The layout-6 build opens the rolled-back file.
- Everything except the three version columns is equal across the round trip.

**Browser, on a fresh copy:**
- Two tabs editing different pages, both saved: no conflict line.
- The same page: B23's Load latest, as today.
- Ticking a task in one tab while another tab moves a different task: both apply.
- `two-tabs.mjs`, B23 `check.mjs`, `save-on-leave/check.mjs`, Ratchet's `races.mjs` and the alignment gate all pass.
  (They still pass because the save paths keep their checks; only unrelated rows stop conflicting.)

## 6. Size and risk

About **4 days**, down from 4–5 if per-screen reads move to S5. The main risk is a command that changes a row through
the client's copy without naming it. The table-driven `namedRows` test and a review of each `execute` case against it
are the guard; Ratchet's read of §3 is the pre-check.
