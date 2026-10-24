# B44 independent review

Candidate: e331ade (`feat/paste-menu`). Reviewer: Ratchet, task #187.

Verdict: **revise**. Four reproduced gaps; no production edits.

1. **Good Stuffs retention depends on command order.** The browser sends `save-plain-link` before `save-editor`. In that order the material source stays `plain:true`, even after the line is recognized as a deliberate Good Stuffs save. Deleting the line deletes the material. Reproduced in the domain and 390 WebKit. Saving the document first hides the bug. Preserve the deliberate-save exception in either order.
2. **Tapping Bookmark loses editor focus at 390.** After a trusted WebKit tap, `document.activeElement` is BODY. Both subsequent history Undo shortcuts do nothing. This violates the focus contract; actual iPhone keyboard behavior remains unverified. The notice's Undo works and returns the plain link and material.
3. **Three-link menu overlaps the phone toolbar.** Paste three URL lines into Notes at 390, then tap Bookmark 3 pages. Playwright cannot tap: `.editor-phone-toolbar` intercepts the Bookmark row. Placement must measure and avoid the actual toolbar, including B5's forthcoming toolbar changes.
4. **Offline kept links never become materials after reconnect.** Offline paste into Notes, keep, reconnect: the text saves, but the initial failed `save-plain-link` is not retried or reconstructed. The saved material remains absent. Preserve this intent through draft recovery.

## Independent checks

- Suite 468 passed, 0 failed, 11 skipped, 4 todo; typecheck and build pass.
- All six author scenarios independently pass at 1280 Chromium on separate fresh SQLite stores: keep, bookmark with both history Undo steps, several links, typing, sentence exclusion, saved-page label.
- Additional desktop cases pass: restoring the same trashed page, copied HTML link label/title, choosing three bookmarks, offline Bookmark refusal then Retry creating one page, task/text/mailto exclusions, caret movement/click outside dismissal, notice Undo followed by the original paste's history Undo.
- 390 WebKit: initial bookmark/card/notice/material checks pass; copied HTML label/title, trash restore, exclusions, caret/click dismissal, and notice Undo followed by refocused history Undo pass. Phone two-step history without refocusing fails as finding 2.
- Domain lifecycle checks pass for the browser's command order, deletion/URL removal, acted-on retention, and removing one then both cross-page references. Author tests cover an existing Good Stuffs material and page retention.
- Native phone keyboard/visual viewport, actual paste from a real OS clipboard, and aria-activedescendant remain unverified/accepted separately. Headless touch tests do not establish native keyboard behavior.

## Reproduction artifacts

`tests/evidence/ratchet-b44/`:
- `run-author.mjs`: disposable built-server runner; port 3590 by default, `PORT=3592` for a separate lane; each invocation uses a new `/tmp/rb-b44-ratchet187-*` store.
- `phone-undo.mjs`: author scenario with its skipped phone history checks enabled, plus active-element capture.
- `good-stuffs.ts` and `good-stuffs.mjs`: ordering and browser reproductions.
- `lifecycle.ts`: independent reference/decision retention checks.
- `extra.mjs`: CASE=trash/html/many/offline/offlinekeep/exclusions/close/notice/copy/title. Set CHECK to its path when running the runner. SEED can import a read-only JSON copy into a new disposable store.

Early offline fixture used a nonexistent standalone Retry button; corrected to click `.editor-page-card-failed`. Its selector timeout is not a product finding. The three-bookmark timeout is a real interception by the phone toolbar.
