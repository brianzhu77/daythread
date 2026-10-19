# Model Step 1(a): independent review, task #68

Final candidate **33e1d38: PASS for storage/budget Step 1(a)**. The original 33886ba and intermediate 1529de4 defects below are closed by independent supplements. No network model calls or production writes were made.

## Confirmed defects

1. After one recordModelResult creates task A, another call with the same attemptId, cost and generationId but a new operationId/business command creates task B. The database has one settled financial record and two tasks. settleAttempt only makes the monetary settlement idempotent; recordModelResult still executes the new command. Bind the full result/command identity and first receipt to the attempt; replay identical results without execution; refuse different ones. Evidence: idempotence.mjs/log.
2. reserveModelAttempt accepts the same attempt ID/day/amount with a different captureId, revision and model, returning the original row. Compare complete request identity, including a hash of the model request. The same reproduction records the accepted changed reservation.

Lead d25b6c28 accepted both as blockers to fix in a followup commit. This review does not claim the unwired orchestrator or UI is already vulnerable; the repository contract in (a) is incorrect before those are wired.

## Independently passed

- Actual cross-process reserve race on one SQLite file: exactly one accepted reservation and one rejection.
- Injected failure after settlement and workspace write rolls both back, restoring the complete populated workspace and reserved financial state.
- Successful settlement plus workspace write commits; whole-snapshot Undo preserves every model_attempts field.
- A SQLite trigger aborting a subsequent workspace save preserves both complete workspace and financial rows.
- A populated fixture with settled and unknown rows: downgrade 3→2 keeps all financial rows. Old c8fb28a repository loads the complete workspace; an actual old-code browser opens day, Tasks and Pages without page errors. Forward to layout3 preserves each financial row and the unknown attempt still blocks a new reservation. No budget reset.
- Candidate full suite independently run with FUTURE_DAYS_CONTRACT=1: 123 passed, 4 TODO, no failed or skipped tests.

Evidence: tests/evidence/model-ledger-68/. The old browser server on 3271 was stopped after verification. /tmp/ratchet-ledger68-roundtrip.sqlite is an isolated synthetic fixture, not Brian's database. Server startup wiring, browser command boundary runtime attacks, real provider calls and UI are (b)/(c), not accepted by this (a) review.

## 1529de4 supplement

Original complete-reservation and differing-business-result defects now pass independent assertions, including identical result with a new operationId replaying the first receipt. **New blocker:** recordModelResult(actualUsd=null, generationId=null, no command) marks timeout unknown but also binds a final result fingerprint. A later real charge and command for the same attempt is rejected as a different result; the transaction rolls back the known settlement and leaves the attempt unknown. This conflicts with the accepted late-result settlement path. Evidence: fixed-identity.mjs/log. Absence of a result must not be bound as a completed immutable result.

## Final 33e1d38 supplement: PASS

Independent fixed-identity.mjs now passes: timeout with no cost/result binds nothing; late real result settles/applies once; a changed late result is refused. A real business result with missing cost stays unknown and blocks another reserve, then the same result with known cost replays the original receipt without changing the workspace. A later conflicting cost is refused. Original complete-request identity and result replay assertions also pass.

The new three-column ledger shape was independently rechecked on a fresh fixture: cross-process reserve race, injected atomic failure, Undo, failed workspace save, downgrade, actual old c8fb28a repository load and forward all pass; every raw ledger row and unknown blocking state survive. The earlier actual old-browser day/Tasks/Pages check on 33886ba carries forward; it was not repeated on the new shape. Final suite: 128 passed, 4 TODO, zero failed/skipped (132 total). No paid calls or production writes. This pass does not cover unwired orchestration/UI in (b)/(c).
