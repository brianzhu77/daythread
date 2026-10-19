# Model Step 1(b), independent review task #69

Final candidate **25dc72a: PASS for Step 1(b)**. Original 7116c33 blockers below are closed by supplements. No paid model calls or production writes.

Confirmed: valid JSON containing task.title=23 crashes grounding with TypeError after a paid response; capture remains organizing and ledger reserved despite a known cost. HTTP500 with explicit generation ID and usage.cost=0.002 is forced to settled actual=0 and a false no-charge note. boundaries.mjs/log reproduces both against isolated real SQLite stores.

The capture action has no captured-at field, and organizeCapture uses its current clock as capturedAt. This violates the original relative-date contract on delayed processing/retry across midnight. Lead 99d98c1f accepted all three as blockers and requested followups in the still-unreleased layout3 migration.

Independently passed on this candidate:
- Actual HTTP server-function requests using a full command envelope reject all six internal operations. Same envelope succeeds for a valid ensure-day command. Each rejected request leaves workspace metadata, captures and ledger unchanged; transport status200 wraps a schema error, so status alone was not used as success.
- Concurrent organize calls for the same capture revision send exactly one fake provider request and settle its cost once.
- Real SQLite + controlled delayed provider: discard during flight preserves original text, settles cost, applies nothing; normal auto flow saves the grounded task with its date, holds the invented event and preserves text.
- Server-side synthetic env file loads only model/mode keys, with process-env precedence; no credentials printed/copied.
- Actual process restart plus browser HTTP load converts a prepared reserved attempt to unknown and reports model paused. No API-key field in returned model status.
- Independent full suite: 140 passed, 4 TODO, no failure/skip (144 total).

Evidence: tests/evidence/model-organize-69/. Runtime fake server used3280/provider3298 and private /tmp/ratchet-organize69-browser.sqlite. Neither production data nor real provider credentials were used. Receipt UI and same-capture retry controls are (c), not passed here. One-hop context was explicitly deferred by Lead to Step2; it is not silently counted as implemented in this review.

## 94a5721 / 4527871 supplement

All original blockers pass independent supplementary checks: wrong field types are rejected per item without crashing; all-bad or non-list responses fail visibly and settle reported cost; a partial response saves only the valid item and records the rejected count. A task's invalid dateRole is normalized to null and held for review. HTTP500 with usage preserves both cost and generation ID; 500 without usage, including generation-only responses, stays unknown under this version's rule; 401 without usage is zero under the explicit Lead policy, while 401 with reported cost preserves that cost.

A capture written Sunday23:59 and organized Monday09:00 sends Sunday23:59 as model date context, while the budget day is Monday; capturedAt survives SQLite reload. The updated rollback removes capturedAt/model/mode coherently, old c8fb28a repository reads the original text and failed status, and forward preserves every unknown ledger row. Emergency rollback intentionally loses capturedAt and is not claimed as preserving future relative-date semantics.

Concurrent single-send and discard-during-flight paths pass again. Independent full suite: 146 passed, 4 TODO, no failures/skips. Source and scripts match4527871 (94a5721 code plus fake-provider switches). Initial actual HTTP rejection, env and startup-recovery checks carry forward; runtime boundary source unchanged.

Lead subsequently changed the error-accounting contract to a nonblocking estimated ledger state (message18363844). This version does not implement that new rule, so final #69 acceptance remains pending the next candidate's estimated-path and roundtrip checks. No receipt UI or paid provider acceptance is implied.

## Final25dc72a: estimated accounting passes

Actual orchestration against a fake HTTP500/no-usage response leaves actualUsd and settledAt empty, sets estimated, counts the reservation in today's spend, and does not pause. The next capture sends a provider request and saves normally. Reconciling the estimate to a reported cost changes only the ledger: the complete workspace is unchanged and no task is duplicated; a settled attempt cannot be reconciled again.

Settled, estimated and generation-backed unknown rows survive downgrade, old c8fb28a repository load and forward byte-for-byte. An unknown row cannot be unpaused by subsequently omitting its generation ID. A9.8 estimate plus0.3 reservation is rejected against the10 cap. These are executed assertions in estimated.mjs/log, not inferred from author tests. Final full suite:148 passed,4 TODO, no failures/skips (152 total). The earlier runtime-validation, capturedAt, HTTP-boundary and concurrency results carry forward.

No paid calls, production writes or active reviewer servers. Receipt UI/same-capture Retry and generation-cost lookup remain separate work. The capturedAt emergency-rollback loss is a documented limitation; it does not invalidate normal persisted capture-time semantics.
