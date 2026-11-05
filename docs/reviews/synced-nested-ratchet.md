# Independent PR140 review

Candidate 27691e84, including live main 2bccf72e. Cleared within the tested scope. No application changes by reviewer.

Build and all 32 synced-record domain tests pass independently. The six new nested-block browser scenarios pass in each engine: syncing a database preserves rows and its home; copies show views; making pages/databases in a copy uses the original page as home; deleting the database line from a copy preserves the full-page database and its rows.

An independent domain fixture verifies deleting the original preserves its database and row, immediate Undo restores both shared places and the home, and a subsequent row rename makes the old Undo refuse while retaining the newer words and full-page database. That refusal is the existing global Undo rule, not a new defect.

The Chromium make/copy/delete/typing regression run passed its first 13 scenarios with no recorded failures. I stopped that broad run after both before-original deletion/Undo orders passed, then narrowed WebKit to the empty-block Backspace change and the 390 copy/delete/Undo path. Both focused WebKit cases pass. The full older suite was not completed in either engine; see the logs for exact executed cases. No Worker, real Postgres, native device, failed creation/retry, or CSV-inside-a-copy browser check by this reviewer.
