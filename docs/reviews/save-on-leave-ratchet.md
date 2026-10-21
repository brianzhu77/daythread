# Save on leave — independent review

2026-10-21 · task #99 · candidate **43e73d4** · **Changes required**.

## Confirmed defect: a slow in-flight save prevents later typing from saving on leave

Independent Chromium run against a fresh isolated VACUUM copy, own build on port 3411:
1. Type `[R99SLOWA]` on Oct18 and intercept its first autosave before the server receives it.
2. Type `[R99SLOWB]` while that request is pending; immediately navigate to Today.
3. Release the first request 5.8 seconds after leaving; allow both queued actions to settle.
4. Database contains A but not B; localStorage retains B. The leave-save was refused against its own preceding save. No permanent text loss is claimed, but the server stays stale until recovery on return—the behavior this fix promises to eliminate.

Cause: cleanup waits at most 250×20ms, then constructs the action even if `sending.current` remains true. Its `expectedContent` still predates the first request. Workspace run serializes actions, so the first request commits before the leave-save runs, making the latter's captured baseline stale. See page-editor cleanup and use-day run queue.

**Fix:** wait for the actual in-flight save promise to settle, or construct/rebase the next action only when the prior request has completed. Keep failed/conflicting drafts. A finite polling timeout must not be treated as successful completion. Rerun the >5s case plus ordinary in-flight/return races.

Evidence: `tests/evidence/ratchet-save-leave-99/races.mjs`, `races-final.log`; fresh `/private/tmp/ratchet99-race-final.sqlite`. Reported fcc8748d. The final run has 4 passing assertions and this 1 failure. The interrupted second run is discarded; it reused a mutated database and is not evidence.

## Passed independently

- Build and typecheck, own worktree at 43e73d4.
- Full author save-on-leave browser harness rerun on a separate fresh `/private/tmp/ratchet99.sqlite`: zero-pause cut/switch/paste, database-only-on-destination after reload, typing/switch, multi-page edits, stale-tab conflict and Load latest, failed network then automatic retry on return, and compatible old stash auto-save. All passed, no page errors. `author-rerun.log`.
- Own first-request gate with shorter delay: type A, wait until save in flight, type B, leave, release. Both persisted; settled return clean.
- Own leave-request gate: return before the previous editor's save completes, type new words, then release. New draft survives both in editor and localStorage. Load latest subsequently saves all words. **Remaining usability limitation:** this produces "Changed in another tab" even though it was the same tab's old editor, and needs Load latest. No words were cleared. This is distinct from the slow-save defect above.

No application edits, model calls, production writes, or format changes. Unit/B23 results from author/Lead are not represented as my own runs. No geometry-affecting change; no new full visual sweep required.
