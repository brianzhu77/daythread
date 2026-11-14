# B98 outbox contract independent review

**Approved for implementation at design/outbox e1c37bef**, November 14, 2026. This is contract approval; no outbox implementation or migration has been validated or authorized for release by this review.

I read the contract and its revisions against the current use-day command queue, browser workspace stripping, command/domain application, row write planner, IndexedDB offline-copy transaction pattern and Postgres operation retention. The following findings were incorporated before approval:

- Authenticate the recorded owner on the server before executing, including a stale account-A tab after another tab signs into B.
- Preserve the captured basis on the first send as well as replay; refreshing while queued must not bypass a newer conflicting edit.
- Use a separate runOutboxCommand function that an old server rejects. A capability returned at load time cannot protect a request after rollback.
- Bound unknown operation identity after receipts are forgotten. Postgres age pruning and SQLite/domain compaction both update the forgetting watermark atomically.
- Atomically delete acknowledged entries and propagate their receipt revisions to dependants. A lost reply must recover the same revision; a kill cannot split the bookkeeping.
- Record read/reference dependencies as well as predicted writes. Buttons, template adds and rule-firing changes are conservative; their captured classification can only strengthen. A held database creation blocks a row add referencing it while an unrelated tick can proceed.
- Explicitly handle Undo without predicting a stripped undo.before. Later entries made while Undo is pending are conservative too.

Independent executable evidence: tests/evidence/outbox/ratchet-read-dependency.ts passes two probes against the existing domain:

1. The identical row-button action copies 1 or 9 after a source value changes, but never writes the source row. Write-set intersection alone cannot detect this dependency.
2. Adding a row to a newly created database writes the child row but not the parent database row. Referenced ids are necessary to hold that dependant.

Run: `node tests/evidence/outbox/ratchet-read-dependency.ts`.

Implementation review must establish the specified transaction completion, dependency ordering across tabs and reloads, deterministic generated identities, row/version tracking, recovery UX and receipt semantics with actual code and failure injection. In particular, normal IndexedDB request success alone must not be reported as durable before transaction completion. The migration rehearsal, old-tab/new-server and new/floor/new gates remain required.

Accepted practical limits are explicit: complex read-dependent actions may conflict after unrelated writes; coarse per-row tracking can conflict across different cells in one row; unavailable storage falls back to today's in-memory behavior with a warning; rollback can keep changes unsent; no service-worker sending or Background Sync. Worker-disconnect evidence is the author's local workerd experiment, not a production guarantee. The design must remain independent of whether a disconnected request finishes.

No runtime source, production data, schema or deployment was changed by this review.
