# PR120 independent retest

Candidate `e02d9791`. Ratchet, 2026-11-04. Invented local SQLite stores only; production build, authentication off, ports 3698 and 3699.

**Changes requested.** The original pending-save Undo failure is fixed in the independently replayed script, but the pending action lock has no visible feedback. Closing a peek during a pending Unsync still produces an unhandled destroyed-editor error.

## Requested changes

1. Hold Unsync's POST, then click below the shared block and send keys. The whole editor has `contenteditable=false`, `aria-busy=true`, and `pointer-events:none`, but the page has no visible waiting state. The keys do not appear; releasing the request unlocks it. Screenshots and `lock.mjs` capture this in both engines. Keep the lock and show a visible pending action state. Product's follow-up requests action-only text and dimming after roughly 400 ms, at both widths, with recovery after success and failure.
2. In a center peek containing a synced block, hold Unsync's POST, close the peek, type on the page behind, release. The host words save, but the reply throws `[tiptap error]: The editor view is not available. Cannot access view['dom']`. `onServer` still calls `applyServerPage` after the editor has left. Its visual mutations and unlock path need to tolerate closure. `close-action.mjs` reproduces it in Chromium and WebKit. This is an error claim, not demonstrated word loss.

## Evidence and scope

Build and typecheck passed. Local suite: 704 passed, 0 failed, 5 skipped. The independently replayed original pending-save Undo script passes in Chromium and WebKit: the undone suffix remains absent in the UI and shared record.

The author race suite passes in Chromium and WebKit, including the new conflicted-reply merge that keeps typing done during the held save. Its action-lock test catches a click timeout before `keyboard.type`, so the original script does not actually send those keys while locked; the independent `lock.mjs` force-clicks and sends keys instead.

The author held-save closing test passes in Chromium and WebKit: both sets of words survive without a runtime error. This fixes the original save callback lifecycle report, but does not cover the remaining action callback above.

An attempted ordinary-day suspended-tab probe did not hold the intended refresh reliably (its captured editor was already editable and the claim slot was gone). It is retained as an explicitly inconclusive harness attempt, not a pass or a product failure. A reliable two-tab resume check remains open. No Worker, real Postgres browser or physical iPhone check was performed here.

Scripts/logs/screenshots: `tests/evidence/ratchet-race-fix/`. No product changes by this reviewer.
