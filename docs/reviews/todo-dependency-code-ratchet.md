# Independent PR168 dependency review

Task343. Original candidate 8c16a4ee, subsequently reviewed change 44cf0b2a. No runtime fixes made.

## Result

**44cf0b2a needs its deleted-endpoint cycle-check change reverted or repaired before release.** Product withdrew that change in message 5e00e31c after the resurrection path was identified. The original candidate's cycle guard handled this case.

A waits on B; B waits on C. Delete B's last line, then make C wait on A. The new `standingLinks` filter permits this because B is absent from tasks. Paste a saved B line into another page: `save-editor` restores its canonical task from `deletedTasks`, and all three stored links become active. The resulting A→B→C→A cycle violates the accepted contract. Command Undo is not the only resurrection path; the unchanged floor also has this editor-save behavior. A fix limited to new-build resurrection guards is insufficient for rollback.

Fixture: `tests/ratchet-task-links.test.ts`, last case. Combined run against 44cf0b2a: **14 pass, 1 fail**, comprising four independent cases and eleven author cases. The independent failure asserts acyclicity after pasting the old task back. No timing claims are derived from this run.

## Evidence that passed

- Canonical copied task remains a blocker when its original line disappears; the last live occurrence entering Trash suspends it. Restoring a different copy first reactivates the same link.
- Cancelled/trashed intermediates still prevent cycles. A mixed removal/addition that later fails is atomic.
- A stale Undo cannot restore a removed link over a newer reverse link; the newer graph is unchanged.
- Reran the author's repository/floor fixture, adapted to isolated PGlite with actual floor 9417eea2. Ten checks passed: floor rename, tick/reopen, plan to next day, another task's deadline, delete last line and Undo; protected links survive and both blockers return. Added an explicit assertion that the planned day survives. This is **PGlite, not real Postgres**. The author's real Postgres results remain their evidence.
- Source inspection: `task_links` is workspace-scoped, writes under the workspace transaction, and old inverse diffs lacking `links` preserve the table. No document/date writes occur in `link-tasks`.

## Limits

No independent browser, Worker, real Postgres, native phone, Timeline-arrow, or performance run. Mark/picker visual review belongs to Jazz. Candidate limits (50 blockers / 5,000 links) were not independently measured. Product accepted retaining deleted-endpoint links, with counts/allowances treated separately from cycle safety. A repaired candidate still needs the resurrection regression rerun.

## Repaired candidate a406565e

**Clear on the four reviewed contracts.** The deleted endpoint once again participates in the cycle check. The saved resurrection scenario now refuses C→A before B returns, with `Would make a loop through B (deleted)`, and pasting B back leaves an acyclic graph. The fixture's expected refusal text was updated for that accepted copy change; its restoration and acyclicity assertions remain.

All 15 domain checks pass (four independent, eleven author), and the ten-check actual-floor/PGlite repository rerun passes again. The storage, occurrence, atomicity and stale-Undo conclusions above stand. No runtime code changed in this evidence branch. Browser/picker visuals, real Postgres, Worker and measured limits remain outside this independent retest.
