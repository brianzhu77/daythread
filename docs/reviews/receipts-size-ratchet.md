# B32 receipts size — independent review

Ratchet, task154. **PASS at 9245e76 within the explicitly finite replay contract.** No application changes, real-row writes or deployment by reviewer.

Independent execution: full suite378 pass,0 fail,11 skipped,4 TODO (393 total); typecheck and production build pass. `tests/evidence/ratchet-receipts-154/independent.ts` independently checks add→Undo→original operation replay leaves zero tasks and revision unchanged; old JSON fingerprints including CJK/emoji convert and still replay; tombstones reject even latest revision; dropped receipts reject browser stale revisions. The original pre-change Undo probe already passed: current receipts are preserved, not restored from Undo.before.

**Finite boundary independently confirmed:** after 3500 newer receipts remove an old id entirely, a generic command replayed at the latest revision can apply again. The implementation does not and cannot infer an unknown arbitrary id's age. Browser retries retain their old expectedRevision; existing server model paths rely on runId/status checks and durable model-result binding. This is the boundary Lead accepted after the plan was clarified, not a perpetual exactly-once guarantee. The author's tests exercise draft-state guards; model-result.ts independently retains attempt result binding before domain application. Future generic executeOnLatest callers must not assume a retained receipt beyond this horizon.

Source review: Undo snapshots exclude receipts while Undo restores current receipts; compaction runs only after a successful mutation so a failed command cannot trim/persist partial state. Legacy string comparison happens before conversion. PostgreSQL storage remains JSON preserving insertion order; no schema/layout change. The older build sees hashes/tombstones as mismatched fingerprints and refuses those retries; its new writes can grow until roll forward. Lead owns the real older-build Postgres roundtrip.

Author measurements (not independently rerun by reviewer): copied row2234KB→75KB, local Postgres save median34ms→2ms; browser payload25KB before and after. `forBrowser` already strips receipts/Undo.before; database row reduction is not browser-download reduction.

No CSS/browser interaction changed; no unrelated UI suite rerun was needed. Lead owns rollback rehearsal, backup and deployment. Review code is for author review.
