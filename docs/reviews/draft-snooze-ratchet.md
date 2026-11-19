# Draft move data review — Ratchet

Candidate: 1389ec6c, base 6304bd9f. Contract: Lead d2d043f0 / 0f8ade74; Brian 1a509219.

Not clear: ordinary task planning bypasses the stale-decision protection.

## Independently reproduced

Run `node --test tests/draft-snooze.test.ts tests/ratchet-snooze.test.ts`: author 8 pass; reviewer 2 fail.

1. Skip suggestion, move it, Undo move, ordinary `plan-task` to Oct28, then old `reopen-draft`: succeeds instead of refusing edited-since. The draft item stamp only changes on draft commands. This contradicts the accepted guard against later replanning. Current plan remains Oct28, but the obsolete notice says Undone and changes the draft state.
2. Skip suggestion, ordinary `plan-task` to Oct28, then old toast `snooze-draft` to Oct26: succeeds, overwriting the newer plan. The command has no expected skip/plan identity.

Tests use actual domain applyCommand via standard harness, fresh expected revision each command (the same semantic risk after a tab synchronizes while retaining an old notice). No browser reproduction yet.

Suggested repair: bind the toast action to its intended decision and plan state; validate changes through ordinary planning/editor routes, not only stamps set by draft commands. Include genuine skip/move/Undo/reopen and stale ordinary-plan tests.

## Scope

Independent reading of changed domain, hook and model logic, plus targeted tests. No production/user-data writes, no model calls, no native/browser verification, no source fixes. UI and gestures await Jazz head.
