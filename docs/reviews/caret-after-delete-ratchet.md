# Caret after row deletion — task #119

**PASS: PR #11, cd0cc76.** Application code matches 3d7084d; cd0cc76 only strengthens the author's Undo database checks. Independent browser testing uses the production build of 3d7084d.

The empty-task Backspace handler now finds the preceding visible text block before deleting the row and puts the caret at its text end afterward. It reuses the row-arrow visibility rule to skip hidden past-day rows. Non-text page/link cards are skipped. Ordinary paragraph/bullet deletion, selected-range behavior, composition guard and the earlier document-start-to-title path are not changed by this patch.

## Independent results

- Typecheck and production build passed. Full suite: 343 passed, 0 failed, 11 skipped, 4 TODO.
- Additional independent cases: 24/24 passed, Chromium at 1280, 390 hover and 390 touch, plus WebKit touch. Each mode confirms the caret at the preceding paragraph end after deleting a task; Undo restores the same task ID, complete title, open status and original source block; restoration survives reload. First document line Backspace returns to the title. Empty paragraph and bullet deletion still end at the preceding text.
- Fresh explicit target-row tests at 390 hover/touch both end at the Other heading's exact text offset 12.

- Caret scenario matrix: 21/21 passed across 1280, 390 hover and 390 touch, including the last visual line of wrapping task text, continued typing there, heading end, hidden past-day rows and three page/link cards.
- Daily task Undo independently passed at all three modes: before deletion the original task is open/included/planned for today; after deletion it retains its ID but becomes excluded/unplanned; Undo restores that same task ID, full title, open status, included placement and today's plan. A reload retains the restored source task.
- Writing regressions passed: stable-check 15/15 and actions-check 42/42, across all three modes, including real document reference tasks and wrapping-title completion.

No remaining blocker found in this scope. Own local QA servers on ports 3431–3433 stopped after verification.

The initial coordinate-driven author harness failed its Other-heading case at narrow widths; it did not establish that the intended row was focused. The independent explicit-target fixture passed. The final adapted harness scrolls the heading/card into view before using coordinates. The rerun with scrolling and fresh target pages passed at all widths. Initial failed runs are retained in temporary logs but excluded from passing counts. A first actions regression run opened an uncreated future page; the fixture was corrected before rerunning.

No actual IME, physical iPhone or native assistive technology session was exercised. Touch refers to browser emulation. Only synthetic local SQLite workspaces were mutated. Logs: /private/tmp/ratchet119/. Scripts: tests/evidence/ratchet-caret-119/.

The first independent plan-state probe used a future day and incorrectly expected today-only deletion semantics. Source inspection confirmed that clearing plannedOn/excluding the placement applies to deleting today’s plan row. The final probe uses the actual local today; the invalid expectation is excluded.
