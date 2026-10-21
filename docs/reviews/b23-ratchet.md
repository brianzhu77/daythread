# B23 conflict recovery independent review

Final candidate fea48fd (initial c379ac5), Ratchet, 2026-10-21. **PASS after the fixes described below.** Independent build/typecheck passed; FUTURE_DAYS_CONTRACT=1 suite: 308 total, 304 passed, 4 TODO, zero failures/skips. Independently executed the author's complete browser check on a fresh isolated SQLite copy: all checks passed, including task creation/rename, Undo, network retry, reload recovery and 390 layout. No production writes or model calls.

## Additional confirmed defects

1. **A line containing only an inline page link is treated as empty.** With baseline [[P]], latest [[P]], local draft [[Q]], mergeDraft replaces P directly with Q. The latest line should survive and the local changed line should be recovered below it. `inlineText` omits pageRef content, so `isEmpty` is insufficient. See merge-probe.ts/log.
2. **Imported checklist check state is lost.** Baseline unchecked, draft checked, latest unchecked: mergeDraft returns unchecked with no recovered edit. checked is editable through the sourceChecklist checkbox, but wording omits it. Same probe. Jazz's accepted clarification c56721b5: tick-only change with unchanged latest applies in place; both sides changed → preserve local checklist below, including checked state.
3. **Load latest uses cached content rather than click-time latest.** Browser conflict appears; another repository save then updates the page. Clicking Load latest uses latestPage.current without fetching, and its merged autosave immediately conflicts again. New remote text is absent; local draft remains. No stored-data loss claim. See click-latest.ts/log. Fetch current server state on click, preserve the original baseline and all local typing (including during the load), and merge against the fresh result.

## Pending final candidate

Lead requires next head to merge the released B20/main, the merge fixes, and Jazz's recovered-line bullets plus visible Load latest styling, then full geometry gate. Need independently recheck the three cases above, all changed recovery paths, loading-time typing, and final 390 layout/geometry before approval. Earlier passing broad browser/unit evidence carries only where paths are unchanged.

All scripts/logs are in tests/evidence/ratchet-b23-97. Own initial QA server stopped after these checks.

## Final independent recheck — fea48fd

Rebuilt and typechecked successfully. Enabled full suite: **310 tests, 306 passed, 4 TODO, zero failures or skipped**. Source and scripts in this worktree match fea48fd, which includes released B20.

- Repeated the full author browser harness on a fresh copy: all passed, including task identity, bullet-column recovery, 390 Load latest ink/600 and 13px status, network retry, Undo and reload recovery. Inspected the resulting 390 screenshot independently.
- Own merge assertions: pure-reference lines preserve latest P plus local Q with a new refId; checklist tick-only change applies in place; concurrent remote wording change retains latest and the locally checked copy. All three passed.
- On a separate fresh copy, repeated the original click-time latest scenario: the new remote text is visible, local draft survives, and the merged page saves. Held the load request to confirm editing is disabled while loading; an aborted later load restores editable state and retains the entire draft. All expected states passed in click-final.log.

Final evidence is under tests/evidence/ratchet-b23-97/{final-ui.log,final-suite.log,final-typecheck.log,merge-assert.ts,merge-assert.log,click-final.ts,click-final.log,final-conflict-390.png}. Original logs remain as evidence of the initial findings, not failures on the final candidate.

Full independent final geometry gate on the isolated copy with official fixtures: **312 passed, zero failed, zero missing**, at 1280 and 390. Approved for Lead's B23 release. No data migration. Own QA services stopped after the review.
