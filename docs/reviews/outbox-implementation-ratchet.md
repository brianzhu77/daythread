# PR216 independent review — clear at 6b1d07f6

**Conclusion:** no remaining review blocker at 6b1d07f6 (runtime bb5d7c8f, followed by a test-only oracle correction). Ready for the Lead’s full release gate; this review does not authorize deployment or production migration.

The runtime restructure at bb5d7c8f uses one pure `schedule()` for queue partition, blocker roots and banner counts, and one shared locked `drainQueue()` for every trigger. Every result changes storage before the queue is reread and selected again; transient failures stop the attempt without changing the pending entry into a hold. There is no requested-target scheduling branch.

The independent reference model follows dependencies recursively rather than calling the production selector. Reviewer requested colon-containing IDs, included in test-only 6b1d07f6. The selector and drain tests each pass 3,000 seeded runs independently; the 12 focused storage/client/account tests and build pass. The reviewer read model, oracle and integration; author mutation results are reported by the author, not independently reproduced here.

The reviewer independently reran the blocked-current orphan probe (only eligible earlier A sends), closed-A ordering (A then B), and shared-discard recovery (zero while held, one after Discard, no banner): all pass. Independent browser suites pass: Chromium 33/33 and WebKit 32/32. Full application/test typecheck passes. The latest colon-ID model tests were rerun successfully after the test-only update.

Production migration, old-tab Worker deployment, performance, backup/data checks and release remain the Lead's gate. No real account deletion, production write, deployment or real-phone run was performed by this reviewer.

The history below documents findings that led to the restructure; it is not a list of current open findings.

---

# B98 implementation review — historical findings and rechecks

Layer 1 initially reviewed at 816331ca. Browser and UX layers and the final PR are not yet reviewed.

## Confirmed findings, repaired and independently rechecked

1. **First replay after rollback could overwrite an unstamped older-build write.** Both stores checked stored tracking before noticing the gap during their next commit. The existing contract test inserted a new-build command before replay, hiding the first-request window. Reviewer probes fail on both SQLite and PGlite at 816331ca. Author fixed at 5d55adcd; both independent gap probes now pass.
2. **A future base revision is accepted.** When baseRevision exceeds the locked server revision, the rule selects row-based application. All row revisions look older, so the command applies. An entry surviving a database snapshot restore must instead be held. Both reviewer probes failed at 5d55adcd; reported as be59522b. Author fixed at 0daed055; both independent future-base probes now pass.

Independent executable repros: `node --test tests/ratchet-outbox-layer1.test.ts`. They directly simulate an older build changing a task and its workspace revision without stamping it, then make the first outbox request; the other case sends an entry whose basis is ahead of the restored server state. All data is throwaway. No runtime fixes made by the reviewer.

The signed design remains e1c37bef. These implementation findings do not authorize a release or production migration.

## Layer 1 recheck

At author head 0daed055, all four independent boundary probes plus five rule tests pass (9/9). The earlier full focused storage/replay run at 5d55adcd passed 39/39 and application/test typecheck passed. The final two-line repair was read directly. No additional layer-1 defect found within the reviewed source; the owner endpoint, real migration/floor rehearsal and browser/UX integration still require executable checks in the final PR. This is not a full-PR clear.

## Browser review at e4c64e97

Build passes. The four independent storage boundary probes and six client tests pass (10/10), including deterministic prediction/server task identity. Independent browser suites pass: Chromium 24/24 and WebKit 23/23. Those suites do not exercise the newly reported failures below. No full-PR clear: four browser/integration findings require repair and recheck.

### Open: cross-tab queue uses stale basis (5e6bd5ac)

Independent Chromium reproduction: two tabs open on the seeded day; hold A's tick request; tick the same task in B, then untick in B after 800 ms; release A. B falsely holds its tick as changed elsewhere and leaves the untick waiting. Server has only A's Done. IndexedDB holds the predecessor revision propagated by A, but B sends its old in-memory entry. The Web Lock currently wraps transport only, not queue selection, reread, and acknowledgement. Repro `tests/evidence/outbox/ratchet-two-tabs.mjs <preview URL>` expects the final box open and no conflict. Seed first with `seed.ts <throwaway sqlite path>` and serve that store.

### Open: account deletion leaves queued data (241fda62)

Successful Delete account only clears the offline copy/caches (`account-row.tsx`), never this owner's outbox. Sign out invokes `clearOutbox`, deletion does not. Confirmed by reading both paths and `clearOfflineData`; no real account deletion executed.

### Open: entirely unavailable IndexedDB bypasses warnings (5ca37837)

Independent Chromium test sets `window.indexedDB` to undefined before mounting, holds the legacy tick request, waits 1.8 s: zero not-durable warnings and a cancelable beforeunload event is not prevented. `store.current` is null but `durable.current` remains true. Repro `tests/evidence/outbox/ratchet-no-idb.mjs` (local port43845; seed a throwaway store first). Separately, code inspection shows the leaving guard only tracks active requests, not a memory-only failed change left awaiting Retry.

### Open: waiting is not transitive (12c9599b, b6f96aee)

Captured commands A creates database `newdb`, B adds row `newrow` to it, C renames that row. B depends on A; C depends on B but not directly on A. With A held, the actual app skips B but sends C, which becomes held with “Page not found”. Independently reproduced in Chromium by putting the captured queue into IndexedDB and reopening; the assertion that neither descendant is sent fails (1 request). Repro `tests/evidence/outbox/ratchet-transitive.mjs <preview URL>`, log `/tmp/ratchet-outbox-transitive.log`. This is a recovery-state injection, not a claim of manually completing all three UI operations. Waiting and banner counts must include the transitive dependency closure.

## Recheck at 626f3e3f (deletion helper/test at 85ca6fb8)

Original three browser repros now pass independently: two-tab tick/untick ends open with no held banner and empty queue; transitive descendants remain pending with zero requests; absent IndexedDB warns and prevents leaving. Build passes, 11 focused storage/client tests pass, and the new account-deletion helper test passes. Successful/refused deletion paths were read; no real account deletion was executed.

### Remaining shared-queue dependency gap (226e41dc)

The lock rereads only the target entry, while `blockedBy` still runs on the tab's private mirror before acquiring the lock. A held predecessor written by another tab is invisible. Independent built-app Chromium test mounts two tabs, adds a captured-shaped held task entry to shared IndexedDB from A, then ticks that task in B. B sends and applies its dependent change rather than leaving it waiting. `ratchet-shared-held.mjs` fails its zero-send assertion (1 send). Queue injection models an already held entry produced in another tab; it does not claim a manually completed conflict scenario. Re-read the owner's shared queue and evaluate blocking inside the lock.

### Remaining memory-risk bookkeeping gap

With IndexedDB absent, abort Water's tick as a network error: warning appears. Successfully tick Call the bank next: warning disappears and beforeunload no longer prevents departure, while Water was never sent. Independent Chromium repro `ratchet-memory-failure.mjs` outputs `{before:1,after:0,leave:false}` and fails. `memoryUnsent` is reset by any successful memory-only command, so it must track unresolved operation IDs instead.

## Recheck at bd5cd135

Build and 12 focused storage/client/account tests pass. All five earlier browser repros independently pass, including the shared-held zero-send check and memory-risk warning surviving an unrelated success. The shared-release extension below is the sole remaining reported blocker.

### Remaining: a resolved shared hold stays authoritative in another tab (7bb6a8af)

Extend the shared-held probe: discard A's held entry in IndexedDB, wait past the visibility refresh guard, focus B, wait 1.8 seconds. B sends zero and still shows the discarded held item plus one waiting change. `ratchet-shared-release.mjs` fails (expected one send). The early local `blockedBy` check prevents rereading shared state, and reconciliation keeps rows missing from storage via `shared.find(...) ?? e`. Shared state must reconcile removals before deciding whether a local entry is blocked. Recovery-state injection represents the shared queue after another tab's Discard; no real user data is involved.

## Recheck at 1f8d1838

Shared-release extension independently passes: zero sends while held, one after removing the blocker and returning, no banner. Build, 12 focused tests, original two-tab and transitive browser probes also pass.

### Remaining contract gap: shared pending entries are not drained in seq order (2d32d59f)

§6 says replay in `seq` order, and §7 explicitly extends that ordering across tabs. The lock now reads the whole queue but sends its requested target without first selecting earlier eligible pending entries. `ratchet-shared-order.mjs` mounts A and B, injects an earlier pending Water tick into shared IndexedDB, then ticks Call the bank in B. Only the later B operation is sent; the assertion that A goes first fails. An injected pending record represents a committed A entry whose tab-local command queue has not reached it yet. Select/drain earlier eligible shared entries under the lock; unrelated held entries may still be skipped. No user data involved.

## Recheck at 73b90f7a

Closed-A ordering probe passes: A then B on the wire. Shared release, transitive waiting and original two-tab probes pass; build and 12 focused tests pass. Browser suites are being rerun.

### Remaining: a blocked requested entry prevents draining an unrelated earlier orphan (a7f864c4)

Queue X held on Water, A pending Bank left by a closed tab, then B ticks Water. B depends on X, A does not. In built Chromium the wire is empty: the early `blockedBy(shared, fresh)` returns before selecting earlier eligible A. The new cross-tab drain must send earlier eligible entries before deciding whether its requested target waits. `ratchet-blocked-current.mjs` fails its expected-earlier-send assertion. Recovery-state injection, local throwaway store only.
