# Two-editor peek: independent race probe

2026-11-04 UTC, exact peek head **6116a5ea** (not a merge with current main). Throwaway SQLite, built app, localhost:3697, Chromium and WebKit with service workers blocked. No real data, native device or production writes.

**One additional lifecycle defect; neither probe lost words.**

1. Hold a save of the host page's synced line after typing ` HOST`; open its Dune row as Center peek and type ` PEEK` into the same shared block; release the save. Both versions remain stored and visible (one in the block, one as a conflict copy). No page error in either engine.
2. Open Dune in the peek, type ` PEEK`, hold its save POST, close the peek, type ` HOST` in the shared line behind it, then release the peek save. Both versions remain stored and visible, but **both engines raise an unhandled Tiptap error**: `The editor view is not available. Cannot access view['dom']. The editor may not be mounted yet.` WebKit includes the rejection stack in `webkit.log`.

Repro: `tests/evidence/ratchet-peek/races.mjs`, scenario `peek-save-close-host`. It uses `tests/evidence/peek/seed-synced.ts`, not his store. The initial Chromium log predates the stricter assertion on page errors and labels the word-retention check PASS; the error is still recorded there. The final script treats an error as failure.

The late save-success path in `page-editor.tsx` applies block updates through the editor's view **before** its `if (left.current) return` guard. A closing peek destroys that view. Recommendation: retain necessary save bookkeeping, but never apply DOM/block/selection updates to an editor that has closed; protect the analogous conflict-return path too. Add a close-with-save-pending regression. This is a confirmed runtime error, not evidence of irreversible word loss or a full peek review.

I did not merge the peek head with main: that merge had unrelated command-schema/domain conflicts, so I aborted it and tested the identifiable author head. A final combined release still needs its own gate.
