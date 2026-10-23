# B33 task164 — FINAL PASS at fd6f4df

Independent review. No real-row writes, cleanup or production service changes.

## Final recheck

**Both findings fixed at fd6f4df.** Inspected the full delta. Save and notice share deletesWithLine, including other-page rows and remaining same-page rows; semantic deletion no longer unplans a task whose other row remains today. The stash stores cutTaskIds and reload initializes the cut set from it.

Independent executed checks:
- Actual browser cross-page notice reads Removed from today/still in Doc, task survives; same-page duplicate removal shows no deletion notice and task stays planned. Author notice-check rerun passes all4 assertions.
- Own failure-injection cut recovery on a completed task now passes: failed POST save, network restore/reload, same task id and done state survive; stash contains cutTaskIds.
- Additional independent conflict path passes: after failed cut, a second repository changes the source; reload and Load latest preserve the original done task. Tests actual delayed save/recovery, not only domain calls.
- Fresh real-day replay again9pass1fail: only known B35 shared-tab recovery stays red. B33 typed-clear-delete, task cut identity and history retention pass.
- Eight focused born-here domain tests pass; current build/typecheck pass. Full385-test baseline remains evidence for unchanged areas; author's final386 full-suite result is attributed, not newly rerun by reviewer.

Earlier reference-notice.ts intentionally models the old bornHere-only client and remains historical reproduction, not a test of the fixed shared helper. Initial exploratory nested-handle probe never selected a valid block and is not counted as a product defect or coverage.

No current B33 blocker remains. Lead owns authenticated rollback/alignment, current-row cleanup allowlist and deployment. No real cleanup was performed here.

## Earlier revision findings at bea6744

1. **False deletion notice with another reference row.** Actual domain execution creates today's born-here task and a reference row on a document, then deletes today's row. `bornHere` is true, so client `goesWithLine` predicts `To-do deleted`, but server correctly retains task due the other row and unplans it. Domain proof in reference-notice.ts; actual browser notice is inferred directly from the client branch, not claimed observed. Same-page duplicate rows need the same full decision. Reporte7a59999; Lead18c83a72 requires correction before release.
2. **Offline cut loses its protection on draft recovery and deletes the task.** Actual browser execution on a new done task: block all save POSTs, select whole task block with handle and cut, verify original task still on server, restore network and reload source. Recovered document saves automatically without `cutTaskIds` because stash contains base/document only and cutTasks ref is reinitialized empty. Original task id is now gone. `cut-recovery.mjs` + output reproduce it. This violates cut-is-move even without pasting; fix recovery semantics including reload/Load latest. Report067be3eb.

Independent full suite385pass0fail11skip4todo(400total), production build/typecheck pass. Real-day replay bba64b3 executed against this candidate:9pass1fail; B33 typed-a/clear/delete passes, whole task cut/paste id+done survives successful saves, historical row deletion keeps task and unplans. Remaining replay red is prior B35 shared-tab recovery, not a new B33 defect. That passing cut test is not evidence for failed-save/recovery cut.

Copied tests/evidence/ratchet-real-day/{seed.ts,replay.mjs} are execution helpers from bba64b3, not application changes. Need fresh fixture before repeating because cut recovery mutated the old synthetic store. Stop owned server after evidence capture. Await new candidate for targeted recheck; prior unchanged-domain evidence can carry according to diff.
