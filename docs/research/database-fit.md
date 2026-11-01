# Databases: how they fit what Daythread stores

Research for Brian's request (#daythread 4b92568d, 2026-11-01): Notion-like databases, inline and full page. This is the
engineering fit only; Notion's model is Bumblebee's `docs/research/notion-database-model.md`, the interactions are
Jazz's. No code is proposed for merging; the one script here is a measurement.

Status: research, not a decision. Facts are from `main` at d0861c3f and from the measurement below; anything marked
"estimate" or "not measured" is a judgment.

## 1. Summary

- **The Lead's mapping fits, with one addition.** A database is a page with a schema and views; a row is a child page
  with property values; an inline database is a block in the host page's document pointing at the database page. All
  three ride on things we already have: `parentId`, page positions, the subtree used by Trash, per-parent templates, and
  the `pageLink` block. The addition: rows must be marked as rows, so the page tree, Pages, search and `[[` don't list
  hundreds of children as ordinary subpages.
- **Storage:** two nullable JSON columns on `pages` (schema+views on the database page, values on a row). No new table,
  no change to how commands, Undo, replay or positions work. Postgres needs its first column migration (the current
  `init` only creates missing tables).
- **Edits:** a cell edit is one command, one Undo, like a tick. It should carry its own per-row check so an edit on
  another page, or on another device, doesn't refuse it, the same way editor saves already resend once.
- **Limit:** the whole workspace is read, cloned, and sent to the browser on every command. Measured: each 1,000 rows
  adds about 0.85 MB to every load and every command response, and about 2 ms of server CPU per command. A first
  version is comfortable to a few hundred rows in total; past roughly 1,000 rows we must stop sending the whole
  workspace back on each command (the server already computes the changed rows, so this is a contained change).
- **To-dos:** three options with costs in section 6. Not decided here.
- **Size of a first version (estimate):** table view, the common property types, inline and full page, a row opening as
  a page, one sort and filters: about 4 to 6 days of engineering, plus design and review.

## 2. What exists today

| Fact | Where |
| --- | --- |
| Two stored records: `Page` (title, `parentId`, `document` as BlockNote JSON, trash fields) and `Task`. Everything else is read from documents. | `src/domain/types.ts` |
| Page types: `daily`, `document`, `template`, `draft`. `template` and `draft` are pages that no page command lists or opens: the precedent for special pages. | `types.ts`, `workspace.ts` `page()` |
| Postgres: one row per page and per task, with a `position` per row; a command locks the workspace row, reads **every** page, task and tombstone, applies the domain command, and writes only the rows that changed. The inverse row diff is stored for Undo. | `src/server/postgres-repository.ts`, `workspace-rows.ts` |
| One revision per workspace. A command whose `expectedRevision` is stale is refused "Saved elsewhere". Editor saves also carry `expectedContent` (the page's content key) and resend once when only the revision moved. | `workspace.ts` `applyCommand`, `page-editor.tsx` ~731 |
| The browser holds the whole workspace; every load and every command response returns it (`forBrowser` drops only receipts and the Undo copy). The offline copy is that same workspace in IndexedDB. | `functions.ts`, `browser-workspace.ts`, `offline-copy.ts` |
| Offline: editor text is kept as drafts and saved again later; other commands (ticks, moves) fail with Retry, they are not queued. | `kept-drafts.tsx`, `draft-recovery.ts`, `use-day.tsx` |
| A block can already point at a page: `pageLink` (`pageId`, `content: 'none'`). | `page-editor.tsx` |
| Templates have targets, and a page id is a valid target: "new pages under this page start from this template". | `day-template.ts` `newPageTemplate` |
| Deleting a page trashes its whole subtree with one trash id, and restores it the same way. | `page-tree.ts` `subtreeIds`, `workspace.ts` |
| Brian's workspace (backup before #56, counts only): 28 pages (13 documents, 12 days, 2 drafts, 1 template), 17 tasks, 54 KB of documents. | backup `2026-11-01-before-56` |

## 3. The mapping, checked

### 3.1 A database is a page with a schema and views

- The database page keeps everything a page has: title, parent, position, Trash, `[[` links to it, and its own
  document. In Notion the full-page database's own page has no body above the table; ours could keep an optional
  document (a description). Jazz's call.
- New on that page, one JSON value, `database`:
  - `properties`: an ordered list of `{ id, name, type, options }`. The id is stable, so renaming a property never
    rewrites row values. `options` holds the select choices (`{ id, name, color }`), number format, date format,
    relation target, and so on.
  - `views`: an ordered list of `{ id, name, layout, visible, widths, sort, filter, group }`. Filters, sorts and groups
    are evaluated in the browser, which has every row already (see section 5).
  - The title is a property only in the sense that it is the row page's `title`. It is not stored twice.
- Size: a schema with 20 properties and 5 views is a few KB.

### 3.2 A row is a child page with property values

- A row is an ordinary page with `parentId` = the database page, plus `values`: a JSON object keyed by property id.
  Text, number, checkbox, date (`{ start, end?, time? }`), select (option id), multi-select (option ids), URL, and
  relation (row page ids) are plain values. Created and edited times are not kept today (the operation log is pruned
  after 30 days), so those property types would store a time on the row when it is made or changed.
- What this gives for free:
  - **Opening a row as a page**: it is a page. The editor, `[[` links, backlinks, the link preview and the day draft
    all work on it unchanged.
  - **Row order**: the row's `position` among its siblings, with `move-page` and `moveBefore`. A view sorted by a
    property ignores it; an unsorted view uses it, as in Notion.
  - **Row templates**: a template whose target is the database page id. `newPageTemplate` already prefers the parent's
    template.
  - **Deleting a database** trashes it with all its rows as one batch; Restore brings them back together.
- **What needs a marker:** rows must not appear in the sidebar tree, Subpages, the Pages screen or the Move dialog, and
  they need their own place in search and in `[[`. That is a check on the parent: "a child of a database page is a
  row". It doesn't need a new page type, because a row is a real page in every other respect. About 6 call sites read
  children today (`page-tree.ts`, `page-tree.tsx`, `search-dialog.tsx`, `trash.tsx`, `tree-drag.ts`, `export.ts`).
- **Moving a row out of its database** (dragging it to the sidebar) would turn it into a plain page with stray values.
  Either refuse it or drop the values. Design decides; refusing is simpler.

### 3.3 An inline database is a block in the host page

- A new block, `database`, with `pageId` and `viewId` and `content: 'none'`, like `pageLink`. The database page's
  `parentId` is the host page, so it moves and trashes with the host page.
- In Notion, inline and full page are the same object shown two ways ("Turn into page" / "Turn into inline"). Here
  that is also true: the database page is the same; inline means a block in its parent's document points at it. Turning
  it into a full page removes the block and leaves the page as a child. Turning it back adds the block.
- **The hard part is the editor, not the data.** A table inside BlockNote's contenteditable must keep keys, selection,
  IME composition, paste and drag for itself, and BlockNote must not treat it as text. We already did the same for the
  draft bands (`.draft-host` skips the editor's key rules), so there's precedent, but it needs care on iOS (focus,
  keyboard, scroll) and is where most of the risk sits.
- Deleting the block: like Notion, the database goes to Trash with its rows, and ⌘Z brings it back. The save that
  removes the block does it, the same way a save that removes a to-do row decides that to-do's fate today.
- A **linked view** (the same data shown in another page) is the same block pointing at a database whose `parentId` is
  elsewhere. Deleting a linked view's block must not trash the database. The block needs to know whether it is the
  database's home: `pageId`'s parent is this page, and this is the first such block.

### 3.4 Where it is stored

| Option | What changes | Verdict |
| --- | --- | --- |
| **A. Two nullable JSON columns on `pages`** (`database` on the database page, `values` on a row) | `Page` gains two optional fields; `PageRow`, `pageRow`/`pageOf`, the column lists, SQLite layout 9, a Postgres `alter table ... add column if not exists`. Everything else (diff, positions, Undo, replay, export of the row) carries them unchanged. | **Recommended.** Smallest change, one record per row, Undo and Trash already right. |
| B. New tables `databases` and `rows` | A third and fourth record type in `Workspace`, `Rows`, `RowDiff`, `planWrites`, `applyDiff`, Undo, export, the offline copy, and every page command that must also find rows. | Only worth it if rows stop being pages, which loses "open a row as a page". |
| C. Keep it in the host page's document (the table's data inside the block's props) | No storage change. | No: one row edit rewrites the whole host page, a row can't be a page, and two databases can't share data. |

The Postgres migration is new ground: `init` today only checks that tables exist. Adding columns needs a second
check (does `pages.values` exist) under the same setup lock. An old build (a tab before it moves, or a rollback) never
sees the new columns, and when it saves a row page it leaves them alone: `writeDiff` upserts only the columns it names.
One exception: an old build that deletes a row page and then undoes it puts the row back without its values, because
its inverse has no such column. That is acceptable for a rollback window, and worth knowing.

## 4. Edits, Undo, offline and two devices

- **A cell edit is a command**: `set-values { pageId, values: { [propertyId]: value | null }, expected }`. One command,
  one Undo, one revision. Property and view changes are commands on the database page (`set-database`). Adding a row
  is `create-document` with the parent and initial values; deleting is `delete-page`.
- **Undo** is the workspace's single slot, as for everything else, so ⌘Z after a cell edit undoes that edit. Typing in
  a text cell should send on blur or after a pause, not per key, or each key becomes its own Undo and its own request.
- **Two devices:** the workspace revision moves with any edit anywhere, so a cell edit from a tab that has seen an
  older revision is refused "Saved elsewhere" today. Two parts:
  1. `expected` carries the row's current values for the properties being changed. The domain refuses only if those
     values changed since; otherwise it applies the edit to the latest workspace. That is the cell's equivalent of
     `expectedContent`.
  2. The browser resends once on a revision-only refusal, as the editor already does. With (1) this is safe.
  With both, editing different cells, or different rows, on two devices never conflicts; editing the same cell on two
  devices shows the existing "changed elsewhere" state.
- **Offline:** today only editor text survives offline. A cell edit made offline would fail with Retry. Options: (a)
  accept that for a first version and say so in the cell; (b) keep cell edits as kept drafts per row, sent again in the
  background like `draft-recovery.ts` does for text. (b) is about a day and should wait for real use.
- **Row bodies** are page documents, so they get every existing protection: kept drafts, resend, flush before reload.

## 5. Size: does reading the whole workspace limit rows?

Yes. Every command reads every row of the workspace, clones it twice in the domain (`state` and the Undo `before`),
diffs it, and returns all of it to the browser. Load does the same once.

Measured with `node tests/evidence/database-fit/scale.ts` (synthetic data shaped like Brian's: 12 day pages, 13
documents, 17 to-dos, each row about 1 KB with a short body and six property values; Node 24 on the Mac mini, warm,
mean of 5):

| Rows | Sent to the browser per load and per command | Server CPU, save a day page | Server CPU, tick a to-do | Server CPU, row diff | Parsing every document once (cold start) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 33 KB | 0.3 ms | 0.1 ms | 0.1 ms | 0.0 ms |
| 100 | 117 KB | 0.5 ms | 0.3 ms | 0.3 ms | 0.1 ms |
| 500 | 455 KB | 1.1 ms | 1.1 ms | 0.9 ms | 0.5 ms |
| 1,000 | 878 KB | 2.0 ms | 1.8 ms | 1.8 ms | 1.0 ms |
| 2,000 | 1.7 MB | 4.3 ms | 3.7 ms | 3.4 ms | 2.1 ms |
| 5,000 | 4.3 MB | 11.5 ms | 10.3 ms | 8.9 ms | 5.4 ms |
| 10,000 | 8.5 MB | 22.2 ms | 19.3 ms | 17.9 ms | 10.1 ms |

Reading it:

- **CPU is not the limit.** Even 10,000 rows cost about 40 ms per command on the server. Today's real requests use
  46 to 122 ms of Worker CPU (request log, 2026-11-01 15:23Z).
- **Bytes are.** Every tick, every save and every cell edit would send the whole workspace back. At 1,000 rows that is
  close to 0.9 MB per tap on a phone, plus the same read from Supabase on every command and a full re-render and an
  IndexedDB write in the browser. Not measured: the Supabase read time and the phone's parse and render time at these
  sizes. Both grow with the same bytes.
- **Where to draw the line (estimate):** up to about 300 to 500 rows in total, nothing needs to change. Past about
  1,000, commands should return only what changed. The server already computes exactly that (`planWrites` gives the
  changed page and task rows), so sending that diff instead of the workspace, and applying it in the browser, is about
  a day, plus tests. It helps every screen, not only databases. Loading only the pages a screen needs is a much larger
  change and not needed for this.
- **Domain scans:** some views walk every live page's document (`taskRows`, `plannedIndex`). Rows add to that walk;
  measured above in the tick column, linear and small. Row pages with no to-do rows could be skipped later if needed.

## 6. To-dos: options and costs (not decided)

Today a to-do is its own record (`Task`: status, start, deadline, paused, done date, source page) and every row of it
on any page is read from documents. Carry-over, the day draft, ticks, the morning plan, reminders and export are all
built on that.

| Option | What it means | Cost (estimate) | Risk |
| --- | --- | --- | --- |
| **1. Tasks stay their own record; a database can show them.** A built-in "To-dos" data source: a view whose rows are tasks and whose properties are the task's fields (title, status, start, deadline, planned day). Edits go through the existing task commands. | No migration. To-dos get table/board/calendar views, sorting and filters. They don't get custom properties. | About 1 day on top of the table view. | Low. Nothing about carry-over changes. |
| **2. Tasks gain custom properties, still their own record.** As 1, plus a `values` JSON on `Task` with a schema kept on one "To-dos" database page. | Custom fields on to-dos (project, energy, context), shown in database views and editable there. | About 2 days on top of 1. One new column on `tasks`. | Low to medium. Two kinds of rows in one view (task rows and page rows) if he wants them mixed. |
| **3. Tasks become rows of a database.** A to-do is a row page in a system database; status, dates and plan are its properties; the `Task` record goes. | One model for everything; a to-do opens as a page with a body. | 1 to 2 weeks. Every task command, the day view, carry-over, the day draft, ticks, reminders, export and the B72 tick lifecycle are rewritten on rows. A data migration of his tasks and of the Undo inverses in `operations`, and a rollback plan. | High. Touches everything he uses daily. |

Engineering view, for the design: option 1 delivers most of what a database view of to-dos gives, at low risk, and
leaves 2 open. Option 3 only pays off if he wants to-dos with bodies, inside his own databases. That's a product
question for Bumblebee and Brian.

## 7. First version: what it would take (estimate)

Assuming design picks roughly: table view; properties text, number, checkbox, date, select, multi-select, URL; inline
and full page; a row opens as a full page; one sort and simple filters per view; rows reorder by drag.

| Part | Days |
| --- | ---: |
| Storage: two columns, Postgres and SQLite migration, `Page` fields, export | 0.5 |
| Domain: `create-database`, `set-database` (properties, views), `set-values` with per-cell check, row rules (not in tree, refuse move-out), deleting the home block trashes the database, tests | 1.5 |
| Inline block in the editor: render, keys/selection/IME isolation, iOS focus and scroll | 1 to 1.5 |
| Table view: cells and editors per type, add row, add/rename/reorder property, sort/filter UI, narrow phone layout | 1.5 |
| Lists: rows out of tree/Pages/Move; search and `[[` show rows with their database | 0.5 |
| **Total** | **about 5 to 6** |

Later, each separable: board view (about 1 day), calendar view (1 to 2; we have a calendar), list and gallery (about 1
together), relations and rollups (about 2), formulas (3 or more: an evaluator, types, errors), sending diffs instead of
the workspace (about 1, needed past about 1,000 rows), offline cell edits (about 1).

## 8. Open questions for the design

1. Does a database page keep a body above its table (Notion's full-page database has none)?
2. Can a row leave its database by drag, or is it refused?
3. Linked views of the same database in other pages: in the first version or later?
4. To-dos: option 1, 2 or 3 (section 6).
5. Offline cell edits: say "not saved" with Retry for now, or keep them as drafts from the start?
