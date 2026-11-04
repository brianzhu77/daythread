# PR122 independent review

Candidate `9428e128`; Ratchet, 2026-11-04. Local production build, invented SQLite store only, port 3698.

**One return-position gap found:** open a bookmark far down the list at 390px, reload its page, then tap ‹ Bookmarks. The list opens at scroll 0, leaving the original row roughly 1,980px below the viewport. Reproduced in Chromium and WebKit. The normal no-reload return works.

This comes from the pre-existing module-only `leftFrom` value being lost on reload, rather than a new regression introduced by the header. It remains relevant to B86's return-position acceptance: the new header knows the bookmark's page ID and can carry that back to the list. Product requested fixing it here if small, otherwise explicitly leaving it open. Browser reload is the demonstrated case; actual iOS suspension was not tested.

## Evidence

Build and typecheck pass. Local suite: 713 passed, 0 failed, 5 skipped.

- Author `header.mjs` passes in Chromium and WebKit at 1280 and 390: return to a far-down bookmark, real parent day, landing on the card, long folded paths, sub-item paths stopping at Trash, and the parent day not repeated under Linked from.
- `memo.mjs`, both engines: add and remove a card to the target from another page through repository commands, simulating a missed external save. The old tab stays unchanged until its focus refresh, then each saved revision correctly adds or removes the source under Linked from. No stale memo or runtime error found. This is an external-write/focus-refresh check, not an end-to-end source-page editing test.
- `long.mjs`, both engines at 1280 and 390: repeated long parent titles fold or ellipsize, with no overflowing or silently clipped crumb.
- `reloaded-return.mjs`, both engines: the return-position gap above.

The new memo intentionally follows saved workspace revision, so links typed but not yet saved need not appear immediately. No Worker, real Postgres browser, physical iPhone or Simulator Home Screen run was performed by this reviewer. The native Home Screen case remains owed before claiming Brian's full workflow verified.

Scripts and logs: `tests/evidence/ratchet-header/`. No product code changes by this reviewer.
