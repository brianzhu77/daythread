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


## Followup ad69333 — PASS (2026-10-19)

All six blocking findings above are closed for this candidate. Independent checks:
- `followup-domain.mjs`: saved task/event/note edits retain entity and block IDs; edited/deleted/moved note, changed event date and deleted task row each refuse whole Undo without mutating the input workspace. Original identity-undo reproduction also now refuses edited-note undo and preserves taskId.
- `followup-paused-http.log`: actual browser-origin HTTP retry returned ok:false / model paused; capture before and after are identical (revision remains 2 from the previous reproduction), with no provider running. This is the actual endpoint check, not only a service unit test.
- `followup-ui.mjs/log`: Chromium390 event No time clears invented14:00 and its warning while retaining Tomorrow; Set time15:00 works; waiting Tax Return update changes Do→Due and day→Oct22 before Apply. Database verification found deadlineOn2026-10-22 and plannedOn null. Menu bounds fit390; desktop1280 and phone390 screenshots saved; no page errors. Phone row title now reads naturally in the row.
- Full suite:166 total,162 pass,4 TODO,0 fail. Source review confirms the Retry guard runs before repository mutation and Undo operates on a copy.

Earlier controlled-provider same-capture Retry and capturedAt midnight-fixture evidence remains applicable; its code path was not changed by these fixes. Exploratory original browser.log remains excluded from pass evidence. Real iPhone/Chinese IME and real-provider quality are not verified here. No paid calls or production writes were made. Jazz retains ownership of the full visual checklist; Lead/Roadbuster owns the separately authorized one-shot smoke and deployment.

## Final refusal UI followup 32b50c1 — PASS

Independent actual Chromium390 interaction (`refusal-ui.mjs/log`): task changed via Tasks UI, then receipt Undo all clicked. Exact inline “Can't undo · edited since” appeared; no Not saved banner or Retry; persisted task and page arrays were identical before/after refusal. A subsequent deliberately aborted command request produced the genuine Not saved + Retry path and preserved persisted tasks. No page errors. Screenshot refusal390.png. Initial harness used the wrong role for the Upcoming link and checkbox check expected synchronous state; corrected harness uses link and click. Those harness failures are not product findings. Prior six-fix functional evidence remains valid (53b790a corresponds to reviewed ad69333); Jazz owns ordering and full visual coverage. No real-provider calls or production writes.
