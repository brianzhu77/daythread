# PR165 retest at 66957845

Clear for the independently reviewed lifecycle scope. Three independent fixtures plus 19 author line-comment tests pass (22 total): home Unsync stops the shared thread from targeting its ordinary copy; all places in Trash then restore a non-home place first retains the thread; home Unsync, reply, end sharing elsewhere and Undo keeps the reply and restores shared visibility.

The fixture now calls threadLineIds, the wrapper used by marks/underlines, rather than the raw helper's default ordinary-line lookup; replies use the thread's new home page. These are API adaptations to the fix, with the same behavioral assertions. Source review confirms all UI mapping callers use that wrapper. A shared thread whose home has lost its place moves to a surviving live place, and while shared only actual places map to marks.

Run node --test tests/ratchet-shared.test.ts tests/comments-lines.test.ts. Synthetic domain execution only. No independent browser, Worker, real Postgres, native, performance or rollback run. Search is covered by the author test read/executed here, not an independent browser fixture.
