# Editor selection and paste correction

Author: Wheeljack, 2026-10-17. Candidate branch `fix/editor-selection`, based on `1e28cb2`. Review requested from Ratchet. This is author verification, not independent acceptance.

## Scope and decisions

Lead directives `af47081b`, `29e1dd88`, and `1afe1f26` in #daythread:9ec597fb authorize the mouseup guard, phone selection correction, and F19 clipboard rules. The trial on port 3001 and its data were left alone. No main merge, cloud connection, or deployment was performed.

- Mouseup repairs only a left single click in editable document text. It excludes composition, drag, history work, non-editable controls, and non-text boundaries. The deferred callback repeats guards and rejects a changed/destroyed document. The underlying BlockNote first-click problem remains unexplained; this is a bounded workaround, not an upstream fix or proof of real IME compatibility.
- Phone formatting controls no longer enlarge the layout viewport. BlockNote's floating formatting bar is disabled below 900px and while a whole block/section is selected on desktop. The app selection bar remains in the dock. Editor horizontal overflow is clipped.
- Whole-block/section native copy writes a structured application clipboard payload plus readable external HTML/text. Inline text selection uses BlockNote's ordinary text copy. Task export does not render interactive React controls.
- Copying a Task creates a fresh block and a fresh, unplanned Task. Editing it cannot rename the source Task. Cutting uses a one-use move token, persisted across same-origin navigation/reload, and retains Task identity, date facts, and plan/reference role. Repeated paste after a cut becomes a copy. A move into a workspace without that Task becomes a copy.
- External Markdown and HTML checklists become separate, editable `sourceChecklist` blocks and create no Tasks. The dock offers “N checklist lines · Turn into tasks.” Explicit conversion follows F19's typed-`[]` section rule: plan sections plan the new Tasks; Notes creates references. Copy/paste of an existing Task always stays unplanned. The ordinary-page checkbox product choice C4 remains unresolved; these checks cover day pages.
- Paste uses a ProseMirror block slice at the real selection rather than HTML re-import that can rewrite block IDs independently of derived Task IDs. Conversion is one history step. Semantic undo checks include pending Task creation and Task-to-checklist transitions, avoiding an orphan Task when undo meets an in-flight save. History scans include child blocks.

## Actual checks

All browser writes used disposable local data `/tmp/editor-selection-workspace.json` through port 3040. Browser clipboard contents were generated test notes, not user clipboard material. Chromium desktop checks ran headed; phone checks used Chromium's mobile/touch emulation.

| Check | Observed result |
| --- | --- |
| Domain tests and typecheck | 45 tests passed; typecheck passed. Permanent regression covers no Task on checklist save, explicit conversion, Undo/Redo identity, and rejection of an unknown Task identity. |
| Production build | Passed; existing editor bundle-size warning remains. |
| External refresh followed by first click/Enter | New typed Task stayed in Top 3, as intended. |
| Desktop section handle/Delete, Undo, actual heading drag, keyboard text selection | Passed without page errors. |
| Phone 390×844 and 375×844 | Actual handle tap → visible Delete → tap Delete → top notice Undo restored the section. Document scroll widths were 390 and 375; Review remained visible. No real phone keyboard was involved. |
| Native single-row handle Cmd+C/Cmd+V | Created a different Task with no plan date. Real keyboard edits to the pasted title left the source title unchanged. |
| Double-click a word in a Task title, native copy/paste | Pasted text only, with no extra Task. |
| External `- [ ]` Markdown and rich HTML with checkbox inputs | Preserved checklists without creating Tasks. Explicit conversion created Tasks; one Undo removed only the newly created Tasks. |
| Bare `[ ]` pasted into Top 3 | No Task until conversion; explicit conversion planned it for that day; one Undo removed the new Task. |
| Native cut/paste, including reload between cut and paste | Task identity, status, dates and original plan role retained; Task count unchanged. |
| Undo while paste save response was deliberately delayed | New Task was removed atomically; no orphan Task and no page error. |

Local repro scripts: `/tmp/editor-selection-done.mjs`, `editor-selection-gestures.mjs`, `editor-selection-mobile.mjs`, `editor-selection-mobile-375.mjs`, `editor-selection-clipboard-test.mjs`, `editor-selection-partial-copy.mjs`, `editor-selection-cut-reload.mjs`, `editor-selection-top3-paste.mjs`, and `editor-selection-race-undo.mjs`. These are local disposable-data scripts, not a portable CI suite. Earlier exploratory failures included a test clicking blank space instead of selecting text and a test expecting one row despite an already duplicated fixture; neither is counted as a passing app check.

## Remaining verification

Ratchet must independently recheck this commit, including the same first-click, drag, selection, clipboard and phone cases. Real Chinese IME, real iPhone/touch keyboard, Safari custom clipboard formats, cross-app Notion clipboard variants, and nested child-block clipboard gestures have not been independently verified. No claim that all editor interaction-spec rows are complete is made here. Brian's acceptance remains separate.
