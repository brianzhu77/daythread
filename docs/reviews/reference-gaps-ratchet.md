# Independent reference gaps review

Candidate 8fa880fb: changes requested. Changing a populated Number property to a Relation retains the raw number. `referencesTo` calls `.includes` on that value and throws. Reproduction uses ordinary commands: create two databases, add Number property, add row with 42, change property to Relation, open a target row. Built Chromium and WebKit both show “Something went wrong!”. Domain repro: tests/evidence/ratchet-reference-gaps/typed.ts; browser repro: crash.mjs and invalid.ts. This is a page-opening failure, not data loss.

Independent domain checks: a valid one-way reference is live, becomes removed when its source row is trashed, and disappears when its property is removed. Author gaps.mjs rerun independently in Chromium and WebKit covers ordinary one-way/two-way, linked-view/home exclusion, removed sources last, and no-reference pages at 1280/390. Build and typecheck passed; 718 unit tests passed, 5 skipped. No Worker, real Postgres, phone or performance run.

Fix retest follows below.
