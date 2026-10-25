# B27 rollback review — task 220

**PASS ee7017d**, independently checked October 25, 2026. This passes the stored-data rollback gate; it does not claim that an old build can read an unsaved browser draft containing a chip. Lead accepted the recovery rule in a94388b7: never clear a draft; roll forward so it saves, rerun conversion, then roll back.

## Independent evidence

- Built old main **7b7f706** in a separate worktree. Separate SQLite fixture made through the new domain commands: six chips, timed and all-day, nested children, a day page, a document and a trashed document. A stored Undo existed.
- Before conversion, the old build fails to render both accessible chip pages in WebKit and Chromium at 1280 and 390 (eight observed failures, as expected).
- Actual CLI dry run reports six with no row changes. An unwritable backup destination refuses with no row changes. Actual conversion reports six and Undo cleared. Backup is retained locally. Revision remains seven; sections, ids and trash state are unchanged. All Undo rows across the entity/meta tables are removed. A second run reports zero and leaves the complete compared rows identical.
- After conversion, that same old build opens the day and document with exact expected text in both engines and widths (eight successful opens). Day text: `Before @Nov 20 3pm after`; document text includes the year. Nested next-year text is retained on all three stored pages, including Trash. Trash conversion was verified in the store, not via a restore in the browser.
- A separate helper probe covers a saved link-preview document with a chip inside link content: midnight becomes `12:15am`, adjacent bold text and link remain unchanged, second conversion finds zero.
- Independently ran all five author rollback tests: pass, including the Postgres helper against PGlite, backup callback failure, original backup document, revision retention and repeated run. I did **not** run this script against Supabase myself; Lead's separate Supabase rehearsal is recorded in a94388b7. No full-suite rerun claimed here.

Evidence/scripts: `tests/evidence/ratchet-b27/rollback/`. Local stores `/tmp/ratchet220-{copy,after,backup,backup2}.sqlite`. Old build on ports 3650 (before) and 3652 (after). No live or user data was written.

## Operational limits

The script converts stored documents and clears stored Undo. It cannot rewrite localStorage drafts or an already open editor's in-memory document. Preserve drafts; do not clear browser storage. Avoid new-build writers during the rollback transition, because they can save another chip after conversion. If a retained draft blocks a page under the old schema, follow Lead's roll-forward recovery rule above. The replacement chip is plain text; its computed event disappears as intended when returning to the old build.

No app-code changes were made by this review. Release/deployment remains Lead's action.
