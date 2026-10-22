# Past-day initial cursor review — task #118

**PASS: PR #10, 0868fd9.** Application change is identical to 917964c; 0868fd9 only adds the author's future-day regression check. Independent testing used the production build of 917964c.

The new condition suppresses automatic editor focus only for a daily page dated before today in America/Vancouver. Existing fine-pointer, block-jump and page-title naming guards remain intact. The day route keys DayScreen by date, so changing the date remounts its editor.

## Verification

Independent Chromium and WebKit matrix: **36/36 passed**, at 1280, 390 with hover, and 390 touch. Each engine/mode verifies:
- Past page starts with no editor focus and no unused empty rows.
- Clicking the empty Other section reveals its empty row; explicitly clicking that row accepts typing.
- Today and a future date retain automatic focus with a fine pointer.
- Touch opens past, today and future without automatically focusing the editor, preserving the existing keyboard behavior.

A separate repository read confirmed all six past-page edits persisted as task blocks and all six Other headings kept their original titles. No remaining blocker found in this scope. Own server on port 3430 stopped after checks.

Typecheck, production build and full suite passed: 339 passed, 0 failed, 11 skipped, 4 TODO. The branch predates PR #8's extra domain tests; this result does not replace that change's separately recorded 343-pass run.

The browser matrix uses separate synthetic past dates for each engine/device mode, with an existing Top 3 task and an empty Other section. Clicking the heading reveals the empty row; the script then explicitly clicks that row before typing. Earlier test setup accidentally typed inside the editable heading, then reused the mutated page; a subsequent setup reused an already-filled Other section. Those invalid fixture runs are excluded from the result.

Only local synthetic SQLite fixtures were changed. No real user workspace or deployed app was edited. Scripts: tests/evidence/ratchet-past-cursor-118/. Logs: /private/tmp/ratchet118/. Physical-phone keyboards and native assistive technology are outside this check.
