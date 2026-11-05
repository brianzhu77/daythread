# Independent reference gaps review

Candidate 8fa880fb: changes requested. Changing a populated Number property to a Relation retains the raw number. `referencesTo` calls `.includes` on that value and throws. Reproduction uses ordinary commands: create two databases, add Number property, add row with 42, change property to Relation, open a target row. Built Chromium and WebKit both show “Something went wrong!”. Domain repro: tests/evidence/ratchet-reference-gaps/typed.ts; browser repro: crash.mjs and invalid.ts. This is a page-opening failure, not data loss.

Independent domain checks: a valid one-way reference is live, becomes removed when its source row is trashed, and disappears when its property is removed. Author gaps.mjs rerun independently in Chromium and WebKit covers ordinary one-way/two-way, linked-view/home exclusion, removed sources last, and no-reference pages at 1280/390. Build and typecheck passed; 718 unit tests passed, 5 skipped. No Worker, real Postgres, phone or performance run.

Fix retest follows below.

## Fix retest, candidate 5537a664

The retained-number domain reproduction now returns no references. After rebuilding and restarting the preview (required because the initial post-build preview retained stale SSR assets and stayed on Loading pages), the original built-page reproduction opens Ann normally in Chromium and WebKit with no page errors. `fixed-crash-*.log` records the resulting page. Own `target.ts` additionally verifies a changed relation target drops the retained old id, linked views count live sources, and a trashed linked source is marked removed safely even when its target is later trashed. Those domain checks pass. The original crash is cleared on 5537a664. No independent fixed-head full unit or Worker repeat; the original baseline totals above remain for 8fa880fb.
