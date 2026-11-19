# Draft move review — Ratchet

Current integrated candidate: 50a390f8. Data candidate: 4fdf8a80, base 6304bd9f. Historical candidate: 1389ec6c. Contract: Lead d2d043f0 / 0f8ade74; Brian 1a509219.

Integrated UI not clear on50a390f8. Data clear on4fdf8a80 carries forward.

## UI acceptance50a390f8

Actual browser Chromium/WebKit,390/1280, independent scripts `tests/evidence/draft-snooze/ratchet-browser.mjs` and `ratchet-boundaries.mjs`. All use throwaway SQLite; second tab changes plans through actual Tasks menu.

Confirmed defects:
- At390 the three day buttons are36px tall, below Lead c432c98e's44px requirement. Both engines. Desktop32px is recorded, not independently a failure. Reported8d183260.
- Mixed Dismiss notice (`Move3to-dos to`) overflows at390: Pick button right402px, toast right374px, viewport390px. Both engines. Row lacks wrapping. Reportede0544f3d.

Passed: ordinary Another day in B, old Move in A keeps newer plan and shows refusal (4engine/width combinations); swipe from Mon never plans (4combinations); after Move/Undo move in A, ordinary replan B makes old second Undo refuse and preserves the newer plan (both engines at390). No native/Simulator evidence. Author52-case UI suite not rerun yet; awaiting layout repair to avoid duplicating full UI regression.

Data review clear for 4fdf8a80 on the checked paths; UI and gestures remain unverified.

## Recheck 4fdf8a80

Snooze now requires skippedBy and verifies the item is still skipped by that decision, unmoved, with the captured plan. Independent cases pass with both seen and skippedBy present: ordinary replan after Undo move rejects old reopen; ordinary replan after skip rejects old move; reopen/re-skip rejects old move; a current ticket completes Move/Undo/reopen and preserves deadline. Author 9 + reviewer 4 = 13/13 pass.

## Recheck dfe16cfb

Updated independent tests to pass the required `seen` snapshot captured before Skip. Both original reproductions now pass; author 9 pass. New independent case fails: Skip A, reopen on another tab, Skip B with the same plan date, then Move from A's old ticket. Move succeeds and overwrites the later decision because snooze-draft never receives/checks ticket.skippedBy. Reopen correctly checks that identity, but Move only checks plan date.

Total focused tests: 11 pass / 1 fail. Reported 05445be6. No browser/UI check yet.

## Independently reproduced

Run `node --test tests/draft-snooze.test.ts tests/ratchet-snooze.test.ts`: author 8 pass; reviewer 2 fail.

1. Skip suggestion, move it, Undo move, ordinary `plan-task` to Oct28, then old `reopen-draft`: succeeds instead of refusing edited-since. The draft item stamp only changes on draft commands. This contradicts the accepted guard against later replanning. Current plan remains Oct28, but the obsolete notice says Undone and changes the draft state.
2. Skip suggestion, ordinary `plan-task` to Oct28, then old toast `snooze-draft` to Oct26: succeeds, overwriting the newer plan. The command has no expected skip/plan identity.

Tests use actual domain applyCommand via standard harness, fresh expected revision each command (the same semantic risk after a tab synchronizes while retaining an old notice). No browser reproduction yet.

Suggested repair: bind the toast action to its intended decision and plan state; validate changes through ordinary planning/editor routes, not only stamps set by draft commands. Include genuine skip/move/Undo/reopen and stale ordinary-plan tests.

## Scope

Independent reading of changed domain, hook and model logic, plus targeted tests. No production/user-data writes, no model calls, no native/browser verification, no source fixes. UI and gestures await Jazz head.
