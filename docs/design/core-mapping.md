# Every screen concept on the general core

- Author: Jazz (Design), with Bumblebee's product points (folded in, one doc) · 2026-10-22 · status: **mapping for the
  core revision and Ratchet's bar (2)**. Base main 4c91fe3.
- Inputs: Brian `d0846999` ("generalize, like Notion; no data shaped for business logic"); Lead `8799bbe4` (the core:
  blocks, collections with a property schema as data, generic relations, infrastructure tables allowed); Bumblebee
  `5a13e4cd` points 1–7; Ratchet `28e06398` (stable property ids, type and cardinality, defaults, unknown values,
  schema version).
- Purpose: show that **every concept on today's screens and every parked spec maps onto the core**, mark what is stored
  and what is computed, and list the few places where the core needs a rule of its own. It does not design new screens;
  screens stay as they are.

## 0. The core, as this doc uses it

| Piece | Shape | Note |
| --- | --- | --- |
| **Block** | `id, parent_id, position, type, content (versioned inline jsonb), properties jsonb, created_by (him / model), created_at, version` | Pages are blocks (type `page`). Ids opaque. |
| **Collection** | a block (type `collection`) whose `properties.schema` lists properties by **stable id**: name (his, renamable), type, cardinality, default, `unique`, `system` | A page belongs to at most one collection (`properties.collection_id`). |
| **System property** | a property with a fixed id the app reads (`sys.status`, `sys.plan_date`, `sys.date`, `sys.url` …), name shown and renamable | Bumblebee 1, Ratchet. Same idea as heading roles: behaviour hangs on the id, never the name. |
| **Role** | `properties.role` on a block (`plan-top3`, `plan-other`, `collect-links`, `review`) | Set by the template; text stays his. |
| **Reference block** | type `ref`, `properties.target_id` | **One type** for task rows, synced blocks and pasted tasks (Bumblebee 4). How it renders depends on what it points at. |
| **Relation** | `from_id, to_id, kind, created_at` (`mention`, `line_link`, `copied_from`, `source`) | A derived index where the fact lives in content (mentions); a stored fact where it doesn't (`copied_from`). |
| **Trash** | `properties.trashed_at, trash_id` on a page block | Restorable with its children (A4). |
| **Tombstone** | the block row stays with `deleted_at` and its last `parent_id`; content dropped | A11's "Line removed · {last page}". Different from trash (Bumblebee 5). |
| **Infrastructure** | `operations` (receipts, undo, replay, history facts), `ai_runs`, `model_attempts`, auth / workspaces | Allowed to be specific (Lead). |

## 1. Today's screens

### Day page (`/day/:date`)

| Concept | Core | Stored / computed |
| --- | --- | --- |
| The day page | a page in the **Days** collection, `sys.date` (unique) | stored |
| One page per date | `unique: true` on `sys.date`, enforced by a partial index on the jsonb value | schema rule, not code that knows Days (Bumblebee 2) |
| Template headings (Top 3, Other, Events, Good stuffs, Notes) | heading blocks with a `role` where behaviour depends on it; Events and Notes need none | stored (his text) |
| Lines, bullets, checklist lines | blocks (`paragraph`, `bullet`, `check` with `properties.checked`) | stored |
| Task row | a `ref` block → the task page. Words = the task's title only (Jazz `7b02b1e6`); editing the row edits the title | stored (ref), title on the task |
| Top 3 vs Other | which role heading the ref sits under | computed |
| "Top 3 is full" | count of refs under `plan-top3` | computed |
| Plan vs reference look | `task.sys.plan_date == page.sys.date` | computed |
| History row ("moved to Oct 22", the old day's ref after a move) | the ref stays; its look comes from the task's current plan date and the `operations` fact of the move | ref stored, look computed (Bumblebee 3) |
| Not today / excluded | an `operations` fact plus the plan date change. Not a field on the ref | fact in `operations` |
| From earlier days (carry-over) | query: Tasks with `sys.status = open`, plan date before today, no ref on today | computed, written only when he acts |
| Event row | a `ref` → a page in **Events** (`sys.date`, `sys.time`, `sys.cancelled`) | stored |
| Good stuffs, links collected | heading role `collect-links`; each pasted link is a page in **Links** (`sys.url`, unique) shown as a card | stored |
| Page / link card with preview (B19) | a `ref` → the page; preview = its first lines | computed |
| Morning card, Draft my day, proposals, Hide for today | `ai_runs` + proposals; accepting writes refs with `created_by = him` and a `source` relation to the run | infra + stored refs |
| Capture (+) | a block with `created_by = him`, `properties.captured_at`; organizing writes ordinary blocks; the receipt is an `operations` row | stored (Bumblebee 6) |
| Review (evening) | his text = blocks under a heading with role `review`; "Review saved" = `properties.reviewed_at` on the day page; wizard step not stored | stored + UI state (Bumblebee 6) |
| Save, conflict, Load latest (B23) | block versions; the draft merge works per block against its start version | infra |
| Undo, receipts | `operations` | infra |

### Pages, Tasks, Tags, Calendar, Trash

| Concept | Core | Stored / computed |
| --- | --- | --- |
| Pages tree, nested pages, pages "in your days" | `parent_id` (a page under a day page has the day as parent) | stored |
| Manual sibling order (B14) | `position` | stored |
| Link page + URL dedup (A2) | Links collection, `sys.url` unique | stored + schema rule |
| `[[` page link chip | an inline mention in `content`; `relation(kind = mention)` as an index | content stored, index computed |
| Linked from (newest first, B15) | query relations by `to_id`, ordered by the `operations` time of the first save that held it | computed |
| Tasks screen (Today, Upcoming, Someday, Done) | a query over Tasks by `sys.status`, `sys.plan_date`, `sys.start_date`, `sys.due_date` | computed |
| Task statuses: open, done, cancelled, paused | `sys.status` (select). Paused is a status value, not a second flag | stored |
| Done on day X (A11 target) | `sys.done_at` | stored |
| Tags list, tag page | text in content, indexed | computed (Brian's rule) |
| Calendar dots (something written) | query Days pages by date with any non-empty child | computed |
| Future day preview + Create page | planned tasks by `sys.plan_date`; Create page copies the template | computed, then stored on create |
| Trash, restore, batch (A4) | `trashed_at, trash_id` on page blocks | stored |
| Day template | a page in **Templates** whose child blocks carry roles; applied once by copying with new ids | stored |

## 2. Parked specs and future items (bar 2: each is an addition)

| Item | Adds | Existing rows touched |
| --- | --- | --- |
| A11 line links | relation `line_link` + inline mention of a block; tombstone already in the core | none |
| B21 synced blocks | a `ref` → a synced container block (parent = the workspace's synced root, not a page). Each page's last copy is kept as `properties.snapshot` on its ref: **a cache, marked as one**, never edited, so content is still stored once | none |
| B22 task on several pages | a second `ref` to the same task | none |
| Multi-day plan | `sys.plan_date` cardinality many, or a `plan_dates` property | none, if cardinality is in the schema from the start (Ratchet) |
| B2 events as records | already a collection | none |
| A7 model-written pages, Copy to your pages | `created_by = model`; a copy = new tree + `copied_from` relation (Bumblebee 7) | none |
| Tags as AI hints, content graph | relations over mentions and tags | none |
| A6b-2 one-hop context | relations + parent query | none |
| B3 JSON export | blocks + schema + format version | none |
| B16 delete a day page | same trash as documents | none |
| Second template, renamed headings | another Templates page; roles carry behaviour | none |
| Multi-user | `workspace_id` + `created_by` already there | the lock (noted) |

## 3. Rules the core needs that a plain "everything is a block" doesn't give for free

1. **System properties by id** (Bumblebee 1, Ratchet): renaming Status or Date must never break the app. Unknown
   values (a select option the app doesn't know) render as plain text and are kept.
2. **Unique properties** (Bumblebee 2): one Day per date, one Link per URL. A schema flag plus an index. Cost: a partial
   expression index per unique system property; fine at his scale.
3. **History is not content** (Bumblebee 3): moved, excluded, done-on and "first saved at" are `operations` facts that
   screens query. No block holds them.
4. **One `ref` type** (Bumblebee 4). Rendering by target: a task → task row; a synced container → its lines,
   editable; a page → a card. Editing through a ref writes the target, so there's one source of truth for words.
5. **Trash ≠ tombstone** (Bumblebee 5).
6. **Caches are marked:** the only copied content in the core is a synced ref's `snapshot`. It's read-only and
   replaceable, so "stored once" still holds for anything he can edit.

## 4. Open questions for Roadbuster and Ratchet

- **Editing a task title through its row:** the editor edits a `ref` whose text lives on another block. Is the
  BlockNote custom block for that a small change from today's task row (which already writes `task.title`), or
  bigger? It decides whether the reference model costs days.
- **Query cost of jsonb system properties** for carry-over and the Tasks screen: an expression index on
  `sys.status` / `sys.plan_date`, or a generated column? The Lead asked for the cost to be stated.
- **Excluded:** with "Not today" as an `operations` fact plus a plan-date change, does anything still need the
  per-day excluded state? If carry-over is computed from the plan date alone, it can go.
