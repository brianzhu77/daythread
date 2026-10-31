# PR43 independent review

PASS 547bedb, 2026-10-31. Carried and newly planned day rows form a group below the heading above the first task row, before labelled slots. No-heading pages use the top; no-task pages use the first heading, as Lead accepted9ded39e6. Ordinary document/link insertion remains unchanged. Events/Bring placement is explicitly deferred to PR44.

## Independent backup replay

Read only the existing before-b73 local backup's pages/tasks/workspace/tombstones; never connected to production. Select the workspace containing the Day default and verify America/Vancouver and25 template blocks before restoring an isolated SQLite store. `ensure-day(2026-11-01)` produces an exact structural copy, with fresh block IDs, both dividers, original paragraph/heading/arrow prompt text, empty task slots and no new Task records. At07:00Z Vancouver is still midnight before the later clock change.

Page creation itself does not automatically place carry tasks: two wait in the morning card. Domain AddAll and a separate fresh-backup run through the actual Add all tasks button both put them in this order: first heading, carried task1, carried task2, first paragraph label, empty task slot, next paragraph label, empty task slot; all remaining original blocks retain their order/content. Two empty slots remain empty. WebKit390 at a simulated Nov1 time renders this without page errors, with two divider elements and four task inputs. Reviewed screenshot delivered inside Raft; raw backup and real-data screenshots are not committed to Git.

## Built-in and other regression evidence

- Execute the same built-in-day creation/AddAll from the same initial workspace through pre-PR domain code and PR43; normalized structure/content/row metadata match. Render both outputs on the same production bundle: editor screenshots pixel-identical in Chromium1280 and WebKit390. PR43 has no CSS/UI diff.
- Independent alignment159 pass,0 fail,0 missing at1280/390 on invented full-coverage fixture days.
- Additional divider/toggle-with-nested-task/code-block test: language/newlines/nested words preserved, every copied node identity fresh, nested task words emptied, template and Task count unchanged.
- Full suite191 pass,0 fail,3 skipped; typecheck and production build pass. Author's11 new domain tests cover labelled/filled slots, no-heading/no-task cases, later carry, single Add, Tomorrow and ordinary link-page placement. Existing nested carry tests remain green.

Scripts and neutral screenshots/logs: tests/evidence/ratchet-carry/. Backup importer references the authorized local backup but stores no backup data in the repository. Physical iPhone and Worker transport unverified by reviewer. All own servers stopped after review. No source fixes by reviewer.
