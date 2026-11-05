# Independent to-do dependency design review

Reviewed todo-dependency.md at main 9178337d and current task identity/storage/Planned paths. Design only; no feature exists and no execution was performed. Recommend approval after the following contracts are written down.

## 1. Link tasks, not their lines; define Trash by canonical visibility

B22 copies are additional lines for the same task. Removing one occurrence must not remove its dependencies while another occurrence remains. sourcePageId is provenance, not proof that a task is no longer live: a reference or plan line can remain elsewhere after the source goes to Trash. Define “in Trash stops blocking” as no eligible live occurrence of the task (including inherited page Trash), rather than any one occurrence or source page being trashed. A restored occurrence reactivates the same canonical link. Test original trashed plus live copied line, last live occurrence trashed, then restore a different occurrence first.

The picker must write task IDs and exclude deleted/wholly-trashed tasks for new edges. A blocker link opens an existing live task occurrence using the same preferred-row resolver as Tasks, not a saved DOM/block ID that becomes stale after moving Planned. A done dependent may still retain links, and reopening the dependent simply recalculates its mark.

## 2. No date movement is sound; keep the command outside database dependency shifting

The new link command should only write the canonical graph. Do not route it through ordinary database dependency propagation, whose purpose is to move date ranges. Planned is derived from live plan lines, not a task column. Link/unlink, completion, cancellation, pause, Trash and restore must not write attentionOn/deadlineOn, move plan/reference lines, or change page documents. The requested tick remains allowed with one normal Undo and no confirmation, even while blocked.

Acceptance: snapshot task dates and page documents; add/remove links and toggle every blocker state, including a blocker whose ordinary database relation has date-shifting configured elsewhere. Only the intended status or link changes. Marks update on all B22 occurrences without an editor save. Measure actual tick latency with links; do not count an unloaded mark as evidence of unchanged behavior.

## 3. Cycle and inverse checks must cover inactive edges too

Check cycles atomically under the workspace lock after staging the complete proposed graph. Include paused/done/cancelled and wholly-trashed blockers in graph validation even when they currently do not block, so reopening/restoring one cannot activate a cycle accepted while it was hidden. Simultaneous A blocked by B and B blocked by A must accept at most one.

Deletion/Undo must not restore an old adjacency list over newer edits. A link operation needs an expected graph/list version (or equivalent inverse guards), not merely a stale visible row title. A restore that would conflict with later graph edits must refuse or explicitly reconcile; it may not silently overwrite or create a cycle. Test both an incoming and outgoing edge on the deleted task, another tab editing the survivor, and Undo/restore after that edit.

## 4. A plain optional Task field does not survive today's storage boundary

TaskRow/taskOf enumerate fixed fields. Adding blockedBy only to the in-memory Task interface would drop it on a normal round trip. An older build also deletes/restores task rows without knowing a new field. A new SQL column is preserved by old UPDATE statements only if those statements never rewrite it; DELETE plus old Undo can still lose it.

Prefer an independently preserved edge store, with missing endpoints making retained edges inactive, or an equally explicit preservation mechanism. Do not cascade-delete that protected store from an old build's task DELETE unless the old inverse can recover it. Current commands may remove edges visibly, but old deletion/restore must have a defined retained/inactive lifecycle. Store one direction and derive Blocking, as proposed; ensure every load and Undo path preserves unknown data.

Required floor fixture: create A→B and C→A on current; old floor edits/ticks/plans A, deletes its last line and undoes that deletion; return current and verify exact edges, dates and surviving newer edits. Exercise real Postgres, including actual floor writes, before claiming rollback safety. This design review has not run it.

## Secondary acceptance details

- Deduplicate repeated IDs; bound blockers per task and total edges; refuse the entire over-limit operation rather than linking a prefix. Name the limits after measuring.
- “Blocked by 2” should count currently active blockers, not all retained links, so done/cancelled edges don't inflate it.
- Do not remove or reorder tasks based on the mark. Cancelled and done blockers unblock; paused blockers still block as specified. A failed link/tick leaves the graph and status unchanged.
- Templates/Make a copy allocate fresh task identities without edges. B22 ordinary copied lines keep identity/edges. Export reads canonical titles as text; the day draft receives no graph/provenance fields.

No user request or empirical need is inferred from this review. Scope/order remain Lead's decision; these contracts make the proposed behavior testable before building.
