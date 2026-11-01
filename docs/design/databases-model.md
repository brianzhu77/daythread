# Databases: data model

Owner: Roadbuster. Status: **draft for the Lead's review**, written alongside Jazz's `docs/design/databases.md`
(`design/databases`). It follows the Lead's frame (#daythread b842c6d3, bad76b80, 2026-11-01). Where it depends on a
design choice that isn't made yet, it says so. Research behind it: `docs/research/database-fit.md` (this branch),
Bumblebee's `docs/research/notion-database-model.md` (`bb/notion-db-research`), Jazz's
`docs/research/notion-database-interactions.md` (`research/database-interactions`).

This supersedes one point of the fit research: a database's home block is **stored on the database page**
(`homeBlockId`), not inferred as "the first such block".

## 0. As built in R1 (`feat/databases-domain`)

The domain and storage of R1 follow this model, with these differences, all from the design:

- `Option` has no `color` (design §6.1: no colour on options). `PropertyType` is the 8 R1 types; `relation`,
  `createdTime` and `editedTime` come later, and a type the build doesn't know reads as empty.
- `View` is `{ id, name, layout: 'table', columns, sort, filter }`. `groupBy`, `dateBy` and `source` come with R2.
- Filter operators are one list for every type (`filterOpList` in `src/domain/database.ts`); a rule the property's
  type doesn't offer, or one with no value, is ignored rather than hiding rows. Select and status use `isAnyOf` /
  `isNoneOf` with a list of option ids; date values are `{ date }` or `{ relative: 'today' | 'pageDate', offset }`,
  and `within` takes `thisWeek` (Monday to Sunday), `past7` or `next7`.
- `set-values` checks only the columns named in `expected`; the title is the column `title` in `values` and
  `expected`, so a title cell has the same per-cell check.
- `add-row` takes `copyOf` for Duplicate row: values copied, body copied with fresh ids, and its to-dos made new tasks
  of the copy, so ticking one never ticks the other.
- `delete-page` on a database reports its rows; `restore-page` on a row whose database is in the trash restores the
  database's batch with it ("Restored with Reading list").

## 1. Records

No new record type. A database and its rows are pages; two optional fields carry what's new.

```ts
// src/domain/types.ts (additions)
interface Page {
  // ...existing fields...
  /** A database page: its properties and its own views. Absent on every other page. */
  database?: Database
  /** A row (a page whose parent has `database`): its values, by property id. */
  values?: Record<string, unknown>
  /** Rows only: set when the row is made and when a value or its title changes (ISO time, from the command's `at`). */
  createdAt?: string
  editedAt?: string
}

interface Database {
  /** The `database` block that is this database's place in its parent page; null: shown as a full page. */
  homeBlockId: string | null
  /** In column order. The title is not here: it is the row page's `title`, shown as the first column. */
  properties: Property[]
  /** The views shown on the database itself (its home block and its full page), as tabs, in order. At least one. */
  views: View[]
}

type PropertyType =
  | 'text' | 'number' | 'select' | 'multiSelect' | 'status' | 'date' | 'checkbox' | 'url'
  | 'relation' | 'createdTime' | 'editedTime'

interface Property {
  id: string                 // stable; renaming never rewrites values
  name: string
  type: PropertyType
  /** select, multiSelect, status: the choices, in order. */
  options?: Option[]
  /** number */
  format?: 'plain' | 'comma' | 'percent' | 'currency'
  /** date: whether a time is shown and asked for */
  withTime?: boolean
  /** relation: the database its values point into (may be this one). One-way in the first version. */
  target?: string
}
interface Option { id: string; name: string; color: Color; /** status only */ group?: 'todo' | 'active' | 'done' }

interface View {
  id: string
  name: string
  layout: 'table' | 'board' | 'list' | 'calendar' | 'gallery'   // first version: 'table' (design decides)
  /** Columns shown, in order, with widths; a property not listed is hidden. 'title' is always first. */
  columns: { id: string; width?: number }[]
  sort: { by: string; direction: 'asc' | 'desc' }[]            // 'title' or a property id
  filter: Condition[]                                          // all must hold (first version: AND only)
  /** board: the select/status/checkbox property that makes the columns; table/list: optional grouping */
  groupBy?: string
  /** calendar: the date property */
  dateBy?: string
  /** To-dos option 1 only (section 7): the view's rows are tasks, not this database's rows. */
  source?: { kind: 'tasks' }
}
interface Condition { by: string; op: FilterOp; value?: unknown }
type Color = 'default' | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'  // Jazz's palette decides
```

Values, by property type (what `values[propertyId]` holds; absent means empty):

| Type | Stored value | Notes |
| --- | --- | --- |
| text | string | Plain text in the first version. Rich text (links, `@date`, `[[`) can come later as inline JSON. |
| number | number | finite only |
| select, status | option id | |
| multiSelect | option id[] | |
| date | `{ start: string, end?: string }` | `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` local wall time in the workspace's zone, like `@date` chips |
| checkbox | `true` | false is absent |
| url | string | |
| relation | page id[] | rows of `target` |
| createdTime, editedTime | nothing | read from the row's `createdAt` / `editedAt` |

**Values are read through their property, never trusted as stored.** `readValue(property, raw)` returns the typed value
or empty. That one rule removes every mass rewrite:

- Deleting a property removes it from `properties` only. Its values stay on the rows, unread. Undo puts the property
  back with its values intact. (Garbage collection, if ever needed, is a separate maintenance write.)
- Deleting an option leaves rows holding its id; they read as empty.
- Changing a property's type keeps the raw values. `readValue` converts where it's obvious (number ↔ text, select ↔
  status ↔ multi-select by option id, text → url) and reads anything else as empty, so changing it back restores them.
- A relation to a row that was deleted reads without it.

Why it matters: `writeDiff` writes one statement per changed row (`postgres-repository.ts`). Rewriting 500 rows to drop
one property would be 500 round trips to Supabase inside one command. With lazy reads, schema changes write one row.

## 2. Where things are

| Thing | Where it lives |
| --- | --- |
| A database | A page with `database`, `type: 'document'`. It has a title, a parent (or none), Trash, `[[` links and an optional body, like any document page. |
| Its rows | Its child pages, in page-list order (the order `move-page` already keeps). An unsorted view shows that order. |
| A row's body | The row page's `document`, edited by the ordinary page editor. |
| Its own views | `database.views`, shown as tabs on the home block and on the full page. |
| An inline placement | A `database` block in the parent page's document, whose id is `database.homeBlockId`. |
| A linked view | Any other `database` block pointing at it, in any page. Its view lives in the block. |
| A row template | A template targeted at the database page id (the existing `newPageTemplate(ws, parent)`). |

### 2.1 The `database` block

```ts
// BlockNote block, content 'none'
{ type: 'database', props: { pageId: string, view: string /* JSON View, linked views only */ } }
```

- **Home block:** `block.id === db.database.homeBlockId` and the block is in the database's parent page. It shows the
  database's own views as tabs. The open tab is a local preference per block on this device (like Notion), never a
  page save, so switching tabs doesn't write or take the Undo slot (Lead 7b3b9664).
- **Linked view:** every other block with that `pageId`. Its `view` is a JSON string (BlockNote props are scalars) with
  one `View`. Changing its filter or sort is an edit of the host page, saved with the host page, so it gets the host
  page's save, Undo and offline drafts for free and never changes the database's own views.
- A block pointing at a trashed database shows "In Trash · Restore"; at a page that's gone for good, "Deleted".

### 2.2 Rows are not subpages

`isRow(ws, page)`: the page's parent has `database`. Rows are left out of the sidebar tree, Subpages, the Pages
screen and Move's targets. In search and `[[` they appear labelled with their database ("Dune · in Reading list"). A
row can still have subpages of its own, as in Notion; those are ordinary pages.

## 3. Placement rules (the Lead's frame)

All of these run inside existing commands, on the page that changed, in one operation and one Undo.

1. **Making an inline database** (`/` Database): the editor inserts the block with a fresh block id and a fresh page
   id, then sends `create-database { pageId, parentId: host, homeBlockId: block.id }`, with the same retry and
   "kept, tap to retry" path `/` Page has (`confirmSubpage`). Until it lands, the block shows "Creating…".
2. **Making a full-page database** (Pages `+` and the sidebar `+` offer Page or Database, Jazz 85cf631a):
   `create-database { pageId, parentId, homeBlockId: null }` at that level. `/` Database always makes an inline one.
3. **Deleting the home block** in a save of the host page: the database and all its rows go to Trash as one batch
   (`trashId` = the save's operation id), so ⌘Z or Trash's Restore brings them back together. The save's receipt says
   so ("Reading list moved to trash · 12 rows").
   - **A move inside the page is never a delete:** our drop handler and ⌥⇧↑↓ re-insert the blocks themselves and
     the IME repair keeps the line's id (`page-editor.tsx` ~1520, ~1961, ~1711), so the home block id should survive
     them. Not tested yet; the tests in section 9 must show it. There is no second guard (Lead 1b31574e/ac1ed435): a
     changed id would be a bug to fix.
4. **Deleting any other `database` block** removes only that view.
5. **Pasting or duplicating a block** gives it a new block id, so it is a linked view (rule 4 applies to it).
6. **Turn into page** (block menu): the editor removes the home block and the save carries
   `detachDatabaseIds: [pageId]`. The database stays a child of the host page, now with `homeBlockId: null`, and is
   listed in Subpages. Nothing is trashed.
7. **Turn into inline / move it to another page** (drag a full-page database into a page, or the block's Move to):
   the editor inserts a block and the save carries `adoptDatabaseBlocks: [{ blockId, pageId }]`. Allowed only while
   the database has no live home block (if it has one, the block it sent becomes a linked view instead). The database's
   `parentId` becomes this page and `homeBlockId` this block.
   - **Cut and paste across pages** is 6 then 7: the cut sends `detachDatabaseIds` (as a cut of to-do rows sends
     `cutTaskIds`), the paste sends `adoptDatabaseBlocks`. If the paste never comes, the database is a full page under
     the old host. Nothing is lost.
8. **Moving the host page** moves the database with it (it's a child). **Trashing the host page** trashes it with its
   subtree, as today.
9. **Templates:** a template's blocks are copied with new ids, so a `database` block in a template becomes a linked
   view in each copy. That is the way a day page can show, say, "Reading list, due today" every morning (see 4.3).

## 4. Commands

New commands go through the existing queue, receipts, replay and single Undo slot. Zod schemas in
`command-schema.ts`, limits like the existing ones.

| Command | Does |
| --- | --- |
| `create-database { pageId, parentId?, homeBlockId, title, at }` | A database page with the default schema and one Table view (the defaults are the design's: e.g. Name + Tags, and whether it starts with empty rows). |
| `change-database { pageId, change }` | One schema or view change. `change` is one of `addProperty`, `updateProperty` (rename, options, format, type), `removeProperty`, `moveProperty`, `addView`, `updateView`, `removeView`, `moveView`. One write: the database page. |
| `add-row { databaseId, pageId, title, values?, beforeId?, at }` | A row page, from the database's row template when it has one; `values` checked against the schema. A view with a filter passes the filter's values so the new row stays in sight (Notion does this). |
| `set-values { pageId, values, expected, at }` | Sets or clears values on one row. `expected` holds the row's current values for those properties; if any changed since, it's refused "Changed elsewhere" (see 5.2). Sets `editedAt`. |
| `set-values-many { items: { pageId, values, expected }[], at }` | The same for several rows in one Undo (paste a column, fill down, a board drag that also reorders). Up to 200. |
| `delete-pages { pageIds, at }` | Several rows to Trash as one batch and one Undo (a multi-select delete). One row uses the existing `delete-page`. |
| existing `rename-page`, `move-page`, `delete-page`, `restore-*` | A title cell, reordering rows, deleting and restoring one row. `move-page` refuses moving a row out of its database, and moving a page into a database (design may relax this later). |
| `save-editor` gains `detachDatabaseIds?`, `adoptDatabaseBlocks?` | Rules 6 and 7 above. Rules 3 and 4 need no flag. |

Every command that changes a row's title or values sets `editedAt`; `add-row` sets `createdAt`. The time comes from
the command's `at`, as `delete-page` does today, so the domain stays pure.

## 5. Views, edits, sync

### 5.1 Reading a view: one pure function

```ts
// src/domain/database.ts
function viewRows(ws: Workspace, databaseId: string, view: View, context: { today: LocalDate; pageDate: LocalDate | null }):
  { rows: Page[]; groups?: { key: string | null; rows: Page[] }[] }
```

- Live child pages of the database, filtered (all conditions), then sorted (each key in turn; empty last; ties keep page
  order), then grouped. Group order is the option order; "No value" last.
- Filter operators per type: text `contains / is / isEmpty / isNotEmpty`; number `= ≠ < ≤ > ≥ isEmpty`; select and
  status `is / isNot / isEmpty`, status also `group is`; multiSelect and relation `contains / doesNotContain / isEmpty`;
  checkbox `is`; date `is / before / after / onOrBefore / onOrAfter / isEmpty` against a fixed date or a relative one:
  `today`, `pageDate` (the date of the day page the block is on), each with an offset in days.
- Runs in the browser on the rows it already has. No server query, no index. It's tested like the other domain views.

### 5.2 Edits from two devices

- A cell edit carries `expected`. The domain refuses only when those values changed. Editing other cells or other rows
  meanwhile doesn't refuse it.
- The workspace revision still moves on every write, so a tab behind on revisions is refused "Saved elsewhere" first.
  The tab then refreshes, and if the row's values still equal `expected`, it resends once, as the editor already does
  for text (`page-editor.tsx` ~731). So two devices only clash on the same cell, and then the cell shows the stored
  value with the design's "changed elsewhere" state.
- Text cells send on blur, Enter, or a short pause, not per key, so a sentence is one Undo and one request.

### 5.3 Offline

- Row bodies are pages: kept drafts and resend already cover them.
- Cell edits in the first version: if a save can't reach the server, the cell keeps the typed value with the existing
  failed state and Retry, and nothing is lost while the tab stays open. Keeping them across a reload (like
  `draft-recovery.ts`) is about a day and can follow once he uses it.

## 6. Storage

| Store | Change |
| --- | --- |
| Postgres `pages` | Four nullable text columns: `database_json`, `row_values` (`values` is an SQL keyword), `created_at`, `edited_at`. Added by `init` with `alter table ... add column if not exists` under the existing setup lock, after a catalog check, so a start where they exist does nothing. |
| `PageRow`, `pageRow`, `pageOf`, column lists | The four fields, JSON text for the first two, as `document` is. |
| SQLite (local dev) | Stores the workspace as one JSON value, so no layout change is needed for the fields. |
| Export | A database exports as a Markdown table of its rows (title and each property, read through `readValue`) plus one file per row with a body. |
| Offline copy | Unchanged: it holds the workspace, fields included. |

**Release and rollback.** The columns are added before any build writes them. A build without them leaves them alone
when it saves a page, because `writeDiff` names its columns. One edge: an old build that deletes a row and then undoes
it puts the row back without its values (its inverse has no such column). A rollback during the first days could lose
values on rows deleted and undone in that build. Acceptable, and the backup before release covers it.

## 7. To-dos (Brian's choice; the Lead recommends option 1)

- **Option 1 in this model:** a view can have `source: { kind: 'tasks' }` instead of a database. Its "rows" are tasks.
  Its columns are fixed fields (title, status, start, deadline, planned day, source page). Edits go through the existing
  task commands (`task-status`, start and deadline changes), so carry-over, ticks and the day draft are untouched. It
  can be a full page ("To-dos") or a linked view in any page, including a day page. About 1 day on top of the table
  view.
  **`+ New` in To-dos** is today's `add-task { pageId: today's day page, plannedOn: today }` (after `ensure-day`). It
  lands where a carried or planned to-do lands on a day page (`dayRowInsertIndex`): in the group of to-do rows under
  the outermost heading above the page's first to-do row (on his template, Morning Planning), after the rows already
  there. With no to-do row yet, under the first heading; with no heading, at the top. Never under "Other" by name.
- **Option 2** adds `values` to `Task` and a schema on one "To-dos" database page: custom fields on to-dos. One more
  column on `tasks`. About 2 days on top of option 1.
- **Option 3** (tasks become rows) is not in this model. It would replace `Task`, and needs its own plan.

## 8. Size and order of work (estimates)

| Step | Days | Notes |
| --- | ---: | --- |
| 0. Send only what changed (own PR from main, in parallel; Lead's point 4) | about 1 | Commands return the changed rows (`planWrites` already has them); the browser applies them. Every screen benefits. |
| 1. Storage + `Page` fields + export | 0.5 | |
| 2. Domain: commands, placement rules, `readValue`, `viewRows`, `isRow` lists, tests | 2 | Most of the behaviour lives here and is unit-tested without a browser. |
| 3. `database` block in the editor: render, key/IME/selection isolation, iOS focus and scroll | 1 to 1.5 | The main risk. |
| 4. Table view: cells, sheets per type (Jazz), add row, properties, sort/filter | 1.5 | |
| 5. Search, `[[`, Pages/tree exclusions | 0.5 | |
| **First version** | **about 5.5 to 6** | |
| Linked views | about 1 more | The model has them already. The cost is UI: the block's own view settings, "from Reading list" label, the trashed and deleted states, and a template's block becoming a linked view in each day. Shipping the first version without them is only the editor not offering "Linked view" and paste; data stays the same. |
| To-dos option 1 | about 1 more | |
| Board view | about 1 | `groupBy` + `set-values-many` already in the model |
| Calendar view | 1 to 2 | |
| Offline cell edits | about 1 | |
| Relations and rollups | about 2 | relation is in the model; rollups are a read-only computed column |
| Formulas | 3 or more | not in the model yet |

## 9. Tests (planned, none written yet)

- Domain, `node --test`: every command's happy path and refusal; `readValue` for each type and each type change, and
  back; placement rules 3 to 7 including cut-and-paste and a never-pasted cut; Undo of each command restores exactly
  (including a trashed database with rows); `viewRows` filters, sorts, groups, relative dates; `isRow` exclusions;
  revision-only refusal then resend for `set-values`; export.
- Storage: the column migration on a fresh schema and on one that already has them, on embedded Postgres in a
  throwaway `daythread_check*` schema; a page saved by a build without the columns keeps its values.
- Browser (Playwright, Chromium and WebKit at 1280 and 390): create from `/`, type in cells, IME in a cell, Undo, open
  a row, delete the home block and ⌘Z; **the home block keeps its id and nothing is trashed after a side-menu drag,
  ⌥⇧↑↓, and an IME composition repair next to it** (Lead 7b3b9664); switching tabs writes nothing; cut and paste to another page, two tabs editing different cells and the same
  cell, offline cell edit.
- Scale: `tests/evidence/database-fit/scale.ts` again with step 0, to show the per-command bytes no longer grow.

## 10. Settled by Jazz's design (`design/databases` de899807), and what it adds to the model

Answered (design head 85cf631a): default schema is Name only, no empty rows (§3.1); R1 is Table with Text, Number, Select, Multi-select,
Status, Date, Checkbox, URL (§14); linked views and To-dos in R2; a full-page database has no body (§4.3); a row can't
be dragged out (§12). Views show as a `Table ⌄` dropdown, not tabs; the open view stays a local preference.

What the design adds:

1. **No empty-page rule** (dropped, Lead ac1ed435): a full page is made from Pages' `+` → Database, or by Turn into
   page. So no `make-database` command and no refusal for pages with subpages.
2. **Turn into page / inline** (§3.2) swaps the home block for our `pageLink` card and back. In the model: the save
   that swaps them carries `detachDatabaseIds` (to the card) or `adoptDatabaseBlocks` (back to the table).
3. **Deleting an option** "clears it from every row" (§6.2): with lazy reads the rows keep the id and read as empty,
   which looks the same. The notice's count is the number of rows holding it. Undo restores the option, and the rows
   never changed.
4. **Status always has a value** (§6.1): `readValue` returns the first To-do option for an empty status.
5. **Restoring a row whose database is in Trash restores the database too** (§12). Today `restorePages` sends a page
   with a trashed parent to the top level. For a row it must instead restore the database page (which itself goes to
   the top level if its own parent is still in Trash). Tested.
6. **Duplicate row** (§12): `add-row` takes an optional `document` and `values`, so duplicating is one command.
7. **A new row in a filtered or grouped view** (§7.4): values that count as "one value" and are prefilled: select or
   status `is`, checkbox `is`, multi-select or relation `contains` (that one option or row), text `is`, number `=`,
   date `is` (fixed or relative), and the group's value. Anything else creates the row unfilled, with the "hidden by
   this view's filter · Show" notice.
8. **A database in a template** (§3.1): its parent is the template page, so its rows sit under a template. Fine for the
   model, because only the template's own document is copied, and the copy's block is a linked view.
9. **Later types, flagged:** **Files** (R3) needs file storage, which we don't have (no uploads anywhere today). That is
   new infrastructure (Cloudflare R2 or Supabase Storage, sizes, deletes), more than a property type. **ID** (R3) needs
   a counter on the database (`nextId`), so IDs never repeat after deletes.
