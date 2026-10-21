# B23 conflict recovery independent review

Initial candidate c379ac5, Ratchet, 2026-10-21. **Changes required.** Independent build/typecheck passed; FUTURE_DAYS_CONTRACT=1 suite: 308 total, 304 passed, 4 TODO, zero failures/skips. Independently executed the author's complete browser check on a fresh isolated SQLite copy: all checks passed, including task creation/rename, Undo, network retry, reload recovery and 390 layout. No production writes or model calls.

## Additional confirmed defects

1. **A line containing only an inline page link is treated as empty.** With baseline [[P]], latest [[P]], local draft [[Q]], mergeDraft replaces P directly with Q. The latest line should survive and the local changed line should be recovered below it. `inlineText` omits pageRef content, so `isEmpty` is insufficient. See merge-probe.ts/log.
2. **Imported checklist check state is lost.** Baseline unchecked, draft checked, latest unchecked: mergeDraft returns unchecked with no recovered edit. checked is editable through the sourceChecklist checkbox, but wording omits it. Same probe. Jazz's accepted clarification c56721b5: tick-only change with unchanged latest applies in place; both sides changed → preserve local checklist below, including checked state.
3. **Load latest uses cached content rather than click-time latest.** Browser conflict appears; another repository save then updates the page. Clicking Load latest uses latestPage.current without fetching, and its merged autosave immediately conflicts again. New remote text is absent; local draft remains. No stored-data loss claim. See click-latest.ts/log. Fetch current server state on click, preserve the original baseline and all local typing (including during the load), and merge against the fresh result.

## Pending final candidate

Lead requires next head to merge the released B20/main, the merge fixes, and Jazz's recovered-line bullets plus visible Load latest styling, then full geometry gate. Need independently recheck the three cases above, all changed recovery paths, loading-time typing, and final 390 layout/geometry before approval. Earlier passing broad browser/unit evidence carries only where paths are unchanged.

All scripts/logs are in tests/evidence/ratchet-b23-97. Own initial QA server stopped after these checks.
