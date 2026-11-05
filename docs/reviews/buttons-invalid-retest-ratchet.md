# Invalid To-dos step retest

Candidate 15fa10b8 (on PR160) fixes the released PR155 catch regression. Ran the original 5c53d199 fixture unchanged: reopening followed by an invalid plan date now aborts the entire tap, preserving the done task, row count and revision. Accepted mixed done/open normal-refusal behavior still commits the eligible changes. Candidate 21 Buttons tests plus these two fixtures pass, 23 total.

The dedicated NothingToChange error is the only swallowed result; other DomainErrors propagate out of the disposable button state. No application edits and no browser/Worker/Postgres/native tests by me. This clears the fix candidate, not the deployed build until Lead releases it.
