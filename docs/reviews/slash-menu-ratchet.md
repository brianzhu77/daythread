# PR52 independent review — changes required

Reviewed head `94cc76f`, base `fcb3d5f`. Build and typecheck pass. No application changes by reviewer.

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

## Unresolved finding

Immediate Cmd-Z after `/hr` selection left the divider in place in the independent Chromium probe, including after refocusing and another Undo. Jazz is comparing other menu entries and the pre-change built-in paths. Jazz confirmed that this newly exposed non-text insertion path splits last-line divider insertion and its trailing Body line into separate history steps; the next Undo can throw a ProseMirror range error. The PR needs the one-step insertion fix before acceptance. Lead also requested last-line /Page and typed --- checks. All native placement results above remain valid unless that code changes. `undo-probe.mjs` preserves the reproduction.

All tests use a disposable local SQLite database `/tmp/ratchet255.sqlite`, preview 3691. No production data, production writes or provider calls.
