# B98 implementation review (in progress)

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
