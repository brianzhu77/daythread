# Supabase storage and data model review

Status: **revised after Ratchet #101 (ae37af3), for re-check.** Brian's decisions are with Lead. No code changes until the re-check passes.
Source: Brian 6148a202 in #daythread:03640f0e: move the storage layer to Supabase, review the whole data structure, keep it
maintainable and extensible, and do not write specific business logic into the data.
Basis: main 173fa93, layout 6, the live database read-only at revision 169: **11 pages, 5 tasks, 10 placements, 169
receipts** in the current data (each table also holds the same again as the undo copy; Ratchet corrected my first count,
which added both), 0 events / materials / captures, about 25 KB of page content including the undo copy.
**Brian's goal (d3a9c476): A, use Daythread from anywhere without the Mac running.** So the server is hosted too (§0a).

## 0. Summary

1. **The storage boundary is clean; the data model is not.** UI and domain never touch SQL, and `WorkspaceRepository` is a
   two-method contract. A Postgres adapter for today's model is small (§5, path B). But the model stores the same content
   three times, puts editor bookkeeping, undo records, AI pipeline state and UI copy inside entities, and names product
   features (`top3`, `good-stuffs`) as data values (§2).
2. **Whole-workspace load does not survive the move as is.** Every command loads every table, runs `applyCommand` on the
   whole workspace and diffs it back, under one global revision. Locally that costs microseconds; over the network it is
   a round trip per table per command, and one global revision makes any two writes conflict (§3).
3. **Recommendation, for his goal "from anywhere": path A with the server hosted at cutover.** Clean up the model in
   shippable steps on the local store (each with the existing migration and rollback discipline), changing the
   repository to per-aggregate reads and writes on the way; then move the clean schema to Supabase and the server to a
   host in one cutover, with a tested way back. About **5 weeks (4.5–5.5)** after Ratchet's #101 contracts (§10). Path B
   (move and host now, clean up in the cloud) gets him there in **about 2.5 weeks** but makes every later model change a
   live cloud migration (§0a, §5).
4. **§7a sorts every change into "with the move" or "later, no data migration"**, with sizes. **Decisions** are in §7:
   path, hosting, privacy / plan / region, auth, server location, SQLite fallback, and the model choices with product effect.

## 0a. His goal: use it from anywhere (answered: A)

Brian d3a9c476 chose "use Daythread from anywhere without the Mac running". That puts three things in scope that were
optional before: **the server is hosted** (§7 row 5b), **sign-in is required** on every request (row 4), and **being
offline becomes a normal case** on his phone, not a rare one (row 5c).

| Option | Time to "from anywhere" | Cost |
| --- | --- | --- |
| **A + host at cutover (recommended)** | About 5 weeks (4.5–5.5): A0–A4 locally, then A5 (Postgres, sign-in gate) and A6 (cutover + hosting) | Features wait about 3 weeks; cloud only ever sees the clean schema |
| **B + host now** | About 2.5 weeks: Postgres adapter for today's tables (3 days), the sign-in gate (R4, 4–5), cutover fence and hosting (R5–R6, 4–5) | Every cleanup after that (blocks, operations, roles) is a migration of live cloud data with a cloud rollback; more total work |

What made B more viable than it first looked: with the server hosted **in the same region as the database**, a query
is about a millisecond away, so today's whole-workspace load (25 KB) is cheap there. The global revision stays, but he
is one user. B's real cost is not speed; it is doing the cleanup on live cloud data. **A stays the recommendation**,
because his request was the clean structure first and the cleanup steps are where the risk is.

**Optional bridge while A runs:** a private network such as Tailscale on the Mac mini and his phone gives phone access
to today's app (it only listens on 127.0.0.1 now) with no code change and no data in the cloud: about an hour, his
devices only. It still needs the Mac on, so it is a bridge, not his goal. His call.

**What pauses during A (about 5 weeks):** anything that changes stored data waits (A11 line links, synced blocks, B21/B22,
the A6b-2 follow-up). **Fixes and screen changes that don't touch stored data can still ship between steps** (Lead to
Brian 9b8bbdd9). The usage reads (Oct 22, Oct 25) are unaffected.

## 1. What is there today

| Layer | Today |
| --- | --- |
| Contract | `WorkspaceRepository.load(): Workspace`, `execute(Command): CommandResult` (`src/server/repository.ts`) |
| Domain | `applyCommand` in `src/domain/workspace.ts` (1944 lines): pure function over the whole `Workspace` |
| Storage | `node:sqlite`, 8 entity tables + `meta` + `model_attempts`, each row tagged `current` / `undo`, nested data as JSON text |
| Concurrency | one `Workspace.revision`; every command carries `expectedRevision`; replays deduplicated by `receipts[operationId]` |
| Undo | a second full copy of every table (`snapshot='undo'`): one step |
| Migrations | 6 layouts, each with a rollback script that holds back what the older build can't read |

The adapter-independent contract suite (`tests/repository-contract.ts`) and the import round-trip check are worth keeping
unchanged as the gate for any new adapter.

## 2. Findings: business logic and duplication in the data

Each finding: what is stored, why it is a problem, what to store instead.

### 2.1 Page content is stored three times, in an editor's format

- `pages.editorJSON` (BlockNote document string), `pages.sections` (our `Section[]` / `NoteBlock[]` derived from it),
  `pages.editorSections` (a copy of `sections` used to tell whether the two still agree), plus
  `editorBlockMetadata` (per-block sidecar, also holding A2 paste records under `paste:` keys).
- Problems: three sources of truth kept in step by code (`editorSeed` rebuilds one from the others); the stored format is
  BlockNote's, so an editor upgrade or swap is a data migration (layout 6 existed only because the old build couldn't
  open a new inline node); no line can be queried, linked or transcluded without parsing every page.
- Instead: **one `blocks` table** (§4) in our own editor-neutral shape: `type`, `content` (inline spans and inline nodes
  such as `{ type: 'pageRef', refId, pageId }`), `props`, parent and position. The browser converts to and from BlockNote.
  This is also what A11 line links and the synced blocks Brian asked about (7b89f7c9) need: a line is a row with an id.

### 2.2 Product features are values in the data

- `Section.kind`: `top3 | other | events | good-stuffs | notes | custom`. Behaviour hangs on it: the day template,
  Good Stuffs collecting links into materials, Top 3 placement. Renaming the heading keeps the behaviour; a new heading
  can never have it.
- `Placement.section: 'top3' | 'other'`: the planning taxonomy as a string.
- The day template itself is code (`dayTemplate`), with id conventions (`<section>:template:<i>`, `editor-task:`) and a
  `templateApplied` flag on the page.
- Ids must be opaque: block and task ids built from the template (`day:2026-10-18:top3:template:0`, `editor-task:day:…`)
  encode it, so changing the template would change identities (Bumblebee 929b6b74).
- Instead (Jazz 58c58e6e, Lead da982802): a heading is an ordinary block whose text is his. A heading the template made
  may carry an optional **`role`** prop (`plan-top3`, `plan-other`, `collect-links`). The role, not the text or the id,
  is what the screens branch on, so renaming keeps the behaviour.
- **One source of truth for Top 3:** where he put the task line. A line under the `plan-top3` heading of a day page is
  that day's Top 3. The slot is computed, never stored. Storing it would buy nothing: "Top 3 is full" reads one day's
  blocks (a handful of rows), and no screen asks for Top 3 across days. Top 3 is per day, never on the task, because a
  task can show on several pages (B22, Brian fb1fda77).
- Plan vs reference look: computed as "the task is planned for this page's day". `planRole` stops being stored.
- He deletes the Top 3 heading (Bumblebee): its tasks are Other for that day; the next "Move to Top 3" recreates the
  heading with its role. Nothing is lost or hidden.
- Today every placement has its day page (checked: 0 of 10 on a page-less day), and planning a task onto a day that has
  no page creates the page and the line, so the line is always there to be the truth.
- The template is user data (a `templates` row holding blocks with roles), applied once when a day page is created.

### 2.3 The day page is a god object

`Page` carries the evening review (`reviewText`, `reviewSaved`, `reviewStep`, `reviewSource`, `reviewSkipped`,
`handoffDone`), the AI draft (`draft` with `run`, `manifest`, `proposals`, `hidden`; `draftError`) and editor
bookkeeping (`editorCreations`, `editorDeletions` holding **full copies of tasks and placements** for undo). A document
page has all of these fields too, always empty.
Instead: `day_reviews` (one row per day), `ai_runs` + `ai_proposals` (§2.6), and undo in `operations` (§2.4). A page is
id, kind, title, parent, url, trash state and its blocks.

### 2.4 Undo, receipts and replay are stored as copies and UI text

- Undo is a second copy of every table: one step only, and each write rewrites both copies.
- Undo data also hides inside entities: `editorDeletions`, `LinkPasteRecord` ("never pruned"), `ProposalItem.before`,
  `appliedSnapshot`, `Material.materialBefore`.
- `receipts` stores a `message` (UI copy, English) per operation; 337 rows and growing.
- Instead: **one `operations` table**: `id` (the client's operationId), `type`, `fingerprint`, `created_at`,
  `result` (entity ids), `inverse` (a patch list that undoes it, written in the same transaction). Replay = look up the id.
  Undo = apply `inverse` if every row it touches is still at the version it left (the same "edited since" rule we already
  check by hand in five places). The UI builds messages from `type` + `result`. Multi-step undo becomes possible. Receipts have no time
  today, which Bumblebee's usage checks need; `operations.created_at` adds it.

### 2.5 Times and identities tied to the global revision

`NoteBlock.at` and `PageRefEntry.at` are revision numbers (B15 order), `sourceFingerprint` and `appliedVersion` exist to
detect edits. With per-row versions (§3) these become `created_at` / `updated_at` timestamps and row `version`s.
`PageRefEntry.title` (a title snapshot) and `pending` go: the title is a join, existence is a join.

### 2.6 AI pipeline state lives on pages and captures

`Capture` mixes the user's text with model status, grounding flags, proposals and undo snapshots; the day draft lives on
the page. `model_attempts` is already a proper ledger beside the workspace.
Instead: `captures` keeps what he wrote and when; `ai_runs` (kind, model, status, cost, request hash, manifest) and
`ai_proposals` (run, kind, payload, state, created entity) hold the rest; the budget ledger stays as is.

### 2.7 Overlapping facts

- Task timing (Bumblebee: "store what he did, compute the rules"): `plannedOn`, `lastPlannedOn`, `attentionOn`,
  `deadlineOn`, plus `placements` with `included | excluded | moved` and `section`. Proposal: **a task's identity is
  separate from where it shows** (B22, already decided by Brian fb1fda77). `tasks.planned_on` is the current plan; a task
  line is a block with `task_id`, and several lines on several pages may point at one task. `task_days` keeps only the
  per-day facts a line can't hold: he said "not today" for that day (`excluded`), and the history of days it was moved
  off (`moved`; in his data 5 of 10 placements, 2 of them with no line left). `lastPlannedOn`, carry-over and the slot
  are computed.
- **Carry-over and planned tasks without a line** (Lead 2d081f9b; Bumblebee b6c7ea12, Jazz 363fb869 agree). Recommendation
  **(a): computed, written only when he acts.** This is already how carry-over works today: `dayView` computes `carry`
  and opening a day writes nothing (`src/domain/workspace.ts` ~679). The only data change is that `lastPlannedOn` stops
  being stored: it is the latest day the task had a line or a `moved` record. (b) would store a product rule as page
  content and add rows he didn't write. One mechanism covers three cases:
  1. **Carried tasks** show in "From earlier days" right under Other (Jazz), each with its day; acting on one (Top 3,
     Other, Tomorrow, Not today) writes the line, with no notice.
  2. **Planned for a day that has a page, by an explicit action** ("Plan for today" from Tasks, the morning card): the
     action writes the line under the `plan-other` heading (recreated with its role if he deleted it), in the same
     transaction. It is something he did.
  3. **Planned for a future day with no page yet:** only `tasks.planned_on` is stored (his decision). The preview shows
     the task computed; nothing is written when the page is first opened. Choosing Top 3 for that day is an action on the
     page, so it creates the page with the line, as future-day actions already create the page today.
  Usage check to add (Bumblebee): how many carried tasks he acts on vs. leaves.
- Saved links (later, §7a): A2 made a link a page with `url`; `materials` is a second "saved link" entity with its own title, url and
  sources. Proposal: a material becomes a page with `url` plus a `follow_ups` row (review state, next date, history in
  `activity`). Today there are **0 materials** in his data, so this costs nothing to migrate now and more later.
- `Material.openedOn[]`, `dismissedOn[]`, `decisions[]` grow without bound inside one row; they are an activity log.

### 2.8 Hard-coded workspace facts

`Workspace.timezone: 'America/Vancouver'` and `schemaVersion: 1` are literal types; the adapter rejects any other value.
Move to `workspaces.timezone` / `settings`; the database layout version is the migration table's job.

### 2.9 Derived indexes are recomputed by scanning

Linked from, tags (by design derived, `src/domain/tags.ts`), "lines from this day" and Good Stuffs all scan every page's
blocks. Fine at 22 pages; a per-command full scan over the network is not. Keep tags derived from text (Brian's rule),
but maintain **index tables** (`links`, `block_tags`) in the same transaction as the block write, so they can't drift and
can be rebuilt from blocks at any time. These are also the edges of the content graph Brian raised (e36141c5).

## 3. Runtime shape with Supabase

- **Per-aggregate reads and writes.** A command loads only what it touches (a page and its blocks; a task and its days),
  checks each row's `version`, writes, and appends one `operations` row, in one Postgres transaction. The screen loads the
  day it shows plus small indexes, not the workspace.
- **Conflicts are per row.** Today's B23 / save-on-leave semantics already work per page (`expectedContent`); they map to
  `pages.version` / block versions. Two tabs editing different pages stop conflicting.
- **Where the transaction runs.** Writes stay in our server (`execute(Command)`), using a direct Postgres connection
  (Supabase's pooled connection string) with real transactions. Not supabase-js from the browser: PostgREST can't wrap a
  multi-table command in one transaction except via SQL functions, and the domain's invariants live in TypeScript.
  The browser keys already in `.env.example` (`VITE_SUPABASE_*`) are needed only for Supabase Auth.
- **Ownership.** Every table gets `workspace_id`; `workspaces.owner_id` references `auth.users`. Row Level Security on
  every table (owner only) even though the server connects with its own role, so a leaked anon key reads nothing.
- **Realtime (later, optional).** Postgres changes on `pages` / `blocks` could replace the 5-second refresh on focus. Not
  in scope; the schema allows it.

## 3a. Hosting (his goal A)

**Recommendation: a long-running Node server on Fly.io, in the region next to the Supabase database; not Vercel.**

- **Why not serverless (Vercel):** the model runs are fire-and-forget after the response
  (`src/server/model/service.ts` 68, 80, 114: `void organizeCapture(…)`, `void draftDayRun(…)`). A serverless function
  may be frozen once it has answered, which would cut them off; fixing that means a queue or `waitUntil` everywhere.
  Cold starts also eat the 300 ms day-open budget, and serverless needs Supabase's transaction-mode pooler, which doesn't
  support session features.
- **Postgres from the host:** a small pool (about 5 connections) on Supabase's **session-mode pooler (port 5432)** or a
  direct connection, both meant for long-lived servers; not the transaction-mode pooler (6543), which is meant for
  serverless. Commands run as one transaction each (`BEGIN … COMMIT`, row versions checked with `SELECT … FOR UPDATE`).
- **Region:** the database in Supabase's US West region and the server in the nearest Fly region (San Jose), so a query
  is about a millisecond away, and Vancouver is a short hop from both.
- **Secrets:** the database URL, the model key and the Supabase keys live only in **Fly secrets** (encrypted, injected
  as environment variables). Locally they stay in `.env.local` (ignored by git). `loadModelEnv` will read the environment first and the file
  only in development. Nothing in the repo or the image.
- **Cost on top of Supabase Pro ($25):** a shared-CPU machine runs about **$3–7/month** (Fly's table: 512 MB about $3.19,
  1 GB about $6–7 in US regions). Recommend 1 GB for Node + model calls: total about **$32/month**.
- **Deploy and rollback:** the rehearse → deploy discipline stays. A **preview app** (`daythread-preview`) pointed at a
  second, disposable Supabase project with a copy of his data gets every candidate first; Lead rehearses there; then the
  same image deploys to the live app. Rollback = redeploy the previous release's image (kept by Fly), one command,
  about a minute. Database changes keep their own rollback scripts, as today.
- **Exposure (Ratchet's #101 scope):** his journal is on a public URL, so: no unauthenticated path at all (every server
  function checks the session before anything else); RLS owner-only on every table as a second wall; sign-in rate
  limits (Supabase's built-in auth limits, plus a per-IP limit on our endpoints); the model endpoints are server-only
  actions behind the same session check and the existing budget ledger, so nobody else can spend his money.

## 3b. Offline first version (A7, after cutover)

**Decided (Lead, from Bumblebee's and Jazz's joint recommendation):** read offline, keep typing into the existing draft,
**captures queued**, everything else greyed with "Needs a connection" (ticking tasks included, until usage shows a need),
and one status he can trust.
- **Reading:** a **service worker** caches the app shell; an **IndexedDB cache** holds today, the next 7 days' plan, the
  last 7 day pages and recently opened pages, refreshed on each online load. A page outside it reads "Not on this phone
  yet · opens when you're back online".
- **Typing on a cached page:** the existing draft (B23 / save-on-leave); on reconnect it saves, or goes to Load latest if
  the page changed elsewhere. No new conflict rules.
- **Capture queue** (a capture only adds a line, so it needs no conflict rules):
  - each queued capture gets its `operationId` and `capturedAt` (the phone's clock) **when it is typed**, and is stored in
    IndexedDB; a resend after a flaky reconnect is deduplicated by the existing replay;
  - it lands on **the day it was made**, not the day it is sent (captured 23:50, sent 07:00 → yesterday's page); if that
    isn't today, the receipt names the day (Bumblebee);
  - the model step (Auto) runs only once the capture has reached the server, never offline (Lead);
  - sent in typing order, one at a time, stopping at the first refusal so nothing is reordered.
- **One status** in the page's status spot (Jazz): "Offline · copy from 10:42" while reading, "Offline · 2 changes
  waiting" once he has typed or captured, "Saved" once sent.
- **Size: about 4–5 days** (reading 3–4, the capture queue about 1 more), plus Jazz's states. **It ships after cutover:**
  offline only matters once the app is hosted and on his phone away from home, and it changes no stored data.
- **Success check** (Bumblebee): offline sessions, offline captures sent, and "Needs a connection" hits. He has 0
  captures in his real data, so which way to grow is learned, not assumed.
- **The bridge is A7's evidence** (Bumblebee 24f1324a): while it runs (about 5 weeks), count what he does on the phone
  (pages opened, typing, captures, task ticks) and when it fails because the Mac or home connection is down. Before A7
  starts, check the design against it; if he mostly ticks tasks on the phone, the ticking queue moves into A7.
  Receipts have no time and no device today (Bumblebee), so the counts need a small addition, **with no database
  change**: the server appends one content-free line per command to `.daythread-local/usage.jsonl` (time, command
  type, `phone` / `desktop` from the user agent, outcome), beside the existing content-free debug log fields
  (`src/server/debug-log.ts`). Failures can't reach the server, so the phone counts "couldn't reach" locally (times
  only, no text) and sends the count with its next successful request. About 2 hours plus a narrow Ratchet check.
  From A2 on, `operations` carries `created_at` and `device` itself.
- **Goal A success check after cutover:** in the first 7 days he opens Daythread on his phone away from home at least 3
  times, and no text is lost.
- **iPhone storage (checked, partly):** WebKit's 2020 policy deletes a site's script-written storage after 7 days of
  Safari use without visiting it, with home-screen web apps on their own counter. WebKit's 2023 storage-policy post
  still lists this kind of eviction ("not interacted with by the user for some time", no number given), and says
  `navigator.storage.persist()` is granted by heuristics such as being a home-screen web app, and that persistent
  origins are excluded from eviction. A 2022 WebKit bug reports a home-screen app's cookies cleared after 7 days, which
  I couldn't confirm as fixed. So: **"Add to Home Screen" goes in the release message**, the app calls
  `navigator.storage.persist()`, and the release message says unsent offline text is safest once it has synced. The
  risk is only to drafts that never reached the server.

## 4. Proposed schema (Postgres, snake_case)

Ids stay text (existing ids are kept on import, no remapping). All tables: `workspace_id`, `created_at`, `updated_at`,
`version int`. Positions are sparse integer ranks (§9). Every reference is a composite `(workspace_id, id)` foreign key,
so nothing can point into another workspace.

| Table | Columns (besides the common ones) | Replaces |
| --- | --- | --- |
| `workspaces` | `owner_id`, `timezone`, `settings jsonb` | `meta`, literal timezone |
| `pages` | `kind` (`day` / `document`), `day_date` (unique per workspace), `title`, `parent_id`, `url`, `url_key` (computed from `url`, unique index), `trashed_at`, `trash_batch_id` | `pages` minus content, review, draft, editor fields |
| `blocks` | `page_id`, `parent_id`, `position`, `type`, `content jsonb`, `props jsonb`, `task_id` (task line), `source_block_id` (copy/bring) | `editorJSON`, `sections`, `editorSections`, `editorBlockMetadata` |
| `templates` | `name`, `blocks jsonb` | `dayTemplate`, `templateApplied` |
| `tasks` | `title`, `status`, `planned_on`, `last_planned_on`, `start_on`, `due_on`, `paused`, `created_on date`, `source_page_id` | `tasks` (R3: `last_planned_on` is a planning fact, kept; `source_page_id` is a page, kept as a page) |
| `task_days` | `task_id`, `day`, `state` (`excluded` / `moved`) | `placements` (order and section come from the line) |
| `events` | `title`, `day`, `time`, `cancelled` | `events` |
| `materials` | as today, plus `workspace_id` | `materials` (carried as is; merging into link pages is later, §7a) |
| `day_reviews` | `day`, `text`, `step`, `source`, `skipped`, `finished_at`, `handoff_done_at` | page review fields |
| `captures` | as today, plus `workspace_id` | `captures` (carried as is; splitting model fields out is later, §7a) |
| `ai_runs` | the page draft's run, manifest, proposals, hidden, error | page `draft`, `draftError` |
| `model_attempts` | unchanged | unchanged |
| `operations` | `id`, `type` (null for legacy), `fingerprint`, `device`, `entity_id`, `simulated`, `result jsonb`, `undo_kind`, `inverse jsonb`, `legacy_text`, `created_at` (null = unknown), `imported_at` | `receipts`, undo snapshot, in-entity undo records (§10 R2) |
| `block_provenance` | `page_id`, `block_id`, `source_page_id`, `source_block_id`, `kind` (`bring` / `copy` / `ai`), `fingerprint`, `created_at` (null = unknown), `removed_at` | Bring/AI suppression facts in sections and `editorBlockMetadata`, kept after the block is deleted (§10 R2) |
| `storage_state` | `epoch`, `authority`, `frozen_at` | cutover fence (§10 R5) |
| `links` | `source_block_id`, `ref_id`, `target_page_id`, `target_block_id`, `kind`, `ref_at` | index rebuilt from the `refs` entries kept in block props (§10 R3) |
| `block_tags` | `block_id`, `tag_key`, `tag` | tags scan |

`jsonb` is used only where the content is a document (block content, settings, operation patches, AI manifests), never to
hide relational facts. Check constraints cover closed sets that are facts (`tasks.status`), not product taxonomies.

**Constraints and delete rules:** one day page per `(workspace_id, day_date)`; `url_key` unique per workspace including
trashed pages (a trashed link page still owns its URL, as today); parents and sources in the same workspace (composite
FKs); no parent cycles (checked in the command under the workspace lock, plus a trigger as a second wall); `blocks.task_id`
→ `tasks` with `ON DELETE RESTRICT`; `operations` primary key `(workspace_id, id)`. **Nothing cascades into history:**
`block_provenance`, `operations` and `model_attempts` have no FK to the rows they describe, so deleting a block, page or
task never deletes an audit, replay or Undo fact.

## 5. Paths

### A. Clean up locally in steps, then move (recommended)

| Step | What ships | Rough size |
| --- | --- | --- |
| Bridge | (Optional, his call) Tailscale on the Mac mini and his phone: today's app reachable from anywhere, Mac on (§0a) | hours |
| A0 | Spike, thrown away after: a hello-world on the chosen host + a Supabase project in the same region; measure day-open and save p95 from his Mac and phone against the §8 budget, so a miss shows up in week 1, not week 3 | half a day |
| A1 | Repository contract becomes per-aggregate reads + one workspace lock per command (§10 R1), still on SQLite; contract suite v2 (the different-days test flips); workspace-wide checks read indexes under the lock, never a partial slice | **4–5 days** (was 3–4) |
| A2 | `operations` table with typed undo families; 169 legacy receipts imported as legacy replay records; `block_provenance` for Bring/AI suppression; undo snapshot transitioned explicitly (§10 R2) | **4–5 days** (was 3) |
| A3 | `blocks` table as the only content source (the import also builds blocks for day pages that have sections but no `editorJSON`, e.g. Oct 20 and 21; Ratchet); `content` keeps BlockNote's inline shape, versioned (`content_format`), validated, lossless round trip (Ratchet's conditions, §9.2 decided); browser maps rows ↔ editor blocks; `links` / `block_tags` indexes | **3 days** (was 4–5) |
| A4 | Split page: `day_reviews`, `ai_runs`; heading roles and the computed slot instead of `top3`; `task_days`; templates as data (materials stay as they are, §7a) | 3–4 days |
| A5 | Postgres adapter (local Supabase in Docker, contract suite v2); sign-in by emailed code; the auth gate with real RLS on the server's own path and the negative-test list (§10 R4) | **4–5 days** (was 3) |
| A6 | Cutover + hosting: storage epoch fence, drain, import with defined equivalence, localhost-draft handoff, rollback with cloud edits, durable model jobs on Fly (§3a, §10 R5–R6) | **4–5 days** (was 3–4) |
| A7 | Offline first version (§3b), after cutover: reading, typing into the draft, the capture queue, one status; caches and queue scoped to his account (§10 R6) | **5–6 days** (was 4–5) |

About **5 weeks (22–27 working days)** to "from anywhere" on the clean schema (A0–A6), then about 5–6 days for the
offline first version (A7). **Step order is
otherwise unchanged:** the bridge covers reachability now, so pulling sign-in and hosting earlier would only mean
hosting today's model (path B's cost) for no gain. **Bridge: engineering recommends yes**, since it gives him the value he
asked for this week at a cost of hours, touches no data, and is removed at cutover.

About **5 weeks** of build time, each step reviewed by Ratchet and live on 3000 before the next. Benefit: every model
change happens on a local file with our proven migration + rollback scripts and his real data copy; the cloud only ever
sees the clean schema. Cost: he's not on Supabase until A6. Product work can continue between steps, but each step touches
`workspace.ts`, so new features would wait or rebase on it.

### B. Move now, clean up in the cloud

Postgres adapter for today's tables (same columns + `workspace_id`, JSON text → `jsonb`), cutover, then A1–A4 as Postgres
migrations. On Supabase in **about 2.5 weeks** with hosting (R4–R6 apply to B too). Cost: the global revision and whole-workspace load go over the network (every
command reads all tables), and each later cleanup is a migration of live cloud data with a cloud rollback. Total time is
higher than A.

### C. Rebuild in one go

Write the clean schema and a new domain layer directly on Postgres, import once. Fewest intermediate states, but one very
large change with no shippable checkpoints and the longest time without real use. Not recommended.

## 6. Cutover and rollback (applies to A6 or B)

1. Freeze writes (a server flag that refuses commands), with the line "Moving your data · editing is paused for a few
   minutes" (Jazz), keeping whatever he is typing as a draft. Take a SQLite backup (`VACUUM INTO`).
2. Import into Supabase in one transaction; read back and deep-compare with the source; abort on any mismatch.
3. Switch `DAYTHREAD_STORAGE=supabase`; the SQLite file stays untouched as the fallback.
4. Rollback window (proposed 14 days): `export-to-sqlite` rebuilds a layout-N SQLite file from Supabase, round-trip
   tested before cutover, so going back keeps edits made in the cloud.
5. Credentials: the database URL and service role key live only in `.env.local` on the server machine; nothing in git
   (`.env.*` is already ignored).

## 7. Decisions (Lead to summarize)

**For Brian:** the path (row 1, A vs B for his goal, §0a), cloud privacy with the monthly fees (rows 2, 3, 5b), and
the Tailscale bridge now (§0a), and the offline behaviour told to him as decided (row 5c).
**The team's call:** where to host (row 5b), auth details (row 4), the SQLite fallback (row 6), the model choices (row 7).

| # | Decision | Recommendation | Cost | Reversible? |
| --- | --- | --- | --- | --- |
| 1 | Path A (clean up locally, then move) or B (move now, clean up in the cloud) (§5) | **A** | A: about 5 weeks before he is on Supabase; B: about 2.5 weeks, but each later cleanup is a live cloud migration | Either can switch before cutover; after B's cutover, going back means the export script |
| 2 | Hosted Supabase or local Supabase (Docker on his Mac) | **Hosted** for real use; local Supabase only for development and tests | Hosted: a plan fee, his journal in the cloud. Local: no gain over today's SQLite file | Yes: the same schema runs in both; moving is a dump and restore |
| 3 | Privacy, region, plan | His own Supabase account, **US West** region, **Pro plan** | **Pro: $25/month** (includes $10 of compute, one Micro instance), **daily backups kept 7 days** (Lead checked the pricing). The free plan pauses after 1 week inactive and has no backups, so it is not an option for his only copy. The repo's rule so far was "private data, never a cloud fallback" (`.gitignore`), so this is his explicit call | Yes while the SQLite copy is kept; data already sent to the cloud stays there until he deletes the project |
| 4 | Auth and row-level security | **Supabase Auth, his account only, sign-in with an emailed 6-digit code** (not a magic link: on iPhone an email link opens in Safari, which has a session separate from the home-screen app, so he'd be signed in to the wrong place; a code typed into the app avoids that; Jazz 6e1c0707, Bumblebee 24f1324a). **RLS on every table, owner only.** The server keeps all writes and connects with its own role. An expired session mid-edit behaves like a failed save: draft kept, "Signed out · Sign in to save" | About a day in A5; sign-in once per browser | Yes: RLS policies are migrations |
| 5 | Where the server runs | **Hosted** (his goal A), see 5b. Until cutover it stays on his Mac | See 5b | Yes |
| 5b | **Server hosted** (in scope: his goal A) | **Fly.io, long-running Node, next to the database** (§3a); not Vercel | About **$6–7/month** (1 GB) on top of Supabase Pro: about **$32/month** total. Build in A6 | Yes: the same build runs on his Mac again, pointed at the same database |
| 5c | **Offline** (now a normal case on his phone) | **Decided (§3b):** read offline, keep typing into the draft, **captures queued**, one status ("Offline · copy from 10:42" / "Offline · 2 changes waiting" / "Saved"); other actions greyed with "Needs a connection"; a ticking queue only if usage shows the need. Ships as A7 after cutover | A7: about **4–5 days** | Yes: none of it changes stored data |
| 6 | SQLite after cutover | **Read-only fallback for a 14-day rollback window**, with a tested export from Supabase back to SQLite; then archived, not deleted | The export script (part of A6) | That is the point of it; after the window, rollback means restoring from Supabase backups |
| 7 | Model choices with product effect: (a) Top 3 is where the line sits (under the heading with the Top 3 role), computed per day; (b) special headings bound by a role prop, so renaming keeps behaviour; (c) saved links (materials, 0 rows) merged into link pages | **(a) and (b) with the move; (c) later** (§7a) | (a)+(b) are part of A4; screens look the same | (a)+(b): cheap before cutover; (c) is free while there are 0 materials |

## 7a. With the move, or later without a data migration

Rule: anything that changes the **shape of stored data** goes with the move, so the cloud starts on the clean shape and
we never migrate live cloud data for it. Anything that is **computed, an index, or a feature's behaviour** can change
later. Bumblebee's seven items first, then the rest of §2.

| Item | When | Why | Size |
| --- | --- | --- | --- |
| 1. Day template: section kinds, English titles, template-built ids | **With the move** | Kinds become heading `role`s; titles are already heading text. Existing ids are kept as opaque strings (no rewrite); only new ids stop encoding the template | 2 days (in A3/A4) |
| 2. Task and days (B22-ready) | **With the move** | Changes what a placement row is; the slot and order become computed | 2 days (A4) |
| 3. Review wizard fields on the page | **Shape with the move, behaviour later** | Move the six fields as they are into `day_reviews` (mechanical). Reducing them to "text + done at" changes the review flow: a product change, **recommend later** | 1 day now |
| 4. `receipts.message` and no time | **With the move** | Part of `operations`; the UI renders the wording | 1 day (in A2) |
| 5. Materials (0 rows) | **Later** | A feature-level change to Good Stuffs. Carry the table as is (empty); merging into link pages stays free while it has 0 rows | 0 now |
| 6. Captures, AI draft, budget states | **Split with the move, flow later** | Move `pages.draft` / `draftError` out of the page into `ai_runs` (1 day); captures and `model_attempts` are already their own tables and go as they are | 1 day |
| 7. Undo as a second copy of every table | **With the move** | The copy can't sensibly go to Postgres. Replace with `operations.inverse` **keeping today's behaviour exactly** (one step, same "edited since" rules). Multi-step undo is a product change: **recommend later** | 3 days (A2) |
| Content stored three times, BlockNote format (§2.1) | **With the move** | It is the stored format itself | 4–5 days (A3) |
| Global revision, whole-workspace load (§3) | **With the move** | Per-page versions under one workspace lock (§10 R1) | 4–5 days (A1) |
| Revision-number times, title snapshots (§2.5) | **With the move** | Columns change | in A3 |
| Timezone literal (§2.8) | **With the move** | One column; trivial | in A1 |
| `links` and `block_tags` indexes (§2.9) | **Later** | Computed from blocks, rebuildable at any time | 1 day when needed |
| Realtime refresh, multi-step undo, review simplification | **Later** | Behaviour only | — |

Total "with the move" matches path A's steps (§5): about 5 weeks.

## 8. Verification plan

- Session expiry mid-edit and no internet behave like a failed save (draft kept, the right line), added to the
  save-on-leave checks in A5 (Jazz).
- Contract suite + import round-trip on every adapter and every step; real-data copy round-trip (old layout → new → old).
- Per step: unit tests, existing browser checks (`two-tabs`, B23, save-on-leave, A12, A9a, alignment gate), Ratchet review.
- Postgres: the contract suite against local Supabase; concurrency tests with two connections (row-version conflicts,
  replay); RLS test with the anon key reading nothing.
- **Cutover success check** (Bumblebee): the import round trip matches exactly, the screens are unchanged, and from his
  Mac against the chosen region, over 50 runs each, **opening a day page is under 300 ms and a save is under 200 ms at
  p95**, measured end to end from his browser to the hosted server (A5 measures it against a test host first). A5 fails, and the cutover waits, if either is missed. Today's local figures are
  measured the same way first, as the baseline.

## 9. Open questions for review

- **Positions, decided:** sparse integer ranks (gaps of 1024) with a deterministic tie-break on id and a rebalance of
  one parent's children when a gap closes. A move usually writes one row; a rebalance writes that parent's children, in
  the same transaction.
- **`blocks.content`: BlockNote's inline shape or ours** (Lead, Ratchet to weigh in). Both keep `blocks` as rows we own
  (one source, positions, `task_id`, links); only the inline array inside one line differs.
  - **Keep BlockNote's inline shape in jsonb: A3 is about 3 days.** No converter: the browser maps rows to editor
    blocks by moving fields, and the inline array passes through unchanged.
  - **Our own inline format: about 4.5–5 days.** It adds a two-way converter for text styles, links and `pageRef`
    (about 1 day), plus a round-trip check over his real pages and every mark (about half a day to a day), and every
    later inline feature has to extend the converter.
  - **The difference is about 1.5–2 days.** It doesn't store product rules: an inline array is text with marks. The cost
    is that a BlockNote change to its inline schema becomes a migration of `content` alone. Mitigations: a
    `content_format` column (e.g. `bn-1`), so such a change can be converted per row and lazily; and all readers of
    inline content (tags, line text, AI context) go through one module, as `inlineText` / `lineText` largely do today.
  - **Ratchet agrees (b842c6d3):** keep it, versioned, with validation and a lossless round trip (styles,
    `pageRef`/`refId`, unknown nodes never silently dropped).
  - **Engineering recommendation: keep BlockNote's inline shape, with `content_format`.** It saves less than the
    2-day bar Lead set, so it is close; the deciding point is that it removes the riskiest new code from the biggest
    step. **Decided** (Lead, per Ratchet): A3 is about 3 days.
- **Inverse size, decided:** every command's request is bounded before it mutates anything (the existing request limit).
  An inverse is stored whole or not at all: if it would exceed 5 MB, the command commits **without Undo** and its
  receipt says so, so Undo is never offered over a truncated inverse. Replay records are kept forever (small); an
  inverse is pruned once a later undoable operation supersedes it or after 30 days, and pruning never re-enables a
  model operation (its replay record and fingerprint stay).

## 10. Contracts from Ratchet's #101 review (ae37af3)

Each group says what is decided and which step carries it. Sizes are already in §5.

### R1. Transactions: one workspace lock per command (A1)

**Decided (Lead 24246c87, Ratchet 5a6618b9): every write command takes one lock on his workspace.** He is the only
user, so writes run one at a time as they do today, but conflicts are checked on the row that changed (a page's version,
a task's version), not on one global revision. **Multi-user would need this revisited:** the lock is per workspace, so
separate users never wait on each other, but several people in one workspace would.

Order inside every command, in one transaction:
1. `SELECT … FROM workspaces WHERE id = $1 FOR UPDATE` (SQLite: `BEGIN IMMEDIATE`, as today). Always first, always the
   only lock, so there is no lock ordering to get wrong.
2. Replay check: look up `operations (workspace_id, id)`. Same id and fingerprint returns the stored result; a different
   fingerprint is refused. Scoped by workspace, so no other workspace's result can leak.
3. Read what the command needs, check versions, apply the domain change, write rows, insert the `operations` row with
   its inverse, commit.

Everything that writes goes through this lock: commands, **budget reservations, model results and settlement**, and
Undo. **External model calls happen outside any transaction:** reserve (locked, short) → call the provider (unlocked)
→ record the result (locked, short), as the model ledger already does.

**What each command family reads** (representative cases; a check never treats a missing row in a partial read as
"doesn't exist"):

| Family | Reads under the lock | Version checked | Writes |
| --- | --- | --- | --- |
| save-editor | the page, its blocks, tasks named by its task lines, provenance of its blocks | page `version` (today's `expectedContent`) | blocks, tasks created / renamed, provenance, links / tags index rows |
| plan-task, not-today, row actions | the task, its lines on the source and target day pages, both days' Top 3 role lines | task `version` | lines moved / written, `task_days`, task |
| Top 3 full | lines under the day's `plan-top3` heading (one indexed query) | — (safe under the lock) | — |
| paste-links, create-document | `pages` by `url_key` (unique index), the target page | target page `version` | pages, blocks, operations |
| move / delete / restore page | the page, its ancestors (cycle check) and descendants by `parent_id` | each page's `version` | pages, trash batch |
| Bring, AI proposals | `block_provenance` by source (indexed), the day page | page `version` | blocks, provenance |
| capture, model result | the capture / attempt row, the ledger sum for the day | attempt state | ledger, capture, blocks |
| undo | the operation, every row its inverse touches | each row is still at the version it left | the inverse, an undo record |

Workspace-wide questions (URL dedupe, Linked from, AI context, "was this brought already") are indexed queries run under
the lock, never inferred from the rows a screen happened to load.

**Contract suite v2.** `tests/repository-contract.ts` asserts today that two clients creating *different* days at
revision 0 give one stale loser. In v2 that case is **two successes, serialized**. New cases: the same page with a stale
version is refused and can recover; same-aggregate and cross-aggregate concurrency; two budget reservations racing for
the last of the budget (exactly one fits); lost-response replay and rollback after an exception, kept from v1. The
SQLite adapter runs v1 until A1 lands, then v2.

### R2. Operations, legacy receipts, Undo and provenance (A2)

- **Legacy receipts.** The 169 old receipts have no type, payload or time. They are imported as **legacy replay
  records**: original `id`, `fingerprint`, `entity_id`, `simulated`, the old message as `legacy_text`, `type` null,
  `created_at` null (unknown), `imported_at` set. Nothing is guessed. A pre-migration operation retried after the
  migration still replays (test).
- **Undo families stay typed, each with its own guard** (`undo_kind`): editor task create / delete (today's
  `editorCreations` / `editorDeletions`), paste-links (made / reused / restored outcomes, material-before), capture
  apply / remove (the `before` / `appliedSnapshot` checks, carried inside captures), row actions, page trash. A
  generic patch list is used only inside a family that keeps its "edited since" rule. An Undo that is invalid today
  never becomes valid after the migration.
- **The current one-step Undo is transitioned explicitly, not converted:** at the A2 migration, the pending Undo of the
  last action before it is closed, and its receipt reads "Undo isn't available after the update". A snapshot can't be
  turned into an inverse safely, so we don't pretend to.
- **Provenance outlives the block.** `block_provenance` takes every source pair now held in sections and
  `editorBlockMetadata`, for live and deleted blocks (the 5 orphaned entries in his data included). `wasBrought` and
  `isLineLinked` read it, so deleting a brought line doesn't re-offer it; a later Undo of the Bring sets `removed_at`,
  which restores eligibility.
- **Synthetic fixtures** cover what his data lacks (captures, materials, events, inline refs, each Undo family), in
  addition to the real copy.

### R3. Facts that joins and row versions can't rebuild (A3, A4)

- **Reference time** (`at` on refs and cards) is kept in the refs entry in block props, with `-1` (unknown) sorting
  last, through migration, copy, move and index rebuild. The `links` index copies it, so the index stays rebuildable.
- **`sourceFingerprint`** stays a stored token over kind, text and the page's day basis: moving a page under another day
  changes it while no block row version changes.
- **`last_planned_on`** stays a stored planning fact, written only by planning commands; a reference line on a later day
  (B22) is not planning.
- **Pending refs** keep `pending` and the provisional title in the refs entry, so pending vs removed and retry / Undo
  behave as today.
- **`createdOn`** stays a date; imported rows have `created_at` null.

### R4. The public server's auth gate (A5, release gate)

- **One gate, `requireOwner()`, wraps every server function and SSR loader** (`loadWorkspace`, `runCommand`,
  `submitCapture`, `retryCapture`, `draftMyDay`, the page loaders) and runs **before any repository or model access**.
  `getReadiness` stays public and returns nothing sensitive. The GET load that expires drafts runs only after the gate.
- **Identity is verified on the server** from the Supabase session (signature and expiry checked); a client-sent
  `workspace_id` or `owner_id` is never trusted. Authenticated but not the owner is refused the same way.
- **RLS is on the server's own path:** the server connects as a restricted role without `BYPASSRLS` (never the service
  role for requests) and sets the verified user's claims transaction-locally, so the owner-only policies apply to every
  query it runs. The privileged role is used only by migrations. Composite tenant FKs back this up.
- **Sign-up is closed** (his email only); sessions expire and can be revoked; cookies are `HttpOnly`, `Secure`,
  `SameSite=Lax`, and every state-changing request checks `Origin`. OTP request and verify limits use Supabase's auth
  rate limits; model calls are throttled per owner through the existing budget ledger, not by IP.
- **No journal content in public places:** responses are `Cache-Control: private, no-store`; no CDN caching of SSR;
  no public source maps; logs stay content-free.
- **Preview** uses sanitized fixtures by default; a real copy goes there only behind the same gate.
- **Negative tests (A5 gate):** no session; forged or expired session; a valid other user; guessed page / task /
  operation ids; direct anon and authenticated table calls; a cross-origin state-changing request; replay; concurrent
  model requests. Each must show **zero journal disclosure, zero writes, zero model calls or reservations.**
- **Driver:** `postgres` (porsager) over TLS with certificate verification, a pool of 5 on the session-mode pooler or a
  direct connection, one transaction per command.

### R5. Cutover fence and rollback (A6, release gate)

- **One authority at a time.** `storage_state` holds `epoch` and `authority` (`sqlite` / `supabase`). The server refuses
  any command whose epoch isn't current; an old tab gets "Daythread was updated · reload", with its text kept as a
  draft. **No automatic fallback, ever:** two writable stores is the failure this prevents.
- **Freeze and drain before the snapshot:** refuse new commands ("Moving your data · editing is paused for a few
  minutes"); wait for in-flight saves, model results and budget settlements; attempts still open are left `unknown` and
  recovered later by generation id (no second charge). Then `VACUUM INTO`, import, compare, switch the authority.
- **Equivalence for the compare:** export the new schema back into today's `Workspace` shape and compare it with the
  source, field by field, except a listed set of known differences (receipt text moved to `legacy_text`, unknown
  timestamps null, the closed one-step Undo). Order, provenance and `-1` reference times must match exactly.
- **Rollback with cloud edits:** the same freeze and drain on Supabase, then `export-to-sqlite` (current pages, blocks,
  operations and inverses, provenance, the model ledger), validated the same way, then one authority switch. Rehearsed
  before cutover with successful cloud writes and a refused command.
- **Recovery point and time:** Supabase daily backups (7 days on Pro) plus a nightly export to the Mac mini, so two
  independent copies at most a day old; restoring is rehearsed and takes about an hour. The 14-day SQLite file is the
  pre-cutover copy, not a live fallback.
- **Drafts on the old address:** localStorage doesn't move from `127.0.0.1:3000` to the new address. Before switching,
  the old app is opened once on each device he used; save-on-leave's "stuck drafts save on opening" sends them, and a
  check shows zero unsent drafts (or exports them to a file) before the old address is retired.
- **Supported pairs:** each A-step ships as build N with layout N and a rollback script to N-1, as today; after cutover
  the export rebuilds the latest local layout.

### R6. Durable model work on Fly, and account-scoped offline data (A6, A7)

- **One machine, no auto-stop** (`min = max = 1`), and a `SIGTERM` drain: stop starting model runs, wait up to 30 s for
  running ones, leave the rest as they are in the ledger.
- **Recovery on boot**, using what already exists: `markInterruptedModelAttempts` and `recoverUnknownCosts`
  (`src/server/model/service.ts`, `cost-lookup.ts`) settle unknown costs by generation id without calling again. A
  capture left organizing shows as failed with Retry: never re-sent automatically, so never charged twice.
- **A lease on each attempt** (`lease_owner`, `lease_until`) so a deploy overlap can't run one attempt twice.
- **Test:** kill the process after the provider answered but before the result was recorded → the attempt is
  recovered, no second charge, the capture offers Retry.
- **A7 is scoped to the account:** cache and queue keys include user and workspace; the service worker caches only the
  static app shell, never personalized HTML or server-function responses. Sign-out or an account change purges the
  cache; sign-out with changes waiting asks first ("2 changes waiting · send or copy them first"). An expired session
  offline still reads his own cache on that device until the next online check.
- **Queue records** hold an immutable `operationId`, `capturedAt`, the time zone and day, text, mode and workspace.
  Unknown network outcome → resend with the same id; expired session → held until he signs in; a refused item stops
  the queue and shows "Couldn't send · Copy text · Discard" on it, so it never blocks silently. `persist()` may be
  denied, so the status shows unsent changes until the server acknowledges them.

## Appendix: every stored field

Verdict: **keep** (a fact), **move** (a fact, wrong place), **derive** (computable, stop storing), **drop**.

| Table.field | Verdict | Note |
| --- | --- | --- |
| meta.schemaVersion, meta.revision | drop | layout version → migration table; global revision → row versions (§3) |
| meta.timezone | move | `workspaces.timezone` (Bumblebee: fine as data; only the literal type is the problem) |
| meta.undoOperationId / undoRevision, every `snapshot='undo'` row | drop | `operations.inverse` (§2.4) |
| *.position, *.present | drop | adapter details; positions move to `blocks.position` |
| pages.id, title, parentId, url, trashedAt, trashId | keep | `trashId` → `trash_batch_id` |
| pages.type, date | keep | `kind`, `day_date` |
| pages.sections | derive | from `blocks`; at import, the **source** of blocks for pages without `editorJSON` |
| pages.editorJSON | move | becomes `blocks` rows (§2.1) |
| pages.editorSections | drop | consistency copy |
| pages.editorBlockMetadata | move | live blocks' entries → block props; `paste:` records → `operations`. **Entries for blocks no longer in the page (5 in his data; Ratchet) are history, not props:** they stop Bring and the AI from suggesting the same line again and keep reference times and Undo working, so they map to `activity` / `operations`, never dropped |
| pages.editorCreations / editorDeletions | move | the editor-task Undo family in `operations` (typed, same guards; §10 R2) |
| pages.templateApplied | drop | a day page gets the template once, when created |
| pages.reviewText, reviewSaved, reviewStep, reviewSource, reviewSkipped, handoffDone | move | `day_reviews`, **all six as they are**, including partly present step/source; simplifying is a later product change (§7a) |
| pages.draft, draftError | move | `ai_runs`, `ai_proposals` |
| NoteBlock.kind, text, taskId, eventId, materialId, targetPageId | keep | `blocks.type`, `content`, `task_id`, props (`eventId`, `materialId` while those tables are supported) |
| NoteBlock.sourcePageId / sourceBlockId | move | `blocks.source_block_id` + `block_provenance` (kept after the block is deleted, §10 R2) |
| NoteBlock.planRole | derive | planned for this page's day or not (§2.2) |
| NoteBlock.at, PageRefEntry.at | keep | the reference-created order, kept as is in the refs entry / block props, `-1` = unknown sorts last (§10 R3) |
| NoteBlock.refs, Section.refs | keep | refs entries kept in block props (refId, pageId, at, title, pending); `links` is an index rebuilt from them |
| PageRefEntry.title, pending | keep | in the refs entry: the title is what the line's text was compared with; `pending` is the provisional creation intent (§10 R3) |
| NoteBlock.sourceFingerprint | keep | a content-and-context token (kind, text, the page's day basis), stored with the provenance; a row version can't replace it (§10 R3) |
| NoteBlock.linkPaste | move | the paste-links Undo family in `operations` (made / reused / restored, material-before; §10 R2) |
| Section.kind | move | heading block `role` prop, set by the template (§2.2) |
| tasks.title, status, plannedOn, deadlineOn, attentionOn, paused, sourcePageId | keep | `due_on`, `start_on`, `source_page_id` (a page identity, kept as one) |
| tasks.createdOn | keep | `created_on date`; `created_at` stays null (unknown), never a guessed instant |
| tasks.version | keep | the common `version` column |
| tasks.lastPlannedOn | keep | `last_planned_on`, written by planning commands only; a reference line on a later day is not planning (R3, B22) |
| placements.taskId, date | keep | `task_days` |
| placements.order | derive | the line's position |
| placements.state | keep | `excluded` and `moved` are facts (`task_days`); `included` is the line itself |
| placements.section | derive | from the role heading the line sits under (§2.2) |
| events.* | keep | 0 rows |
| materials.* | keep | carried as is; merging into link pages, `follow_ups` and an activity log is later (§7a) |
| captures.id, pageId, text, capturedAt | keep | |
| captures.status, failure, error, model, mode, proposals, proposalRevision, contextLine, simulated, proposedTitle, taskId | keep | carried as is, including `ProposalItem.before` / `appliedSnapshot` / `appliedVersion` (the capture Undo guards); the split is later (§7a) |
| receipts.operationId, fingerprint, entityId, simulated | move | `operations`, as legacy replay records (§10 R2) |
| receipts.message | move | `operations.legacy_text` for the 169 old receipts only; new operations render their text from type + data |
| model_attempts.* | keep | already a ledger beside the workspace |
