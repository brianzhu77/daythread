# A4 independent migration acceptance — task #77

Candidate **f421ead: PASS for migration, rollback and domain acceptance**. Design/browser signoff remains Jazz's separate review against layout 2956eea. Evidence-only successor 9936224 does not change the application reviewed here.

## Independently executed

- Full suite with FUTURE_DAYS_CONTRACT=1: 218 tests, 214 passed, four TODO, zero failures. Evidence tests/evidence/ratchet-trash-77/suite.log.
- Reran the author's actual §5 roundtrip on a fresh isolated SQLite file, using an independent detached checkout of **5193991** for old-build reads, edits and Undo. All 16 assertions passed. This is a reviewer rerun of the author's harness, not an independently designed test. Covers two batches, partial restore, real downgrade script, backup failure/refused repeat, both Retry cases, old/new task and material source separation, capture remap, ledger retention, re-upgrade Undo clearing and subsequent working Undo. Evidence roundtrip.log; original harness tests/evidence/a4-trash/roundtrip.ts.
- Independently designed boundaries in boundaries.ts/log: injected abort after held-table creation during downgrade leaves schema, every row, revision and Undo unchanged; malformed held editor JSON fails re-upgrade after ALTER/drop work and restores the entire original layout-3 state; an empty-body Retry page with an unrecorded new task source is kept rather than discarded; section references, editorJSON pageLink and block metadata all follow the held id mapping while live content stays intact. Fixtures explicitly include synthetic SQL source/reference entries to isolate these branches. An initial harness add-task omitted its required page/section and failed; the corrected harness adds the task to a separate page, then seeds the external source edge.
- Read-only VACUUM INTO copy of Brian's actual layout-3 database: opening in candidate layout 4 preserves the complete domain workspace exactly. Actual rename and Undo preserve pages, tasks, placements and materials. Evidence real-copy.ts/log. No production database writes or provider calls.

## Source review and remaining limits

The script checks application id, exact schema and version, creates and verifies a consistent SQLite backup before mutation, and holds/drop/version changes within a transaction. Live present fields are stripped; held records preserve them. Re-upgrade clears whole-workspace Undo when held pages return. Empty-page detection ignores only recorded pre-rollback source edges; new task/capture/material sources prevent discard. This matches Lead 7ceca4ea and revised plan.

Author's raw-SQL feasibility experiment is not the acceptance basis: the actual script and migration were rerun. Physical iPhone/Chinese IME was not tested. No reviewer browser/design pass is claimed; Jazz owns the nested-page and 390/1280 design review. Lead owns deployment and a pre-release upgrade/downgrade/re-upgrade rehearsal on a fresh real-data copy. Both rollback and re-upgrade reset Undo; the accepted rollback note must state that. Normal sibling position is not promised until B14.
