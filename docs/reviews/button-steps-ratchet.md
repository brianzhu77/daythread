# PR155 independent command/retry review

Candidate 68b8dcfa. Request: command and retry paths against Buttons §4. Not cleared: three reproduced contract failures.

## Confirmed findings

1. **A broken Open page target does not prevent preceding stored changes.** Store Add row followed by Open page with a missing target (the same state reached by deleting its target after configuration), then execute run-button. Expected: refusal with no changes. Actual: Runs has three rows instead of two, successful receipt. The server preflight only checks database/set targets; the browser discovers missing Open targets after committing. Validate page existence/Trash and the whole supported step list before running stored steps. Popup failure after commit remains the separately accepted behavior.
2. **To-dos can partially succeed inside an all-or-none button.** Configure Add row then Edit all To-dos Planned to Nov 7. Seed one done task and one open task. run-button commits the added row and the open task's move, returning `1 to-do changed · 1 couldn't`. The reused edit-todos command deliberately permits partial success for the bulk bar. A button needs strict validation/execution so a refused task causes the whole button copy to be discarded; preserve the bulk bar's existing behavior.
3. **Inserted tasks bypass the aggregate task limit.** Insert 501 checklist lines in one step. run-button creates all 501 tasks successfully. Insert calls createTask without spending the shared todos allowance. Count tasks from all insert steps together with Add row and Edit rows; over-limit must leave no changes.

`tests/ratchet-buttons.test.ts` preserves all three failing assertions. Each runs only against the pure disposable harness, with no network or user data.

## Passing evidence and source review

- Author's 11 Buttons unit tests pass. Build passes.
- Independent same-operation replay after an intervening rename returns the original row id and leaves row count and revision unchanged.
- Source reviewed: runButton, step reading/keying/value conversion, command schema, UI send/refusal/confirmation/open path, flush registration and page-editor merge additions, underlying todoChange/edit-todos behavior. Repo applyCommand checks an existing receipt before re-evaluating current state; Postgres stores diff/receipt/inverse under its workspace lock/transaction. This review does not independently execute that path on Postgres.
- UI auto-retry for Saved elsewhere keeps the same action and operation id. Navigation follows successful commit. Generic failed-request retry retains action/id in use-day. No claim of independent browser verification.

## Limits

No browser, Worker, real Postgres, Simulator, physical phone, actual lost-network-reply or performance run by me. The author's remaining synced/template/To-dos browser/native cases remain theirs. No application changes made. PR155 depends on the inert block/floor release PR152; this review does not authorize release.

Reproduce: `node --test tests/ratchet-buttons.test.ts` (three fail, replay passes on this candidate); `node --test tests/buttons.test.ts` (11 pass).
