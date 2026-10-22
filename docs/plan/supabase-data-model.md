# Supabase storage and data model review

Status: **draft for review** (Ratchet independent check, then Lead summarizes decisions for Brian). No code changes until then.
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
   host in one cutover, with a tested way back. About **3 weeks**. Path B (move and host now, clean up in the cloud)
   gets him there in **about 1 week** but makes every later model change a live cloud migration (§0a, §5).
4. **§7a sorts every change into "with the move" or "later, no data migration"**, with sizes. **Decisions** are in §7:
   path, hosting, privacy / plan / region, auth, server location, SQLite fallback, and the model choices with product effect.

## 0a. His goal: use it from anywhere (answered: A)

Brian d3a9c476 chose "use Daythread from anywhere without the Mac running". That puts three things in scope that were
optional before: **the server is hosted** (§7 row 5b), **sign-in is required** on every request (row 4), and **being
offline becomes a normal case** on his phone, not a rare one (row 5c).

| Option | Time to "from anywhere" | Cost |
| --- | --- | --- |
| **A + host at cutover (recommended)** | About 3 weeks: A1–A4 cleanup locally, then A5 (Postgres, sign-in) and A6 (cutover + hosting, 2–3 more days) | Features wait about 3 weeks; cloud only ever sees the clean schema |
| **B + host now** | About 1 week: Postgres adapter for today's tables, sign-in, hosting, cutover | Every cleanup after that (blocks, operations, roles) is a migration of live cloud data with a cloud rollback; more total work |

What made B more viable than it first looked: with the server hosted **in the same region as the database**, a query
is about a millisecond away, so today's whole-workspace load (25 KB) is cheap there. The global revision stays, but he
is one user. B's real cost is not speed; it is doing the cleanup on live cloud data. **A stays the recommendation**,
because his request was the clean structure first and the cleanup steps are where the risk is.

**Optional bridge while A runs:** a private network such as Tailscale on the Mac mini and his phone gives phone access
to today's app (it only listens on 127.0.0.1 now) with no code change and no data in the cloud: about an hour, his
devices only. It still needs the Mac on, so it is a bridge, not his goal. His call.

**What pauses during A (about 3 weeks):** every step changes `src/domain/workspace.ts`, so new features wait or rebase:
A11 (already paused), A7, B21/B22, and the A6b-2 follow-up. The usage reads (Oct 22, Oct 25) are unaffected.

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
`version int`. Positions are fractional-index text so a move writes one row.

| Table | Columns (besides the common ones) | Replaces |
| --- | --- | --- |
| `workspaces` | `owner_id`, `timezone`, `settings jsonb` | `meta`, literal timezone |
| `pages` | `kind` (`day` / `document`), `day_date` (unique per workspace), `title`, `parent_id`, `url`, `url_key` (computed from `url`, unique index), `trashed_at`, `trash_batch_id` | `pages` minus content, review, draft, editor fields |
| `blocks` | `page_id`, `parent_id`, `position`, `type`, `content jsonb`, `props jsonb`, `task_id` (task line), `source_block_id` (copy/bring) | `editorJSON`, `sections`, `editorSections`, `editorBlockMetadata` |
| `templates` | `name`, `blocks jsonb` | `dayTemplate`, `templateApplied` |
| `tasks` | `title`, `status`, `planned_on`, `start_on`, `due_on`, `paused`, `source_block_id` | `tasks` minus `lastPlannedOn` |
| `task_days` | `task_id`, `day`, `state` (`excluded` / `moved`) | `placements` (order and section come from the line) |
| `events` | `title`, `day`, `time`, `cancelled` | `events` |
| `follow_ups` | `page_id`, `state`, `next_on`, `skipped_until`, `resurface` | `materials` review fields |
| `day_reviews` | `day`, `text`, `step`, `source`, `skipped`, `finished_at`, `handoff_done_at` | page review fields |
| `captures` | `page_id`, `text`, `captured_at`, `mode` | `captures` (user part) |
| `ai_runs`, `ai_proposals` | see §2.6 | page `draft`, capture model fields |
| `model_attempts` | unchanged | unchanged |
| `operations` | `id`, `type`, `fingerprint`, `result jsonb`, `inverse jsonb` | `receipts`, undo snapshot, in-entity undo records |
| `links` | `source_block_id`, `ref_id`, `target_page_id`, `target_block_id`, `kind` | `refs`, references index, Linked from scan |
| `block_tags` | `block_id`, `tag_key`, `tag` | tags scan |
| `activity` | `entity_id`, `kind`, `day`, `data jsonb` | `openedOn`, `dismissedOn`, `decisions` |

`jsonb` is used only where the content is a document (block content, settings, operation patches, AI manifests), never to
hide relational facts. Check constraints cover closed sets that are facts (`tasks.status`), not product taxonomies.

## 5. Paths

### A. Clean up locally in steps, then move (recommended)

| Step | What ships | Rough size |
| --- | --- | --- |
| Bridge | (Optional, his call) Tailscale on the Mac mini and his phone: today's app reachable from anywhere, Mac on (§0a) | hours |
| A0 | Spike, thrown away after: a hello-world on the chosen host + a Supabase project in the same region; measure day-open and save p95 from his Mac and phone against the §8 budget, so a miss shows up in week 1, not week 3 | half a day |
| A1 | Repository contract becomes per-aggregate (`loadDay`, `loadPage`, `execute`), still on SQLite; domain commands keep working on a loaded slice | 3–4 days |
| A2 | `operations` table: replay, receipts without stored copy, undo by inverse; drop the undo snapshot and in-entity undo records | 3 days |
| A3 | `blocks` table as the only content source (the import also builds blocks for day pages that have sections but no `editorJSON`, e.g. Oct 20 and 21; Ratchet); `content` keeps BlockNote's inline shape, versioned (`content_format`), validated, lossless round trip (Ratchet's conditions, §9.2 decided); browser maps rows ↔ editor blocks; `links` / `block_tags` indexes | **3 days** (was 4–5) |
| A4 | Split page: `day_reviews`, `ai_runs`; heading roles and the computed slot instead of `top3`; `task_days`; templates as data (materials stay as they are, §7a) | 3–4 days |
| A5 | Postgres adapter for the clean schema (local Supabase in Docker, same contract suite); sign-in by emailed code; every server function requires a session | 3 days |
| A6 | Cutover + hosting: preview deploy rehearsed, import with round-trip check, switch, keep SQLite read-only; export-back script tested for the rollback window (§3a) | 3–4 days |
| A7 | Offline first version (§3b), after cutover: reading, typing into the draft, the capture queue, one status | 4–5 days |

About **3 weeks** to "from anywhere" on the clean schema (A0–A6), then about 4–5 days for the offline first version (A7). **Step order is
otherwise unchanged:** the bridge covers reachability now, so pulling sign-in and hosting earlier would only mean
hosting today's model (path B's cost) for no gain. **Bridge: engineering recommends yes**, since it gives him the value he
asked for this week at a cost of hours, touches no data, and is removed at cutover.

About **3 weeks** of build time, each step reviewed by Ratchet and live on 3000 before the next. Benefit: every model
change happens on a local file with our proven migration + rollback scripts and his real data copy; the cloud only ever
sees the clean schema. Cost: he's not on Supabase until A6. Product work can continue between steps, but each step touches
`workspace.ts`, so new features would wait or rebase on it.

### B. Move now, clean up in the cloud

Postgres adapter for today's tables (same columns + `workspace_id`, JSON text → `jsonb`), cutover, then A1–A4 as Postgres
migrations. On Supabase in **3–4 days**. Cost: the global revision and whole-workspace load go over the network (every
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
| 1 | Path A (clean up locally, then move) or B (move now, clean up in the cloud) (§5) | **A** | A: about 3 weeks before he is on Supabase; B: 3–4 days, but each later cleanup is a live cloud migration | Either can switch before cutover; after B's cutover, going back means the export script |
| 2 | Hosted Supabase or local Supabase (Docker on his Mac) | **Hosted** for real use; local Supabase only for development and tests | Hosted: a plan fee, his journal in the cloud. Local: no gain over today's SQLite file | Yes: the same schema runs in both; moving is a dump and restore |
| 3 | Privacy, region, plan | His own Supabase account, **US West** region, **Pro plan** | **Pro: $25/month** (includes $10 of compute, one Micro instance), **daily backups kept 7 days** (Lead checked the pricing). The free plan pauses after 1 week inactive and has no backups, so it is not an option for his only copy. The repo's rule so far was "private data, never a cloud fallback" (`.gitignore`), so this is his explicit call | Yes while the SQLite copy is kept; data already sent to the cloud stays there until he deletes the project |
| 4 | Auth and row-level security | **Supabase Auth, his account only, sign-in with an emailed 6-digit code** (not a magic link: his phone opens the Mac's LAN address and a link's redirect won't land there; Jazz 6e1c0707). **RLS on every table, owner only.** The server keeps all writes and connects with its own role. An expired session mid-edit behaves like a failed save: draft kept, "Signed out · Sign in to save" | About a day in A5; sign-in once per browser | Yes: RLS policies are migrations |
| 5 | Where the server runs | **Hosted** (his goal A), see 5b. Until cutover it stays on his Mac | See 5b | Yes |
| 5b | **Server hosted** (in scope: his goal A) | **Fly.io, long-running Node, next to the database** (§3a); not Vercel | About **$6–7/month** (1 GB) on top of Supabase Pro: about **$32/month** total. Build in A6 | Yes: the same build runs on his Mac again, pointed at the same database |
| 5c | **Offline** (now a normal case on his phone) | **Read offline + keep typing into the draft; task actions disabled with "Needs a connection"; no write queue until usage shows he needs one** (joint direction, §3b). Ships as A7 after cutover | A7: about 3–4 days. A queue for ticking only, if he hits "Needs a connection" more than about twice a week | Yes: none of it changes stored data |
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
| Global revision, whole-workspace load (§3) | **With the move** | Required for the network; per-row versions | 3–4 days (A1) |
| Revision-number times, title snapshots (§2.5) | **With the move** | Columns change | in A3 |
| Timezone literal (§2.8) | **With the move** | One column; trivial | in A1 |
| `links` and `block_tags` indexes (§2.9) | **Later** | Computed from blocks, rebuildable at any time | 1 day when needed |
| Realtime refresh, multi-step undo, review simplification | **Later** | Behaviour only | — |

Total "with the move" matches path A's steps (§5): about 3 weeks.

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

- Fractional-index positions vs integer positions with renumbering (Ratchet).
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
    step. If you take it, A3 drops to about 3 days and path A to about 2.5 weeks.
- Whether `operations.inverse` needs a size cap (a large paste or delete).

## Appendix: every stored field

Verdict: **keep** (a fact), **move** (a fact, wrong place), **derive** (computable, stop storing), **drop**.

| Table.field | Verdict | Note |
| --- | --- | --- |
| meta.schemaVersion, meta.revision | drop | layout version → migration table; global revision → row versions (§3) |
| meta.timezone | move | `workspaces.timezone` (Bumblebee: fine as data; only the literal type is the problem) |
| meta.undoOperationId / undoRevision, every `snapshot='undo'` row | drop | `operations.inverse` (§2.4) |
| *.position, *.present | drop | adapter details; positions move to `blocks.position` / `task_days.position` |
| pages.id, title, parentId, url, trashedAt, trashId | keep | `trashId` → `trash_batch_id` |
| pages.type, date | keep | `kind`, `day_date` |
| pages.sections | derive | from `blocks`; at import, the **source** of blocks for pages without `editorJSON` |
| pages.editorJSON | move | becomes `blocks` rows (§2.1) |
| pages.editorSections | drop | consistency copy |
| pages.editorBlockMetadata | move | live blocks' entries → block props; `paste:` records → `operations`. **Entries for blocks no longer in the page (5 in his data; Ratchet) are history, not props:** they stop Bring and the AI from suggesting the same line again and keep reference times and Undo working, so they map to `activity` / `operations`, never dropped |
| pages.editorCreations / editorDeletions | drop | `operations.inverse` |
| pages.templateApplied | drop | a day page gets the template once, when created |
| pages.reviewText, reviewSaved, reviewStep, reviewSource, reviewSkipped, handoffDone | move | `day_reviews`: text, finished_at, handoff_done_at; step / source / skipped derived or dropped |
| pages.draft, draftError | move | `ai_runs`, `ai_proposals` |
| NoteBlock.kind, text, taskId, eventId, targetPageId, sourcePageId/BlockId | keep | `blocks.type`, `content`, `task_id`, `source_block_id`; `materialId` → a link page |
| NoteBlock.planRole | derive | planned for this page's day or not (§2.2) |
| NoteBlock.at, PageRefEntry.at | move | `created_at` |
| NoteBlock.refs, Section.refs | derive | `links` index from block content |
| PageRefEntry.title, pending | drop | join on `pages` |
| NoteBlock.sourceFingerprint | drop | row `version` |
| NoteBlock.linkPaste | move | `operations` |
| Section.kind | move | heading block `role` prop, set by the template (§2.2) |
| tasks.title, status, plannedOn, deadlineOn, attentionOn, paused, createdOn, sourcePageId | keep | `due_on`, `start_on`, `created_at`, `source_block_id` |
| tasks.version | keep | the common `version` column |
| tasks.lastPlannedOn | derive | from `task_days` |
| placements.taskId, date | keep | `task_days` |
| placements.order | derive | the line's position |
| placements.state | keep | `excluded` and `moved` are facts (`task_days`); `included` is the line itself |
| placements.section | derive | from the role heading the line sits under (§2.2) |
| events.* | keep | 0 rows |
| materials.url, title, body, savedOn, sources | move | a link page, later (decision 7c, §7a) |
| materials.reviewState, nextReviewOn, skippedUntil, resurface, lastDecisionOn, taskId | move | `follow_ups` |
| materials.openedOn, dismissedOn, decisions | move | `activity` |
| captures.id, pageId, text, capturedAt | keep | |
| captures.status, failure, error, model, mode, proposals, proposalRevision, contextLine, simulated, proposedTitle, taskId | move | `ai_runs` / `ai_proposals` |
| ProposalItem.before, appliedSnapshot, appliedVersion | drop | `operations.inverse` + row versions |
| receipts.operationId, fingerprint, entityId, simulated | move | `operations` |
| receipts.message | drop | UI copy, rendered from type + data |
| model_attempts.* | keep | already a ledger beside the workspace |
