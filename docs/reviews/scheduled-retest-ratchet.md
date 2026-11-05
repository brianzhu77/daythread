# PR163 retest at 377abec8

Not clear: automatic resume by saving a failed rule's fix retains the old counts-from boundary.

Daily 09:00 rule fails on Nov5 and pauses. At Nov6 noon edit only its invalid steps to valid Add row and save, supplying repeat.notBefore Nov6T12:00 as the editor does. updateAutomation turns the paused rule on but sameSchedule restores its old Nov2 boundary. Tick Nov6 12:05 creates a row for Nov6 09:00. Expected: no catch-up for the time passed while paused; next run Nov7 09:00. Preserve the old boundary on a plain rename, but not when the update resumes a paused rule.

The original same-day test now expects one run, following the revised once-per-date policy. It passes; it is no longer a defect claim. The independent partial-copy rollback test also passes unchanged. Author's 16 tests pass. Combined: 18 pass, one failed-rule-resume failure.

Run node --test tests/ratchet-scheduled.test.ts tests/automations.test.ts. Synthetic in-memory only. No independent Worker, real Postgres, browser, native or rollback run. No release heads changed.
