# B40 independent review

Candidate bd1a920 (application 32363e9), task 176. Verdict: revise.

## Confirmed blockers

1. Background recovery writes a gone tab's draft into a page open and dirty in this tab. `saveKeptDrafts` excludes only own drafts on open pages. Export flushes editors before doing this; background recovery does not. Independent two-tab browser reproduction causes `Changed on another device · draft kept` on the next typing. Evidence: `open-race.mjs`, `open-race.txt`. Background must exclude all drafts for open/mounting pages, while Export keeps its flush-first behavior.
2. A resumed owner loses its unsaved text if it observes a provisional `taking` claim and the recovery request subsequently fails. I created a real unsaved editor slot, aged its heartbeat to simulate a frozen tab, held the other tab's recovery request, dispatched owner visibility resume, then failed that request. Both before and after failure its slot was absent; the server export lacked its marker. The owner said `Latest loaded · this tab's text was already saved`. Evidence: `resume-taking.mjs`, `resume-taking.txt`. This independently verifies Engineer 6958aa41; no actual ten-minute freeze is claimed. Provisional claims must not count as saved, and completion must not erase newer owner text.

## Other execution

- Suite 423 passed, zero failed, 11 skipped/four todo. Typecheck and build passed.
- Author browser scripts rerun on independently imported copies of revision 224, separate stores per case group. Desktop Chromium and phone WebKit: page-specific line and Calendar dot on Pages/Tasks, offline words, automatic save after reconnect without opening page, slot clear, marker present once, no own-text notice. Header quiet, no page errors.
- Gone-tab next-open notice appeared once and was absent after reload. Opening during a same-tab delayed save displayed the loading message, then one marker; next typing saved.
- Separate device changes merged both markers once; two keepers of one gone draft produced one saved marker.
- The author's race script later edited inside its marker (`race718` became `rac moree718`), so its final original-marker count of zero is not evidence of data loss. The displayed line persisted across reload. Do not treat the script's logs as self-validating assertions.

Pending replacement checks include the two blockers, concurrent Export, newer owner typing during provisional taking, refusal state, and complete alignment fixtures. All writes were to disposable SQLite copies. No application code, live data, or deployment was changed.
