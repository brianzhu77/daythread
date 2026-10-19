# A8 morning card — independent acceptance

Task #75. **Final candidate 5193991: PASS.** Initial 192d655 had two blockers; both are resolved by the final candidate. Historical findings below are retained as evidence, not live release holds.

## Findings

1. **Flush followed by stale Top3 capacity.** Seed Top3 with two tasks and one suggested task. Type a third task into the empty Top3 editor row, immediately click suggested +. Real browser interaction persists four Top3 tasks and says Added to TODO - Top3. The flush succeeds, but the closure uses the pre-flush page and single plan-task lacks execution-time overflow protection. Evidence flush-top3.mjs/log/png. Lead51b3c990 accepted: server decides destination and response supplies actual destination/count wording. Add all must also use post-flush results.
2. **Done bypasses failed editor flush.** On a real-data copy, block save-editor, type, click Done. Persisted handoffDone becomes true, card disappears, new text is not saved. Source shows Done calling run directly, unlike guarded adds. Evidence real-browser.mjs/log/done-save-failure.png. Reported45f83589; all page-writing card controls need the same save gate.

Design followups from Jazz985b009b / Leadd42e6c30: add task before trailing empty task row (both destinations, single and bulk, shared placement callers checked); reduce mc-group padding. Product/Jazz require ONE bulk Undo strip rather than misleading per-row bulk Undo (spec446d101).

## Independently passed

- Full initial suite201 total,197 pass,4 TODO,0 fail.
- Actual SQLite Bring of #family and a GoodStuffs URL passes same editor-save pipeline: tag occurrence on today, same Material with a second source, source page unchanged. Delete brought text using save-editor: strict source dedup survives.
- Candidate→old960d5d4 repository load + actual old save-editor append→candidate reload: deleted-copy source marker retained, still not offered, materials/source records/tasks unchanged. No new column/migration, no rollback script required for this implementation. Evidence rollback.mjs/log.
- Real-data-copy actual Bring then strip Undo restores prior state. Bring again, type new words and click Undo: save flushes, Undo refuses inline, copy and later words both remain. Evidence real-browser.mjs/log/real-undo390.png. Only copied database was changed; model disabled and isolated cacheDir used.

No release acceptance yet. Next candidate must recheck capacity and actual returned wording, insertion position, failed Done/other page-writing actions, bulk one-strip Undo, and principal screenshots on a clean real-data copy. Real iPhone/IME unverified. No paid calls, production writes or deployment by reviewer.

## Final followup — 5193991

- Independently reran full suite: 204 total, 200 pass, 4 TODO, zero failures (followup-suite.log).
- Actual browser plus SQLite: type third Top3 task and immediately add suggestion; exactly three Top3 tasks remain, suggestion goes to Other, feedback names Other. Inserted task precedes the trailing empty row. Bulk addition produces one strip; its Undo restores both original task arrangements (followup-capacity.mjs/log). Early harness assertions incorrectly excluded real editor-task IDs and assumed an original null date; corrected assertions then passed on a fresh fixture.
- Abort only save-editor requests, type, click Done: handoffDone stays false, card and unsaved words remain. Restore requests and retry Done: words persist before card closes (followup-done.mjs/log/png). Source review confirms the same guarded write entry point covers the remaining writing controls.
- Clean read-only backup of Brian's real database, with only the copied morning-card flag reset: captured and visually inspected Pages, Today, Oct18, Tasks, Calendar, Tags and Review at 1280 and 390 pixels (14 screenshots, real-copy/). Both recipe pages remain visible on Pages with their date; no false empty screen, visible error boundary, page error or provider request. Yesterday lines remain collapsed initially.
- Earlier Bring/tag/material, guarded Undo and old-version save/reopen evidence remains valid: final source adds no storage change. These unchanged cases were not rerun merely to repeat passing checks.

Reviewer found no remaining release blocker within A8 steps 1–2. Chrome viewport checks do not verify physical iPhone keyboards or real Chinese IME behavior. No paid calls, production database writes or reviewer deployment. Lead owns release and live verification.
