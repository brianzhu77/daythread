# B47 independent review

Candidate: **6f549e7**, fix/review-draft, based on main 18a8939. Reviewer: Ratchet, task #192.

**Pass.** His stored evening draft no longer blocks Draft my day. Its three tasks and two links retain priority through the model run, a failed run and Retry, reload, and adding the tasks to today's plan.

## Independent verification

- Full suite **478 passed, 0 failed**, 11 skipped, 4 todo. Typecheck and build pass.
- Copied Product's read-only envelope, asserted revision 356, and extracted `.data` to a new `/tmp/rb-b47/ratchet-ws-356.json`. The original dump was not written. All browser runs used separate disposable SQLite stores.
- **No-key stand-in, exact copied workspace:** independently ran the author's card checks at 1280 Chromium and 390 WebKit, with an additional assertion that the stand-in retains its Simulated badge. Before the run: no Simulated on the review's card/Related, correct status, three evening tasks first and two Related links. After the stand-in and reload: picks preserved, no duplicates, no second Draft my day, and the stand-in remains explicitly labelled.
- **Real-run path, local provider fixture:** 1280 Chromium success and 390 WebKit failure followed by Retry. The fixture exercises the actual server function, request building, model ledger, structured-response validation and persisted result. No paid/external model call.
  - Initial review draft permits Draft my day. Evening picks are copied unchanged to `draft.evening` and remain first while drafting.
  - Fixture selects one evening task twice and one valid additional task. The evening task appears once; the added task appears after the evening/carry rows as Drafted for today.
  - Related keeps both evening links before the model's additional selection and stays within the two-link limit.
  - A malformed first structured answer fails with Retry; all evening picks remain before and after Retry succeeds.
  - Reload retains the same rows and labels. Add all tasks puts exactly the evening three into Top 3 and the model-only task into Other.
  - No Simulated badges on the real fixture run, and no page errors.
- The model fixture adds one named synthetic task on a separate document to the disposable copy, allowing it to verify a model-only candidate that is not already yesterday's carry. The no-key browser runs leave that copy unaugmented.

## Review notes

A run or a `proposals` field identifies a card draft, preserving the no-key stand-in's label. The stored review draft has neither. The same helper drives the server guard and card rendering. `carryEvening` is evaluated from the previous draft before replacement; the persisted result and failed-run transition retain that field, and Retry carries it again. The card merges evening tasks, carry tasks and run tasks with identity deduplication; Related deduplicates before its usual limit. Model output and provenance remain separate from evening picks.

The review-step line is the specified text in the quiet class, confirmed in the diff; its design review was Jazz's. This report does not claim a separate browser exercise of that review screen. Existing model budget/owner/expiry behavior is unchanged and covered by the suite; no new production call or live-row edit was performed.

Evidence: `tests/evidence/ratchet-b47/`. `model-card.mjs` runs the local fake provider and app with explicit loopback model base URL; `run-standin.mjs` runs the stand-in against an exact copy. Initial fixture runs used the wrong button name Add all, timed out after otherwise successful checks, and were excluded. Final runs use Add all tasks and pass through plan placement.
