# Supabase/data model — independent pre-review

Ratchet · task #101 · 2026-10-22 · **Changes required before implementation**.
**Superseded by the accepted 8a07bc4 recheck in `supabase-core-ratchet-final.md`; initial findings below are retained as review history.**

Reviewed original 3f01b95 and revision **11497e4**, plus 8c19ac3's offline/usage clarifications, current source and a fresh read-only VACUUM copy of the real database. No application changes, production writes, cloud project creation, deployment or model calls. This is a plan review, not proof that migration/RLS/network tests have run.

## Recommendation and decision impact

**Keep path A, hosted Node + Supabase, and versioned BlockNote inline JSON.** Moving block identity/structure into relational rows removes duplication without requiring a second rich-text language. Preserve format version, validation, unknown-node handling and lossless round trips. Business rules should remain in application commands; database constraints should enforce identity, tenancy and transaction integrity.

Three findings affect sizing or the promised rollout, and should be reflected before Brian sees an estimate:
1. **A1 is a command/read-contract redesign**, including cross-aggregate invariants, not just loading a smaller Workspace. Include the lock/read matrix and contract-suite revision in its size.
2. **A2 must import legacy receipts and existing Undo/provenance**, rather than discard them. Add an explicit compatibility path and price its tests. Not all old facts can be reconstructed from receipts.
3. **Hosted model work must survive process replacement**, or explicitly preserve uncertain attempts and recover them safely. A long-running process alone does not guarantee this. Include restart/drain recovery in hosting scope. Offline A7 also needs tenant-scoped caches and drafts; it is not merely a service worker.

The remaining findings below are design/verification details within those steps, not new product questions or a reason to reopen A vs B. No new permission request is needed for revising this draft. Quantified estimates remain the author's responsibility.

## Independent database evidence

`/private/tmp/ratchet101.sqlite` was created with read-only source access and `VACUUM INTO`. Schema/facts scripts and non-content logs are in `tests/evidence/ratchet-supabase-101/`.

| Fact | Independent result |
| --- | --- |
| Current rows | **11 pages, 5 tasks, 10 placements, 169 receipts**, revision 169 |
| Undo rows | 11 pages, 5 tasks, 10 placements, 168 receipts, revision 168 |
| Empty entity tables | events/materials/captures: 0 current rows each |
| Ledger | 1 model_attempts row, outside undo snapshots |
| Missing editorJSON with actual content | Oct20 and Oct21 each have a projected task block |
| Metadata not in current editor tree | 5 entries; do not assume deletions mean history is disposable |
| Review state | includes handoff completion on Oct19/20/21 and partially present step/source fields |
| Source provenance | all 5 current tasks have sourcePageId |
| Reference ordering | current page-card times include **-1**, the existing unknown-time sentinel |

The original doubled entity totals were corrected in 11497e4. The new import fallback and preservation of deleted metadata are also acknowledged there: those are closed at intent level. The plan still needs the concrete mapping and compatibility gates below. The snapshot has no inline refs/captures/materials, so real-data round-trip alone cannot validate those features.

## R1 — Define the aggregate transaction contract and update its tests [size: A1]

§3 says commands load only touched rows and check row versions. That is insufficient for predicates and relationships:
- Two connections can both see two Top3 tasks, then insert distinct third rows. No pre-existing task row version collides. Lock the day's planning aggregate (and role heading/order changes), or use serializable transactions with bounded retries.
- URL creation needs the tenant-scoped unique URL key already proposed; task/day creation, parent moves, ordering, restore/trash descendants and multi-row task edits need their own read/write/lock sets.
- Duplicate operationIds must be serialized in the same transaction as writes; same id + same fingerprint replays, different fingerprint is rejected. Scope replay by workspace; do not leak another workspace's result.
- Model reservation limits are a sum/predicate too. Two requests must not both reserve under the same remaining budget. Keep result binding/settlement and domain application atomic, including the unknown-cost case.

Require a compact command-family matrix: data loaded, version checked, lock key/order, writes, receipt and inverse, retryable failure. No need to rewrite every command in this document, but define representative multi-aggregate cases before A1.

The claim that the repository contract suite stays **unchanged** contradicts per-row concurrency: `tests/repository-contract.ts` explicitly asserts that two clients creating *different* days at revision 0 have one winner and one stale loser. Rewrite/version this test for the intended contract, retain lost-response replay and atomic rollback tests, and add same-aggregate and cross-aggregate concurrency. Partial Workspace slices must never be interpreted as absence (URL dedup, backlinks, AI context and Undo currently scan workspace-wide data).

## R2 — Specify lossless import of operations, history and identity [size: A2; details: A3/A4]

11497e4 correctly stops treating deleted metadata as live-block props, but `activity/operations` is not yet a mapping. State which immutable fact, lookup key and reader replaces each retained record:
- Bring/AI suppression survives deletion of the brought row (`draft.ts:isLineLinked`, `workspace.ts:wasBrought`). A later Undo restores eligibility. Deleting the row must not delete this provenance.
- A2 URL-paste Undo includes created/reused/restored outcomes and material-before state; capture Undo and editor task deletion have distinct guarded scopes. A generic inverse is acceptable only if it preserves these scopes and all "edited since" checks.
- The existing one-step global Undo pointer/current+undo snapshots must be imported or explicitly transitioned without promising unchanged behavior. Do not make previously-invalid Undo valid merely because some touched row was unchanged.
- **169 old receipts have no type, action payload or timestamp.** A fingerprint is not a reversible action. Define legacy replay records retaining original fingerprints/results (and legacy UI text if necessary), unknown historical timestamps, and a migration-time marker distinct from actual creation time. Do not fabricate operation types/dates or silently forget old ids. Replay tests must include a pre-migration committed operation retried after cutover.
- `tasks.sourcePageId` is a page identity, not a block identity. All 5 current tasks have it. The appendix maps this to source_block_id, which cannot preserve the relation. Keep source_page_id or define a real, lossless source-reference relation. Similarly keep event/material line relations while those tables remain supported.

Empty tables today are not authorization to drop supported behavior. Test populated capture/material/event, source-copy deletion, restore and each Undo family using synthetic fixtures in addition to the real copy.

## R3 — Separate facts that cannot be reconstructed from joins/row versions [revision details]

- `PageRefEntry.at`/card `at` determine when a reference was created, not when its block was edited or moved. Preserve ordering and ties, including **-1/unknown sorts last**, across migration, copy, move and index rebuild. If inline content lacks reference time, a links index's created_at is **not wholly rebuildable from current blocks**. Retain a canonical reference-created fact or immutable operation provenance; do not assign every imported ref the import timestamp.
- `sourceFingerprint` includes text/kind **and ancestor day date basis** (`draft.ts:fingerprintOf`). A block's row version does not change when its parent page moves under another day. Define a content/context token or dependency-version tuple that preserves proposal invalidation. Do not substitute one row version without covering ancestor/date changes.
- B22 allows a task reference on several pages. The latest page containing a task row is not necessarily the last day it was *planned*: a reference pasted on a later day is not a planning action. Derive lastPlannedOn from planning facts/history, not arbitrary appearances. Keep planned intent separate from reference placement.
- A pending inline pageRef may target a page whose creation failed, with newTitle/retry behavior. "Existence is a join" alone loses pending-vs-removed semantics. Preserve provisional creation intent and test retry/Undo.
- Existing date-only createdOn must not silently become a guessed UTC creation instant. Preserve the known date and mark unavailable timestamps unknown.

## R4 — Public-server authentication and RLS must protect the actual backend path [release gate]

§3a now requires sessions, but §8 only tests anon-key reads. A direct privileged Postgres connection can bypass RLS: enabling policies is not proof that the server uses them. Choose and document either transaction-local verified user claims with a restricted role, or explicit server ownership enforcement with RLS as an independent API wall. Verify identity on the server; never trust a client workspace_id/owner_id. Use composite tenant-scoped references so a block/task/source cannot point into another workspace.

Inventory currently exposed functions: `loadWorkspace`, `runCommand`, `submitCapture`, `retryCapture`, `draftMyDay` (`src/server/functions.ts`) and `getReadiness`. Reject unauthorized requests **before** repository/model access; a GET load currently also expires drafts. Keep health responses non-sensitive; protect hydrated HTML/loaders as well as POSTs. Authenticated but non-owner is also unauthorized. Close signup to Brian's account/allowlist, with session expiry/revocation handling.

Required negative checks: no session, forged/expired session, valid other user, guessed page/task/operation ids, direct anon/authenticated table calls, cross-origin state-changing request, replay and concurrent model requests. Assert **zero journal disclosure, zero writes, zero model calls/reservations**. Add CSRF/origin controls for cookie-authenticated commands, safe session cookies, OTP request/verification limits and owner-level model throttling (IP-only limits can be bypassed or shared). No journal payloads/secrets in public logs, cached SSR/CDN responses or source maps. Preview access must be protected *before* putting a real copy there; sanitized fixtures are preferable by default.

Supabase documents privileged-role RLS bypass and configurable auth limits: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits). These support the test requirements; no RLS implementation was exercised here.

## R5 — Define the cutover fence and rollback with post-cutover edits [release gate]

The freeze flag + backup + switch is only a sketch. Freeze/drain *all* writers, including in-flight saves, model result settlement and budget reservations, before the source snapshot. Use a storage epoch/fence so an old client/worker cannot resume writing SQLite after cloud activation. Preserve operation ids across lost replies and browser retries.

Rollback must also freeze/drain Supabase writers, export a consistent snapshot **including cloud edits, operations/inverses and the non-undo model ledger**, validate it, then switch one authority atomically. Define which app/schema pair is supported at each A1–A6 step and rehearse both successful post-cutover writes and a rejected command before reversing. A 14-day untouched SQLite file is not a current fallback if Supabase is unreachable; record recovery point/time expectations and backup/export cadence. Never auto-fallback and create two writable authorities.

Switching from localhost to a public origin does not transfer localStorage. Identify unsent drafts on the old origin and provide a safe export/import or flush handoff before asking Brian to use the cloud exclusively. Old browser tabs and capture queues need explicit retry/refresh behavior across each format/epoch change. Do not say "deep-compare" without defining equivalence for the reshaped schema, preserved ordering/history and known-unknown dates.

## R6 — Hosted asynchronous model work and offline cache boundaries [size: hosting/A7]

Fly avoids serverless suspension after a response but not restart, deploy, scale-to-zero, process crash or duplicate instances. `void organizeCapture/draftDayRun` can still be interrupted. Define a durable claim/recovery path using the persisted run/attempt identities (or equivalent worker queue), worker lease/ownership, recovery of unknown provider outcomes without another charge, and graceful shutdown/drain. Test process termination after provider success but before result persistence. Do not imply a long-running host makes fire-and-forget work durable.

For A7, scope caches/drafts/queued captures to the authenticated user and workspace, not just pageId. On sign-out/account change/expiry specify what can still be read offline, how unsent text can be recovered without showing it to another account, and purge rules. Do not service-worker-cache personalized HTML/serverFn responses globally. Queue records need immutable id, capturedAt + captured timezone/day, text/mode and workspace; network unknown outcome, auth expiry, missing/trashed target and permanently refused first item must not lose the queue or block every later capture forever without a visible recovery action. Model dispatch stays server-only and deduplicated.

`persist()` may be denied; add-to-home-screen is not a data-durability guarantee. Display unsent status until acknowledged by the server. The plan correctly distinguishes offline work from cutover; keep this an independently gated step.

## Remaining bounded choices and consistency edits

- **Positions (§9):** sparse integer ranks with deterministic tie-break/rebalance are adequate for this one-user product. Fractional text is also viable with a specified algorithm, C/binary collation, equal-rank conflict handling and rebalance bound. It is not guaranteed that every concurrent move writes only one row; don't turn the choice into a new product decision.
- **Inverse size (§9):** bound request/operation size before mutation, or store larger inverses separately. Never commit an operation that advertises Undo while silently truncating its inverse. Define retention vs replay separately; pruning Undo must not re-enable a paid/model operation.
- Reconcile schema/appendix/§7a: materials "as is later" vs follow_ups now; captures mode/status split vs unchanged; review step/source/skipped kept vs derived/dropped; position refers to task_days.position absent from its schema. An execution plan needs one accepted mapping, not mutually exclusive alternatives.
- Put unique/check/FK/delete semantics in the schema draft: one day per workspace, URL identity including trash, same-workspace parents/sources, no parent cycles, task FK and operation key. Soft deletion/history must not accidentally cascade away audit/Undo facts.
- Pin driver, TLS verification, pool mode/limits and transaction boundaries. Session-mode/direct is suitable to evaluate for the chosen persistent host; transaction pooling has different session-state/prepared-statement rules. [Official connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) documents those differences. No measured 1ms latency or Fly cost proof is asserted by this review.

## Review closure

11497e4 closes the original count and editorJSON-only import omissions at intent level and adopts the lower-risk inline format. Revise R1–R6 into explicit contracts and acceptance cases, mark size changes, then return a single version for re-review. No implementation or public preview is approved by this report. All local evidence scripts only read the copied database; no QA servers were started.

### Post-review scope simplification (Lead 442f159f, Ratchet 5a6618b9)

A single transaction-scoped **workspace lock** is accepted instead of fine-grained lock keys for this one-user product. Take it before authoritative reads, then validate/write/append operations; commands, Undo, budget reservation and model-result settlement must all use it. External provider calls stay outside the transaction. Retain the read-set specification and per-page conflict tokens. New contract tests: writes to different pages serialize and both succeed; stale writes to the same page are refused. Revisit the coarse lock if multi-user load requires it. This narrows R1 implementation complexity without removing its safety requirements.
