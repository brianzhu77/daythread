# A12 row actions independent review

Candidate: e43a921. Reviewer: Ratchet. 2026-10-21.

Result: changes required. No production writes, migrations, or model calls. All browser checks ran on a fresh isolated copy of Brian's current SQLite workspace, port 3402.

## Confirmed issues

1. **Unopened future day can receive a fourth Top 3 task.** Move three tasks from today's Top 3 into tomorrow's Top 3 without creating tomorrow's page, then move a fourth. The fourth receipt says Planned, and ensuring tomorrow's page produces four Top 3 rows and no Other rows. `top3Full` counts page blocks but misses placements when the page does not exist. Count effective target placements as well, excluding the moved task, and test both before and after page creation. Reproduction and output: `tests/evidence/ratchet-actions-91/unopened-top3.ts` and `.log`.
2. **Cancelled task's checkbox remains active.** Cancel a task through its row menu. Its checkbox remains enabled and unchecked. Clicking it changes SQLite status from cancelled directly to done and removes the Cancelled label. Disable this control while cancelled, consistent with the non-editor TaskRow, so Restore is the explicit recovery path. Browser reproduction: `cancel-checkbox.mjs` and `.log`; SQLite independently confirmed status done.
3. **Keyboard menu Escape does not restore the text caret.** Jazz independently reproduced this in Chromium and WebKit; author acknowledged and is fixing it. This review does not claim an independent reproduction of that issue.

## Independently executed checks

- Build and typecheck passed. Enabled unit suite: 297 tests, 293 passed, 4 TODO, zero failed or skipped.
- Executed the author's complete browser harness independently: all checks passed, including real row removal and Undo, text flush before commands, failed request preserving editable text, stale row removal, local section movement, keyboard menu, and mobile bar. See `author-ui.log`. One authored hover assertion contains an unconditional true; the later actual hover assertion and remaining checks executed separately. This passing harness does not cover the issues above.
- Added isolated fixtures through repository commands for Put back and previous-day unfinished handoff; only the copy's handoffDone flag was reset to expose the morning card. Put back inserted its missing row. Browser then checked handoff Add → row Tomorrow → Undo → reload and Put back row Not today → command Undo → reload: all nine assertions passed. See `fixtures.ts`, `cross-entry.log`, `handoff.mjs`, `handoff.log`.

## Pending

Recheck the two confirmed defects and the author's keyboard-caret, mobile ellipsis width, and Cancelled-label placement fixes on the next candidate. This report is not release approval. Existing broad passing results remain applicable unless the fix changes those paths.
