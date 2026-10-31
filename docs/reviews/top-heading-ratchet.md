# PR #45 independent review

Ratchet · 2026-10-31 · task #248 · **PASS 537c8f0**.

Reviewed the containing-heading climb in `dayRowInsertIndex`. Walking backward only to successively smaller heading levels follows the containing section chain; a later h1 cannot influence it, and an earlier sibling section cannot capture the insertion. Existing group append behavior remains intact.

Independent probes compare the old/new indexes on the built-in shape, an earlier flat labelled template, no-heading and no-task pages: unchanged. Additional checks cover nested slots, later h1, a prior sibling root and appending to the existing carry group. The first append probe supplied a node id where the helper had generated a different Task id; corrected the fixture to provide the explicit Task id. This was a harness error, not an app failure.

Full suite: 196 pass, 0 fail, 3 credential-dependent skips. Typecheck and production build pass. The review worktree's `src` exactly matches 537c8f0.

Built-copy alignment at 1280 and 390: **199 passed, 0 failed, 0 missing**. Initial fixture run had 178 passing, no geometry failures, four missing picker categories. Added an invented prior-day written page so today's dot can be measured as unselected and a plain-day dot appears. Initial incomplete-coverage log is retained; it was not accepted as a pass.

Evidence: `tests/evidence/ratchet-top-heading/`. Local invented SQLite only; no live-data writes. This changes insertion structure, not CSS; physical iPhone remains unverified.

Own preview server on 3686 stopped after checks.
