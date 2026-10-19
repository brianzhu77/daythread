# Model Step1(c): independent review task #70

Candidate d242e2f: **changes required**. No paid model calls or production writes.

## Independently reproduced blockers

- Undo all after editing a capture-created note via legitimate edit-block succeeds and deletes the new writing, instead of refusing the whole capture. Task version checks alone do not protect note/block/event/material edits. identity-undo.mjs/log.
- Editing only a saved task's title replaces its taskId. Ordinary field edits should preserve task identity; type conversion is the intentional replacement path. Same reproduction logs before/after task IDs.
- The actual held Swim class row has title/type/day controls but no way to clear its invented time. The date menu contains only Day options. inspect-ui.mjs/log.
- Update rows have only Apply/Discard, so the promised do/start/due and date corrections before Apply are unavailable.
- With model globally paused by a different capture, a direct real retryCapture HTTP call on an old ordinary failure returns ok:true and increments its revision before becoming paused. No new paid call occurs, but the service should refuse before mutation. paused-http.mjs/log. The initial exploratory request used padded base64 and was rejected as an invalid function ID; the final recorded request uses the actual base64url protocol and exercises the handler.

Jazz separately found the phone row layout issue and supplied CSS fix379c977. Lead accepted all six fixes, including the layout issue, for one followup candidate. This review has not independently accepted that unintegrated fix.

## Independently passed

Actual390 browser flow with a controlled local provider: one capture fails, user clicks Retry, same captureId/text persists, proposalRevision becomes2, exactly two model attempts and one created task. With an explicitly synthetic persisted Sunday23:59 capturedAt, the real server request on retry sends Sunday context and creates a Monday task. Provider log records the context; no browser page errors. The synthetic timestamp is fixture data, not a claim of waiting across a real midnight.

Seven-item fixture renders at1280/390; phone has no page-width overflow. Behavioural date-menu inspection was performed on the actual UI. Visual acceptance belongs to Jazz. The first exploratory browser.log contains interleaved output from an earlier timed-out harness and is not used as pass evidence; inspect-ui and retry-browser are the meaningful traces.

Full suite independently run:156 passed,4 TODO,no failures/skips (160 total). Ledger invariance for new edit/save/remove/undo commands and finalized ordinary-field identity/undo refusal await the fix candidate. Receipt UI pass does not yet exist.

Evidence:tests/evidence/model-receipt-70/. Isolated databases /tmp/ratchet-receipt70.sqlite and /tmp/ratchet-receipt70-retry.sqlite. Test provider keys are synthetic. No real iPhone/IME validation.
