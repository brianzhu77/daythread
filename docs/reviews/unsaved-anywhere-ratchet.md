# B40 independent review

Final candidate **0cf030a**, task 176. **Verdict: pass.** Initial bd1a920/application32363e9 was revised for the two confirmed blockers below.

## Replacement independently checked

- Both original browser regressions now pass: open dirty page is left alone; resumed owner retains its slot before and after a failed recovery request.
- Additional owner reload during provisional taking retains the marker, including after subsequent typing. No actual ten-minute freeze is claimed.
- Newer owner typing while recovery succeeds keeps its unclaimed slot; the next save reaches Saved and both old/new text appear once after reload.
- Leaving an open page lets its waiting gone-tab draft save: both texts once, no remaining draft, notice once.
- Concurrent Export waits for the held background save. Exactly one recovery POST, one download, one marker in exported page.document; next-open notice once and absent after reload. The first harness tried the internal editorJSON field in export JSON; corrected to its documented document field before the successful run.
- Refusal behavior: first refusal trying again, second/third open it, quiet header throughout; clearing the cause clears the line.
- Suite 423/0 (11 skipped/four todo), typecheck/build passed. Copied-store alignment with complete fixtures including preview and nested tasks: **383 passed, zero failed/missing**, across Oct18/19/22/23 and scratch12-31 at both widths.
- Initial baseline desktop/phone state and notice checks below remain applicable; replacement changes no CSS.

Known limit attributed to Jazz and Engineer5b8f05f9: owner resumes and edits during recovery while another device also changes the page; normal conflict/Load latest can retain the edited line twice. This is an explicit limitation, not an independently executed three-device result. No silent overwrite was found in the reviewed savedForMe condition: it requires exact page JSON and an unchanged base when recording the owner hint. The leftover hint storage key is harmless per the engineer review.


## Confirmed blockers

1. Background recovery writes a gone tab's draft into a page open and dirty in this tab. `saveKeptDrafts` excludes only own drafts on open pages. Export flushes editors before doing this; background recovery does not. Independent two-tab browser reproduction causes `Changed on another device · draft kept` on the next typing. Evidence: `open-race.mjs`, `open-race.txt`. Background must exclude all drafts for open/mounting pages, while Export keeps its flush-first behavior.
2. A resumed owner loses its unsaved text if it observes a provisional `taking` claim and the recovery request subsequently fails. I created a real unsaved editor slot, aged its heartbeat to simulate a frozen tab, held the other tab's recovery request, dispatched owner visibility resume, then failed that request. Both before and after failure its slot was absent; the server export lacked its marker. The owner said `Latest loaded · this tab's text was already saved`. Evidence: `resume-taking.mjs`, `resume-taking.txt`. This independently verifies Engineer 6958aa41; no actual ten-minute freeze is claimed. Provisional claims must not count as saved, and completion must not erase newer owner text.

## Other execution

- Suite 423 passed, zero failed, 11 skipped/four todo. Typecheck and build passed.
- Author browser scripts rerun on independently imported copies of revision 224, separate stores per case group. Desktop Chromium and phone WebKit: page-specific line and Calendar dot on Pages/Tasks, offline words, automatic save after reconnect without opening page, slot clear, marker present once, no own-text notice. Header quiet, no page errors.
- Gone-tab next-open notice appeared once and was absent after reload. Opening during a same-tab delayed save displayed the loading message, then one marker; next typing saved.
- Separate device changes merged both markers once; two keepers of one gone draft produced one saved marker.
- The author's race script later edited inside its marker (`race718` became `rac moree718`), so its final original-marker count of zero is not evidence of data loss. The displayed line persisted across reload. Do not treat the script's logs as self-validating assertions.

Replacement checks are listed above. All writes were to disposable SQLite copies. No application code, live data, or deployment was changed.
