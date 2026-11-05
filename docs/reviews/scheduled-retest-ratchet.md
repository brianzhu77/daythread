# PR163 retest at 377abec8

Not clear: automatic resume by saving a failed rule's fix retains the old counts-from boundary.

Daily 09:00 rule fails on Nov5 and pauses. At Nov6 noon edit only its invalid steps to valid Add row and save, supplying repeat.notBefore Nov6T12:00 as the editor does. updateAutomation turns the paused rule on but sameSchedule restores its old Nov2 boundary. Tick Nov6 12:05 creates a row for Nov6 09:00. Expected: no catch-up for the time passed while paused; next run Nov7 09:00. Preserve the old boundary on a plain rename, but not when the update resumes a paused rule.

The original same-day test now expects one run, following the revised once-per-date policy. It passes; it is no longer a defect claim. The independent partial-copy rollback test also passes unchanged. Author's 16 tests pass. Combined: 18 pass, one failed-rule-resume failure.

Run node --test tests/ratchet-scheduled.test.ts tests/automations.test.ts. Synthetic in-memory only. No independent Worker, real Postgres, browser, native or rollback run. No release heads changed.

## Contract update and further execution

Lead 386fe2a2 explicitly accepts latest-period recovery after fixing a failed rule with an unchanged schedule; Product recorded it at 4eda21d3. This supersedes the failed-resume expected-zero assertion above. The fixture now expects one recovery and no second run on another tick. Added independent cases verify an actual schedule change during a fix counts from save, and a failed rule explicitly switched off stays off when fixed; switching it back on suppresses old periods. An old 11:00 tick after a noon boundary does nothing; the following date runs normally. All four independent fixtures and 16 author tests pass (20 total).

The domain marker/copy path is clear for the revised contract on 377abec8. The editor Next line still needs to predict failure recovery; Roadbuster said that update would follow Lead's decision. No UI clearance is claimed here.
