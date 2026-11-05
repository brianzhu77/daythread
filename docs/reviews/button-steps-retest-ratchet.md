# PR155 command retest

Candidate 4f6a4de8. Original review 30b7aebc against 68b8dcfa.

The three original failing fixtures now pass unchanged, as does the independent replay-after-intervening-change fixture. The candidate's 16 Buttons tests also pass (20 combined, zero failures). These include missing and trashed Open pages, unsafe URL refusal, strict mixed open/finished To-do rollback, combined Insert task limits, synced insertion/Undo and day-template identity.

Read the localized command diff: Open page/URL validation occurs before stored steps; Insert spends the shared task allowance; the To-dos bulk partial-refusal result becomes an exception inside the button's disposable command state, rolling back preceding steps too. This preserves the bulk bar's separate partial-success behavior. The refusal check currently parses the bulk receipt's wording; if that wording changes, retain the regression test or move to structured refusal metadata.

Command/retry review is clear within this scope. This does not complete the author's browser/native or Lead copy/Worker gates. No own browser, Worker, real Postgres, native keyboard or performance checks were run. Original candidate build passed; a new build was not run for this localized reducer change. No application changes made.

Run: `node --test tests/ratchet-buttons.test.ts tests/buttons.test.ts`.
