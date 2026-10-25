# B9 independent review

PASS a7bbee8 (app code e8cfe01). No app changes by reviewer. Worktree test/ratchet-one-loading; disposable SQLite /tmp/ratchet216-b9.sqlite, server 3638.

- Read the complete day-screen, continuous-page and CSS diff. Normal loading is decided during render; future-day handling remains separate. Slow-editor text appears only after its timer; mounting/save coordination is unchanged.
- Independently ran cold-open/reload recording in WebKit 390 and Chromium 1280: only Loading your day. On original da22893, held creation showed only Loading after 8 seconds; a cut exposed Start. e8cfe01 fixes that unbounded visual wait.
- Final cut mode passes in both engines (Start after 2246 ms WebKit /1473 ms Chromium in this dev-server run). Sequential final WebKit hang passes (Start after 6964 ms, late reply opens editor).
- Separate controllable-first-request test, start-during-hang.mjs: tap Start while initial request is held, release it, type, reload. Pass in WebKit and Chromium, no page errors; text persists. SQLite current snapshot contains exactly one page for each date (2026-06-01/02). Start queues behind the first request; it does not cancel that request or allow editing before arrival.
- Typecheck passes. Full suite, alignment, native iOS and B40 race were not rerun by reviewer; author reports those checks. No live data touched.

Two simultaneous hang-mode runs against the same disposable store timed out waiting for the editor. They are excluded from single-client acceptance: each holds every retry 12 seconds, while concurrent revisions force a stale-revision retry outside the check's 15-second editor wait. Sequential hang and controlled release pass. Do not report those discarded concurrent runs as passes.

Remaining limitation: the six-second UI fallback is not a network abort; a request that never settles still holds the command queue. This behavior predates B9; B9 restores the previous Start action after its quiet loading period. No new ability to recover an indefinitely held connection is claimed.
