# Direct build of the general core on Postgres (no data migration)

Status: **plan for Ratchet's review.** No code until it passes.
Sources:
- Brian b15c12ac ("no need to migrate data"), e8b619b8 (host on Vercel);
- Lead's re-plan brief;
- the approved model: `docs/plan/supabase-data-model.md` §4 (general core), §10 (contracts) and §11 (additions), passed in #101 (626bc85);
- Jazz's `docs/design/empty-start-states.md` (2bac9b6);
- the Vercel setup on main 5ae7f12 (#103).

## 1. What changes with "no migration"

**The new app starts empty.** His current app keeps running on SQLite (3000) until the switch, then stays there
read-only as an archive (C6). Nothing is imported, and nothing is written back.

**Kept from the approved plan:**
- the general core (§4: blocks, collections, properties as data, relations, history, operations);
- the projection layer (§4.5) and the patch-only writes that keep unknown data (§10 R7.1);
- the workspace lock and per-row versions (§10 R1), including Ratchet's #102 findings;
- server-only writes with RLS (R4, R7.2), sign-in by emailed code, durable model work (R6);
- the speed and payload gates (§8), offline after launch (§3b), and §11's additions.

**Dropped, because they existed only to carry his data across:**
- lossless import and legacy receipts or history (R2 legacy, R3's unknown-date rules, R7.3);
- the step-by-step SQLite migrations with their rollback scripts (old S1–S4);
- the cutover fence, the 14-day export back and the drafts handoff (R5);
- old-tab grace.

**Changed:** hosting is Vercel instead of Fly (§5 here), and Oregon (`pdx1`) is next to Supabase West US (Oregon).

## 2. How it runs before the cloud

There is no Docker on the Mac mini, and nothing gets installed on his machine:
- **Local development and unit/contract tests: PGlite.** It's Postgres compiled to WebAssembly, an npm package
  (`@electric-sql/pglite`). `@electric-sql/pglite-socket` serves it on a local port, so the app's normal Postgres driver
  connects to it exactly as it will to Supabase.
- **Concurrency and RLS tests in CI:** a real `postgres:17` service container in GitHub Actions. It gives two real
  connections for the lock and version races and a non-owner role for RLS. CI still uses no secrets.
- **Sign-in and the full path:** staging (a Vercel preview plus the staging Supabase project), once Brian has entered
  the credentials.
- **To confirm in C1's first hour:** PGlite runs the schema with roles, `FORCE ROW LEVEL SECURITY` and `SET LOCAL`. If a
  feature is missing there, those tests run only on the CI container.

## 3. Steps

Each step gets its own branch from main and Ratchet's review. **C1–C3 are verified on PGlite and the CI Postgres
container** (no credentials needed). **From C4 on, each step also runs on the staging preview** before the next starts,
since staging needs Brian's credentials and sign-in exists from C4 (Ratchet 4efe3189). If his credentials arrive earlier, staging is used earlier; the date never depends on asking him sooner (Bumblebee d3b52122). The old app on 3000 is never
touched until C6.

| Step | What ships | Size |
| --- | --- | --- |
| **C1** Schema and harness | SQL migrations (`db/migrations/*.sql`) and a runner on `DATABASE_MIGRATION_URL`; the §4 tables in a schema the Data API doesn't expose; the restricted role `daythread_app` (no `BYPASSRLS`; `anon` / `authenticated` get nothing); owner-only RLS with `FORCE ROW LEVEL SECURITY`; constraints and partial unique indexes (§4.2); `app.create_workspace(owner)` seeding Jazz's §1: the five collections with their system properties, the day template with roles, nothing else. PGlite + CI-container harness | 4–5 days |
| **C2** Repository and projection | `PostgresWorkspaceRepository` on `postgres` (postgres.js, `prepare: false` for the transaction pooler); load = rows → the typed `Workspace` the domain and screens use today; execute = lock → versions → `applyCommand` → **patches of known fields only**; per-row versions and `namedRows` (§4 here); contract suite v2 on PGlite and the CI container; `DAYTHREAD_STORAGE=postgres` | 5–6 days |
| **C3** Operations and Undo | `operations`: replay by SHA-256 fingerprint; Undo from the before-images the projection captured (§6); `history` rows written by the commands that create facts (moved, not today, ticked) | 3 days |
| **C4** Sign-in and the auth gate | Jazz's sign-in screen (email → code, "Sent to {email}", 30 s "No code?"); Supabase OTP from the browser with the publishable key; `requireOwner()` on every server function and SSR loader before any database or model access; owner email check; `Origin` check on writes; `Cache-Control: private, no-store`; "Signed out · Sign in to save" through the draft-kept path; the R4 negative tests, including **a non-owner flow that looks identical to the owner's until the code fails** (no owner check ever shows on screen; Jazz); Jazz's capture conflict line | 4–5 days |
| **C5** Vercel runtime and gates | model work as durable `jobs` rows (§5) run with `waitUntil`, recovered by a cron; `model_attempts` on Postgres; Jazz's empty states and the **"Old notes ↗" row** (the new app reads the archive banner's marker, keeps it in this browser only, and shows the row; Jazz §3); the speed gate (day open under 300 ms p95 on Fast 4G) and payload gate (under 150 KB gzipped) on the staging preview; staging smoke with the bypass secret | 3–4 days |
| **C6** Switch | production env vars; his user, then sign-ups off; his workspace seeded; production deploys from `main` turned on (`vercel.json`); the **archive flag** and its banner with the marker link on 3000; production smoke | 1 day |

**About 20–24 working days: roughly 4.5 weeks to "from anywhere".** Starting around Oct 22, the switch lands in the
**week of Nov 16 (latest Nov 24)**, if Brian's staging credentials are in by C4 (around Nov 5); later credentials move
it by as much. No step grows without Lead's say; at the end of C4 we report whether C6 can move earlier (Bumblebee). Offline (§3b) is about 5–6 more days after launch.

## 4. Versions and named rows (the #102 findings carried over)

Each command sends `expected` versions for the rows it names. The server recomputes the set from the action, and a
named row that exists without its current version is refused. The table is the S1 spec's §3, plus Ratchet's two
findings:
- **`save-editor` names every task it changes,** not only those whose titles change through rows. That includes tasks
  it pauses through a deleted row (`singleDeleteIds`), and tasks it removes or restores through editor history
  (`editorCreations` / `editorDeletions`). Each one carries the version the editor loaded.
- **Every capture write carries the capture's start token.** That covers edit / save / remove-capture-item, discard,
  undo-capture and apply. `proposalRevision` is the token, and **every change to a capture advances it**, so two tabs
  can't overwrite the same pending item. A refused item edit shows Jazz's line, "Changed in another tab · showing the
  latest", with his text back in the field.

The old SQLite app keeps today's global revision check: its adapter ignores `expected`, because its pages have no
versions. Its behaviour doesn't change before the switch.

## 5. Vercel specifics

- **Lock in transaction-pooling mode:** `SELECT … FROM app.workspaces WHERE id = $1 FOR UPDATE` as the first statement
  of every write transaction. A row lock is held only for the transaction, so it is safe with Supabase's transaction
  pooler (port 6543), as `pg_advisory_xact_lock` would also be. Session-level advisory locks are not used. A C2
  contract test proves two writers serialize through the pooler on staging.
- **Model work after the response:** the request writes a `jobs` row (kind, the capture or day, `lease_until`,
  attempts) in the same transaction as the command, then runs it with `waitUntil` from `@vercel/functions`. A Vercel
  Cron every 5 minutes (Nitro `scheduledTasks`, protected by `CRON_SECRET`) picks up jobs whose lease expired. Recovery
  uses the ledger's existing rules: an outcome that might have been charged is settled by generation id, never called
  again (R6).
  - **The cron endpoint fails closed:** with `CRON_SECRET` unset it refuses every call, and a call without the right
    `Authorization: Bearer` gets 401, with no job touched.
  - **The schedule must fit the account:** Vercel's Hobby plan allows only daily cron jobs and rejects a five-minute
    schedule at deploy. C5 checks the account's plan before enabling it; on Hobby the schedule is daily, and the
    recovery at the start of each request does the timely work (he is the only user). This is an internal check,
    not a question for Brian.
  - **Testing it on a preview:** Vercel runs cron jobs only on production deployments, so on staging the smoke check
    calls the recovery endpoint itself with the secret (a job with an expired lease is picked up once) and without it
    (refused). Recovery also runs at the start of the next request, so a preview never depends on the schedule. `maxDuration` is 60 s, raised per route if a model call needs more.
- **Cold starts:** Fluid compute, with functions in `pdx1`. The C5 speed gate decides whether anything more is needed.
- **Secrets:** Vercel env only, scoped Preview or Production, as `docs/ops/credentials.md` lists them.
  `DATABASE_MIGRATION_URL` never goes to Vercel. Migrations run from the Mac, or from a CI job only if Lead later wants
  one.

## 5a. A lost reply is not a conflict (C2/C3; Ratchet, Bumblebee ab1b4b0a)

Today, when a save commits but its reply is lost, the editor shows "Changed in another tab · draft kept" even though its
own save landed (Ratchet's payload review; identical before and after the payload fix). On a phone network this
won't be rare. Requirement:
- the editor resends with the **same `operationId`**, never a new one, whether it retries or reloads first;
- the server deduplicates and returns the **original result**, with the page as that save left it;
- the editor treats a replayed receipt for its own pending save as **"Saved"**, and adopts that page as its new
  starting point, so no conflict line shows;
- a page that changed elsewhere *after* that save still goes to Load latest, as today.
**Contract and browser test:** commit, drop the response, resend → "Saved", no conflict line, the words saved once.

## 6. Undo without a snapshot

Today Undo restores a full copy of the workspace when nothing has changed since. In the new store, every command
already produces exact before and after images of the rows it changed (the projection's patches). The `operations`
row keeps the before-images as its inverse. Undo applies them only if every one of those rows is still at the version
the command left it. **Undo restores the content, never the version number:** each restored row gets
`version = current + 1`, so a client still holding the pre-command version can't match it and overwrite the undo
(Ratchet). That is today's behaviour for that command's rows. The editor's own history guards
(`historyTaskVersions`, `editorDeletions`, paste and capture records) stay in the domain, unchanged.
Inverses are bounded and pruned as in §9 of the main plan.

## 7. The switch and the archive (C6)

- **New app:** his user is created (auto-confirmed), then sign-ups go off, then his workspace is seeded. Production
  deploys from `main` are turned on, and production smoke is run.
- **Archive on 3000:** a server flag (`DAYTHREAD_ARCHIVED=1`) makes every command refuse with "Archived · read only",
  before the repository or the model is touched. **Reads write nothing either:** today's load also expires stale
  drafts (`loadWorkspace` → `expireDrafts`), which the flag skips.
- **The archive becomes immutable in one sequence** (Ratchet 3dfcf72):
  1. On the running app, stop new commands and new model starts.
  2. Drain: wait for in-flight model runs to finish (bounded by a timeout, since today's SQLite worker has no
     `maxDuration`). Any attempt still open is marked `unknown` in the ledger **now, before the freeze**.
  3. **Stop the old server process.** In-process model callbacks die with it, so nothing can arrive late.
  4. Start it again with `DAYTHREAD_ARCHIVED=1`. In that mode every mutation path is off at startup, including the
     model service and the boot-time ledger recovery (`markInterruptedModelAttempts`, `recoverUnknownCosts`).
  - After step 4, **nothing writes pages or the ledger**, not even a cost. If an unknown attempt still needs its cost
    reconciled, that goes in a separate operational note from the provider's dashboard, never by reopening the
    archive. Jazz's banner and link (§3) show on every screen.
- **The archive's check:** every write path is refused, including the editor save, capture, the morning card, Draft my
  day, Undo, row actions, paste and trash. **Reading every screen changes nothing**, including a day with an expired
  draft. **A model response held across the transition** and delivered after activation changes nothing either.
  "Unchanged" is proven by comparing the logical rows of every table (and checkpointing the WAL), not a file checksum
  alone. The model is never called (the ledger stays unchanged), and reading, the
  sidebar, search and Linked from still work.

## 8. Checks per step

- **Design check before Ratchet's** for every step that changes screens (C4 sign-in, C5 empty states and the Old notes
  row, C6 archive banner): Jazz at 390 and 1280 on a **fresh seeded workspace**.
- **Geometry gate fixture (C2):** `scripts/core-fixtures.ts` seeds a workspace through `app.create_workspace` on
  PGlite, then adds the fixture rows `check-alignment` needs (a day with every row type, cancelled task, card with and
  without preview, link card, nested bullets, long titles), so the gate runs without a SQLite copy.

- Unit and contract tests on PGlite, and the concurrency and RLS tests on the CI container, all in CI on every PR.
- The browser checks that exist today (two-tabs, B23, save-on-leave, races, undo, alignment) run against a
  `DAYTHREAD_STORAGE=postgres` build on PGlite, and on staging from C4 on.
- Ratchet's R4 negative list in C4, which needs zero journal disclosure, zero writes and zero model calls for every
  unauthorized request.
- C5's gates, with fail numbers, on the staging preview.
- From Ratchet's report: C3's history stays independent of prunable inverses, and an Undo keeps unrelated-row edits;
  the lost-reply test also covers a later edit from another tab; C5 runs restart, lease-expiry and double recovery
  against a fake provider with zero duplicate charges.
