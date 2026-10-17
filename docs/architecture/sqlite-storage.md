# SQLite data layer — implementation proposal

Status: proposed for Lead / Ratchet review, task #43. Based on Brian's request 45f574bf and Lead's constraints 85c5c603. Implementation branch `feat/sqlite-storage`, based on b2e541f. This does not change the running 3000/3001 environments.

## Boundary and runtime

Keep `WorkspaceRepository.load(): Promise<Workspace>` and `execute(Command): Promise<CommandResult>`. UI and pure `applyCommand` never import SQLite. A server-only factory selects the SQLite adapter; future Supabase must implement the same contract and atomic command boundary. Use Node's built-in `node:sqlite`, Node >=24 (no native npm dependency); set busy_timeout=5000 and WAL, use a connection per operation with guaranteed close.

## Tables

Use normalized entity tables, not one workspace blob. Each has scalar columns corresponding to its entity's scalar fields. Nested data stays in JSON text columns. A `snapshot` column (`current` / `undo`) and compound primary key distinguish current entities from the single previous workspace required by the existing Undo contract. This avoids hiding a second whole-workspace blob in meta.

| Table | Key (after snapshot) | Nested JSON columns |
| --- | --- | --- |
| pages | id | sections, draft, editorBlockMetadata, editorCreations, editorDeletions; editorJSON and editorSections remain their existing strings |
| tasks | id | none |
| placements | taskId + date | none |
| events | id | none |
| materials | id | sources, openedOn, dismissedOn, decisions |
| captures | id | proposals |
| receipts | operationId | none; preserve receipt dictionary key |
| meta | snapshot | schemaVersion, revision, timezone, undo operationId / revision |

All entity tables include an integer position to reconstruct array order exactly. Optional missing values decode as absent, required null values stay null. Unknown fields are rejected during import round-trip rather than silently dropped. Schema versioning for database layout is separate from Workspace.schemaVersion. Foreign-key constraints are not added to source pointers that intentionally survive deletion; application validation remains authoritative.

## Transaction and diff commit

`load` uses one read transaction so entity tables cannot come from mixed revisions. `execute` uses `BEGIN IMMEDIATE`: load current Workspace, call pure applyCommand, compare entity maps by primary key and serialized values, delete removed rows, upsert changed/new rows, then update meta and commit. Revision validation and duplicate-operation fingerprint checks remain in applyCommand inside the transaction. An unchanged replay writes no entity/revision. All failures roll back and leave the adapter usable. Update both current and the existing single Undo snapshot atomically, preserving Undo behavior through restart.

## Import and startup

Default SQLite file: `.daythread-local/workspace.sqlite`; configurable with DAYTHREAD_SQLITE_PATH. Legacy source: DAYTHREAD_LOCAL_DATA_PATH or `.daythread-local/workspace.json`. On first initialization only, if there is no initialized meta row, read and validate the JSON source if present; otherwise create an empty Workspace. Import all entities, receipts, and the Undo snapshot in a single transaction. Assemble the Workspace back from tables and deep-compare with the parsed source before commit. Any mismatch, malformed source, duplicate key, unsupported schema or SQL error aborts initialization. Leave the source JSON untouched as the rollback copy. Later starts use SQLite and never silently reimport or switch to JSON. A configured invalid/unavailable SQLite store fails visibly.

Migration tests use disposable copies, including a copy of Brian's workspace if accessible. No writes to live data. Keep the legacy JSON adapter available solely for contract comparison / migration diagnostics; normal dev and preview run SQLite.

## Debug logs

DAYTHREAD_LOG=debug enables structured one-line JSON on server and client. Server exposes only the enabled boolean to the browser through the existing load transport (not database contents or env values). Operation IDs are created before requests; editor save, retry/conflict, refresh and Undo rejection use that same request ID in logs. Log event, command type, page/task/block ID, before/after revision, elapsed milliseconds, success/replay/error category. Do not log command bodies, titles, URLs, editor JSON, draft text, AI content, receipt messages or arbitrary exception messages. Default off. No editor behavior changes: instrument existing lifecycle points only.

## Verification and handoff

Adapter-independent contract suite: reopen persistence; same operation replay / changed fingerprint rejection; stale revision rejection; concurrent clients / independent-process contention; exception after partial SQL writes rolls back; recovery after failure. SQLite-specific tests: import round-trip (including optional fields, order, receipts, Undo), import only once, invalid import fails closed, source bytes unchanged, database layout rejection. Logs: default-off, debug metadata, same operation ID, no sentinel note text on success or failure. Existing full tests, typecheck, production build and a disposable-app smoke. Review by Ratchet before integration. Brian's editor trial and the existing merge constraint stay separate.
