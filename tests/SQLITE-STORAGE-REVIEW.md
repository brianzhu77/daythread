# SQLite storage — author verification (task #43)

Status: author checks passed; independent review pending. Base b2e541f, branch feat/sqlite-storage. No main merge, live data migration, 3000/3001 restart, Supabase connection, or deployment performed.

## Result

The application uses the WorkspaceRepository boundary and normalized SQLite tables (scalar entity columns, JSON for nested fields), with current/undo partitions to retain the existing Undo contract. Only changed rows are upserted/deleted in one transaction. A future Supabase adapter must pass the same contract suite and implement atomic revision/receipt behavior; it is not implemented here. Its Undo design should use operation-level inverse records rather than copying the temporary snapshot design.

Database initialization is write-locked and one-time. Layout migrations are ordered and tracked separately from Workspace schema. Incompatible/missing tables, unknown mapped fields, newer layouts, duplicate entity keys, or round-trip mismatch fail without reimporting old data. Legacy source bytes remain unchanged. All optional field maps are exhaustive at typecheck; runtime presence information distinguishes absent optional fields from explicit null.

## Actual checks

- `npm test`: 58/58, including repository contract, metadata-only debug logging, and all existing domain/editor tests.
- `npm run typecheck`: passed.
- `npm run build`: production client/server build passed. Existing large editor bundle warning remains.
- Contract: reopen persistence; commit-but-lost-response replay using old revision; changed payload under same operationId rejects; stale requests reject; competing clients serialize; failure after entity writes but before receipt/meta commit rolls back current/undo/receipts/revision across reconnect and subsequent operations work.
- SQLite-specific: full optional-field fixture, nontrivial array order, receipts and Undo import round-trip; source unchanged; later source changes ignored; malformed/unknown-field/duplicate-Placement imports reject and can retry after correction; missing table/column and future layout reject; three independent processes writing revision 0 produce one winner and two stale losers.
- Debug: default off; enabled one-line JSON uses an explicit allowlist; success, replay and error logs omit sentinel note/task content and raw error messages. One DAYTHREAD_LOG=debug server switch configures client on load/refresh. Refresh has its own ID plus optional triggering command ID.
- Real Chromium, isolated port 3043 and `/tmp/daythread-sqlite-smoke.sqlite`: write a task, intercept save POST after server commit and abort the response, click Retry saving; browser and server use the same save operationId for committed/replay, refresh uses a distinct linked ID, reload shows one task, zero page errors, no sentinel note text in browser/server debug logs. Script: scripts/sqlite-browser-smoke.mjs (only disposable data!). Repeated after transport/editor instrumentation changes.

## Copies of real local data

Only copies were imported. No note/title text printed or included here.

| Source copied | Source SHA256 | Evidence |
| --- | --- | --- |
| trial pre-e54c9f3 backup | 5e1f71e88353c8ae9da144a73f1999dab797f9f26c864bdae52c9e678395a04d | 5 pages, revision 33, 0 tasks/placements; deep round-trip equal, copied source unchanged |
| main `.daythread-local/workspace.json` | b1fc0e015df04fe467b1c0c920e770cf016cb0d0b8c08ed253635e2877bb1333 | 4 pages, revision 12, 12 receipts and Undo; deep round-trip equal, copied source and live original hashes unchanged |

Main copy directory: `/var/folders/54/kknm2fp14s1ft0h63zccl1t40000gn/T/daythread-main-sqlite-XJjykZ`. Trial copy directory: `/var/folders/54/kknm2fp14s1ft0h63zccl1t40000gn/T/daythread-brian-sqlite-V4xs4u`. These copies lack Tasks/Placements, so relationship/duplicate coverage comes from the full synthetic fixture, not from those data files.

## Limits and review focus

- Node 24.14.1 / SQLite 3.51.2 tested; Node 24's built-in SQLite emits an experimental notice. No native npm dependency added.
- Synchronous transaction execution loads the personal workspace in memory. No claim about large multi-user throughput or serverless persistence.
- Only server/client diagnostic metadata is logged. Debug is off by default; enabling changes requires the next browser load/refresh to pick up the boolean.
- Real iPhone/Safari/IME and Brian's continuous-editor acceptance remain separate and unverified here.
- Editor changes are limited to diagnostic events and operation identity for retry; section, selection, paste, task semantic and drag logic are unchanged. Independent review should scrutinize save retry after committed-but-lost response and frontend command retries, because the prior transport created a new ID per retry.
- Legacy JSON is a pre-import backup, not a live mirror; do not switch an old build back to it expecting SQLite edits. Copy an active SQLite database with its supported backup mechanism, not just the main file while WAL is active.
