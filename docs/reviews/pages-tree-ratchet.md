# Pages Step B — independent acceptance

Task #73. Candidate6bea449, base69992ab. **One confirmed blocking navigation finding; awaiting followup.**

## Finding: future parent absent from desktop tree

Actual desktop Move to… of C to Thu Oct22 succeeds; breadcrumb shows that day, but Days tree has neither Oct22 nor C because date<=today excludes future days even with children. Evidence future-child.mjs/log/png. Lead4eac80fd accepted fix: future days with children appear before Today in date order; active ancestor day is visible/expanded. Empty future days remain omitted. Phone Calendar→day→Subpages is an accepted existing route and is not blocked.

## Independently passed

- Actual SQLite candidate writes moved hierarchy, old cd3c494 loads it and performs a legitimate rename, candidate reloads: parentId, descendants, references, task identity/state and model ledger all retained; layout stays3. No downgrade script required for this diff. Undo snapshot is readable and a subsequent candidate Move Undo restores pages exactly.
- Self/descendant cycle refusals leave complete workspace unchanged; move keeps tasks/placements/ledger unchanged and actual source-ID set intact.
- Chromium1280 actual sidebar + creates a child under A without inserting a body card, and produces no parentId-only Linked from. Actual Move+Undo updates parent, breadcrumb and old-parent reference display.
- Chromium390 Move sheet/cancel works without horizontal overflow or page errors; desktop screenshot and phone screenshot retained.
- Actual stale dialog: while open, another repository command moves its target under the moving page. Clicking that stale option refreshes, refuses inline, keeps the dialog open, produces no Not saved banner and changes no pages beyond the concurrent command.
- Full suite186 total,182 pass,4 TODO,0 fail.

Evidence tests/evidence/pages-tree-73. Scripts use isolated /tmp/ratchet-tree73.sqlite and own3381 server, not production. No provider calls. Browser harness initially attempted hidden sidebar + by accessible role; corrected to hover row before selecting. This was a harness issue, not a product failure.

## Accepted limitations

Document Linked from uses reversed workspace page order; moving a source can reorder entries. Lead ec99ea1a accepts this as B15, not N09 failure; true reference timestamps are deferred to A9. Real iPhone/Chinese IME and comprehensive keyboard tree interaction are not verified. Jazz separately owns the complete visual checklist. Future implementation followup will be reported below.

## Followup6d3560c — PASS

The confirmed future-parent omission is fixed. Independent followup.mjs/log with a four-level future-day branch and long Chinese parent title verified future ThuOct22 before Today, all ancestor branches expanded and deepest page selected; a past day with only a child is listed and expands to that child. Sidebar Pages navigation is not selected on a subpage. At390 loaded directly, the hidden ancestor menu is on screen (269.66px wide), actual hit testing reaches its menu item and clicking the nearest ancestor navigates correctly. No page errors. Full suite187 total,183 pass,4 TODO,0 fail. Previous domain, concurrency and old-version storage evidence remains applicable: rebased original source is unchanged and followup touches no storage.

**Additional non-blocking finding:** desktop1280→390 resize without navigation leaves crumbs-path in measuring state rather than folding; direct390 navigation/reload folds correctly. Observed independently twice, including a minimal fresh browser run. This explains an exploratory harness timeout waiting for Hidden ancestors after resize; corrected final harness reloads at390. Recommend followup remeasurement/ResizeObserver fix. This is separate from the repaired clipped menu and is not a fresh-phone-width failure. Reported to Lead/Roadbuster03880c7a. No real-device testing.
