# /page Step A independent review

Candidate: feat/page-slash c8fb28a. Review task #64. Result: **PASS for Step A**. Earlier 6140716 results below carry forward except the fixed defect.

## Defect closed on c8fb28a

While create-document is pending, a single Cmd+Z does not remove the newly inserted page card. When the successful reply arrives, the child still opens. This violates the accepted pending Undo cancellation behavior (Lead 82e945d7).

Reproduced twice in Chromium using actual keyboard input with editor focus. The request reaches the server, but its successful reply is delayed 1000ms; after the spinner appears, wait 200ms then Cmd+Z. At 100ms after Undo the parent still contains one card; after the reply the URL changes to the child with focus=title. See pending-undo.mjs, pending-undo-debug.log. No claim that the cancellation guard itself fails: the card was never removed by the single Undo.

## Independent checks passed

- Lost create reply after server commit: retries recover the same child without duplication and open it. Three failed attempts retain a Retry card; reconnect and retry creates exactly one child.
- Corrected downgrade on an actual layout-2 child/card database: old 7f0de2d browser opens the downgraded day without crashing. Cards become paragraph links; parent hierarchy is intentionally lost. Unsaved tab-local drafts are outside this conversion.
- Layout-1 populated fixture migrates with full original workspace equality, preserving task and placement facts; child parentId persists and repeated creation with same child ID does not duplicate it.
- Native card drag preserves card/target identity; single Undo restores original block order. Delete leaves child intact; Undo restores same card and refresh preserves it.
- 1280/390 long pages: browser Back and in-app return bring source card into viewport. Child background white, no horizontal overflow.
- Title save failure and explicit Retry, Esc, empty title, Enter to body and first-line Backspace to title passed on 630054a; corresponding behavior retained in candidate.
- Candidate suite: 112 passed, 4 TODO, no failures (116 total).

Evidence: tests/evidence/page-slash-64/. Real iPhone, Safari and real IME unverified. Step B hierarchy/list/move/delete is outside this acceptance.

## c8fb28a independent supplement

The original pending-undo.mjs now passes unchanged: after one Cmd+Z, 0 cards at 100ms, parent URL retained after delayed success, exactly one child remains server-side, and no browser errors. See pending-undo-c8fb28a.log. The parent persisted an empty paragraph, so the card was actually removed rather than hidden by navigation.

Lost response recovery and three-failures plus explicit Retry passed again (recovery-c8fb28a.mjs/log). Fast Home + ten ArrowLeft + Backspace with no pause now focuses the title on an empty document's first body line. Title explicit save retry, Esc and empty title also passed (title-retry-c8fb28a.mjs/log). The first attempt of this supplementary title harness selected a document whose first block was already a page card; that fixture was inappropriate for the first-text-line keyboard assertion, so the final harness explicitly selects an empty document.

Source/scripts/dependencies in the QA worktree match c8fb28a. No production writes. Lead owns deployment under the standing authorization.
