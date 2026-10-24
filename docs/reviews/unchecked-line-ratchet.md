# B42 independent review

**Revise: 58571a2**, task185. Initial candidate4525c51; final delta changes conversion notice wording only.

## Confirmed blocker: manual re-creation restores an editor-born task

A line created as a task through the editor has ID `editor-task:<block id>`. After its checkbox is removed, manually making that same block a task generates the same ID. The deletion-restore loop then restores the old task, including its done state, even though this was not Undo. Reproduced with ordinary commands: paragraph → task, mark done, paragraph, manually task. Output is the same ID and `status: done`. Lead's accepted rule requires a new task for manual re-creation and the old identity for Undo.

`tests/evidence/ratchet-b42/editor-born.ts` is an assertive reproduction. The author's manual re-creation test starts from an add-task random ID, so it misses this common editor-created path. Fix should retain the separate Undo identity guarantee.

## Other independent evidence

- Full initial suite440/0, typecheck/build; final wording-only build passed.
- Author browser check rerun on fresh synthetic stores: seven assertions each at1280Chromium/390WebKit. Born-here removal, native Cmd-Z, nested child preserving parent, history→Not today, manual re-creation from a random-ID task, no page errors. Final-head phone run also7/7 including Removed from tasks wording.
- Exact cleanup checked on a fresh copy of revision280: list shows exactly editor-task:25515125-dee3-4ddb-8801-74d0b284e8f0 and editor-task:f72faaba-852f-46ac-a4ed-1936a720917e, no other task changes. Wrong IDs return failure and preserve the entire workspace; correct IDs reduce12tasks to10 while every editorJSON stays byte-identical and other pages remain identical. Undo restores both tasks and all their fields. `cleanup.ts` asserts these outcomes. No live cleanup was run.
- Exploratory `multi.mjs` created a browser text selection across three task rows and used Mod-Shift-8. That shortcut converted only the current block, so its assertion that three blocks had converted failed. This is not evidence that B42 lost or mishandled a multi-conversion; the shortcut did not perform that action. A genuine multiple-block conversion and Undo still need browser verification, alongside the domain multi-conversion case.
- Author notes the slash menu on a nonempty line inserts a new block rather than converting that line. No slash conversion is claimed as executed here.

No app code or production data was changed.
