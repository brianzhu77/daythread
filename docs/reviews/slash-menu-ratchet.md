# PR52 independent review — final pass

PASS revised head `cfe9ba1`, base `fcb3d5f`. Initial `94cc76f` required changes for last-line Separator Undo. Own revised build/typecheck and full suite pass (215 pass, 0 fail, 3 skipped). No application changes by reviewer.

## Browser checks

The author's `tests/evidence/b4/slash-menu.mjs` passes when rerun against my built preview and invented SQLite store: the complete 11-item list, aliases, renamed Body in formatting controls, scrolling past eight rows, insertion, and simulated phone keyboard clearance. Additional independent Chromium 1280 and mobile WebKit 390 groups pass: Separator saves and reloads without losing original words, and both page-link and date menus fit above the simulated keyboard toolbar.

Harness corrections: use a DOM caret at line end instead of assuming End has identical WebKit/Chromium semantics; inspect the last menu during transient overlapping controller DOM; use first divider after deliberately inserting twice. None of those failed assertions is evidence of an app defect.

## Native iOS keyboard gate

PASS on dedicated Ratchet-B4 iPhone 17e Simulator, iOS 26.4, 390 CSS pixels, through XCUITest/Appium and real Mobile Safari. No visualViewport override. Native accessibility source confirms the software keyboard exists.

- A native tap on the toolbar plus opens the menu above a low caret. Menu bounds 10–253, caret top 268, toolbar top 331.
- Two native touch swipes scroll the list from 0 to its actual maximum 463; Separator lies fully inside the menu at 195–249. A native tap on Separator inserts one divider and closes the menu.
- Native WDA key sequences type `[[Target` and `@` into the editor. Both menus remain above the toolbar: link 127–253, date 101–253, toolbar top 331.
- Native screenshots independently inspected: `native-plus.png`, `native-last.png`, `native-link.png`, `native-date.png`.

The first scrolling attempt overscrolled beyond the list boundary and moved the page; it was rejected as a reliable last-row interaction. The corrected run measures after each swipe and stops when the last item is visible. This is Simulator evidence, not a physical iPhone or Home Screen check.

## Undo finding resolved

Immediate Cmd-Z after `/hr` selection left the divider in place in the independent Chromium probe, including after refocusing and another Undo. Jazz is comparing other menu entries and the pre-change built-in paths. Jazz traced the non-text type conversion to a ReplaceAround history step that could not be inverted, also present on main for typed `---`. The revised shared insert uses a plain replacement and trailing Body line in one transaction. The menu placement source is unchanged, so the native placement evidence above carries forward.

Ten independent revised-head groups pass, five each in Chromium 1280 and mobile WebKit 390: last-line slash Separator; last-line typed `---`; mid-page Separator leaving the following heading untouched and caret on a new blank Body line; a to-do retaining its typed dashes; and last-line `/Page` opening its new child while preserving the parent words and page card. For all three Separator cases, one Undo removes it, Redo restores it, and the divider and original words survive reload. Typed dashes return on Undo. No page errors occur. Evidence: `undo-final.mjs`, `undo-final.log`.

An extra harness correction during recheck scopes the heading assertion to its inline text rather than duplicated BlockNote wrappers or wrapper innerText with a terminal newline; `undo-selector-correction.log` records the rejected assertion. `undo-probe.mjs` preserves the reproduction.

All tests use a disposable local SQLite database `/tmp/ratchet255.sqlite`, preview 3691. No production data, production writes or provider calls.

Own final preview and all native runners/simulators are stopped. Physical iPhone and Worker/Postgres are outside this local review.
