# B27 independent native acceptance

PASS 6a20bd3, task #219. No app changes by reviewer. App source matches 6a20bd3; isolated built preview on3648 and disposable SQLite store. iPhone17/iOS26.4 Simulator, Mobile Safari and a freshly installed Home Screen app. Evidence: tests/evidence/ratchet-b27/native/.

## Native results, both Safari and Home Screen

- Actual pinyin software-key taps: 开会, keyboard @, mingtian, select 明天. The list reopens with tomorrow/All day; keyboard Return makes the Tomorrow chip.
- First toolbar Undo restores exactly 开会@明天. Five Undos give raw query, one unchanged press, 开会@, 开会, then empty. The committed word no longer stays behind, and no unrelated text is removed. The one silent history step matches the author's report and the accepted release rule.
- A committed @老王 remains plain with no menu.
- Native English Nov20 input makes a chip; Undo restores its exact typed line. Redo persists it and Nov20 displays its event under the no-page future state.
- With the software keyboard down, today's event strip is visible near the top. Native screenshots reviewed in both surfaces. Home stays standalone through day navigation; Safari shows browser chrome.

The Chinese keyboard's @ is half-width on this simulator. Native full-width symbol entry, a physical iPhone, third-party keyboards and other iOS versions are not claimed.

## Desktop Escape after reopened composition

WebKit1280: stored prefix Kept words, type @, close its initial list, replay a composition committing 明天, observe the list reopen, then physical-keyboard Escape. Undo ×3 gives Kept words @, Kept words, Kept words. The persisted prefix survives and no appended word remains. Test: esc-composition.mjs, fixture seed-esc.ts; exact output native/desktop-escape.log. Composition is a DOM/input replay on this desktop case, not a real desktop IME.

## Scope and provenance

Earlier 1a501fb native probes reproduced the history quirk; those are superseded by the final per-line-ID probes above. iPhone Escape attempts never dismissed the menu, so they are excluded and the requested desktop case decides that path. Initial fixed waits/ambiguous selectors and a Mac End-key caret setup were corrected; final Escape uses a condition wait and explicit end selection. Failed bulk-key text and capitalization mismatches are harness limits, not newly claimed app failures. Fixture contents retain these earlier attempts; assertions identify the current probe line.

Independent browser/domain acceptance on733840c remains in b27-ratchet.md (d833415). Lead owns the final merged integration/deploy gate. This report verifies native behavior after the app changes through6a20bd3; no user live data was typed into or altered.
