# Released layout follow-up

Requested by Lead c0d9ed67 after release 73144136. Scope is source reads and domain retests, not an independent deployment or visual gate.

- PR156 a378c1af: original required-coverage findings resolved. Trash is required independently, a database title icon is seeded/measured/required, and breadcrumb, Linked from, Move to, relation chips and Timeline table are added. Reviewed fixture and measurement diff plus localized subpage, database-title, Move to and Linked from CSS. No additional source blocker. Uploaded image and Days sidebar icon remain outside this evidence.
- PR157 2586db15: original three fixtures pass unchanged: Year after Week, hidden middle date group, complete real points beyond drawing limit. Candidate 15 chart tests pass, total 18. Read revised year/month grouping, hidden group handling, capped-data fallback and cumulative No value exclusion. No additional finding in this scope. UI fixes have other reviewers' evidence, not mine.
- PR159 d0dce892: reviewed fa8032f0 application change and Esc-release fixture. Board/Calendar cancellation retains justDragged until pointer-up, then clears after the click turn; no extra source blocker. A pointer released outside the document can leave a one-click suppression until a later pointer-up; this is a remaining minor behavior, not data loss. No independent browser drag run.

No Worker, real Postgres, native device, visual gate or performance checks executed in this follow-up. The original rollback-domain check used the then-floor c2f3c5bc; the current rollback floor is now 9417eea2 and must not be lowered.
