# PR155 post-release review

Candidate 6b4144c5, compared with previously reviewed 4f6a4de8. The Lead's 371ebb4b partial-success decision replaces the original strict To-dos expectation for normal task refusals. It still requires invalid-value failures to abort the entire tap.

Confirmed bug: Add row, then Edit To-dos with Status Open and Planned {start:'2026-99-99'}, seeded with a done task. edit-todos reopens the task, then the invalid plan date throws. runButton catches every DomainError on the same mutable state, keeps going, and commits both the row and reopened task with receipt `Added to Runs`. Revision increases and no failure is reported. This is not the accepted expected-refusal case. Invalid or unexpected errors need to propagate; expected per-task refusals need a separate result, or a staged copy with explicit validation.

`tests/ratchet-buttons-current.test.ts`: accepted done/open Planned partial-success scenario passes; invalid-date rollback assertion fails. Existing 16 Buttons tests pass. This reproduction uses a malformed stored step; the standard date input does not deliberately emit this date, but stored steps are untrusted data and the contract explicitly includes invalid values.

Read UI/CSS changes since 4f6a4de8: portal/menu stacking, editor focus/Esc guard, blank placeholders and phone ordering. No additional source finding there. I did not independently re-execute browser/native checks, Worker or Postgres for this review. All data are invented; no production writes or application fixes.
