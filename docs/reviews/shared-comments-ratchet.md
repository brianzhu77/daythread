# PR165 shared comment lifecycle review

Candidate fff9371a. Not clear: Unsync here on the original/home leaves the shared comment targeting the newly ordinary line. The thread's home remains that page, and lineIdsOnPage(page, 'l1') still returns ordinary l1 because it accepts an exact ID without checking whether it remains in a shared place. The mark/underline callers use that mapping. The §4 rule says an unsynced copy carries no thread. Existing tests only unsync a non-home copy, whose suffixed ID avoids this branch. The home pane may keep its thread, but its ordinary line must not continue showing the shared mark/underline.

Independent fixtures: home Unsync mapping fails; restoring a non-home place first while all places were in Trash passes; unsync home, add reply, unsync another place, end sharing at the last place then Undo preserves the reply and shared visibility. Existing 16 line-comment tests pass. Source reviewed: shared line normalization, shown threads, automatic rehome after sharing ends, and UI mark/underline callers.

Run node --test tests/ratchet-shared.test.ts tests/comments-lines.test.ts. Synthetic domain execution only. No independent browser, real Postgres, Worker, native, rollback or performance run. The author-described search gap is separately assigned by Product; not independently exercised here.
