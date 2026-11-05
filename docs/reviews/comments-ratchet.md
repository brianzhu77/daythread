# Independent PR150 review

Candidate 05354a5c, containing the icon stack at 4691f591. Changes requested. No application changes by reviewer.

## New unsent words are erased by an earlier successful send

Confirmed in both Chromium and WebKit on the built app with a throwaway SQLite store:

1. Open Comments on Notes and type `First sent`.
2. Send and hold the add-comment request.
3. While it is held, replace the still-editable field with `NEW WORDS typed while sending`.
4. Release the request.

The stored comment is `First sent`, but the field is empty and no session draft remains. Thus the newer words are neither stored nor recoverable from the draft. The fixture asserts the newer words remain and fails. The problem is CommentField's unconditional draft deletion and setBody('') on success, despite accepting onChange while saving. ThreadView's reply/edit success also closes its field, so all three field modes need protection, not only the new-comment composer.

Clear only a matching submitted generation or make the field noneditable during its request; retain failure/retry and lost-answer operation identity behavior. No live-account writes.

Build and all 10 Comments unit tests pass independently. Source review confirms a separate comment_threads table, owner-scoped workspace queries, thread versions on destructive changes and preservation of the normal Undo slot on adding/editing. This does not replace an adversarial account test or a real Postgres/Worker run. The normal browser baseline passes all 18 scenarios in each engine, including stale edits, lost-answer retry, draft reload, Undo, search/export, phone width and a pane beside a peek. Those baseline cases do not type new words during the send. Native-device checks have not run by this reviewer; the confirmed words loss is the current handoff.
