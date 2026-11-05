# Independent PR151 review

Candidate 4d353ec1. Cleared within the executed scope. No application changes by reviewer.

Build and all 77 database-group tests pass. The built-app filter-group script passes in both engines at 1280 (33 checks each) and 390 (30 each), including Remove group and its Undo. The optional ChangeView notice is passed only by that destructive group action; existing callers continue with no notice. A linked view intentionally has no new command Undo because its settings save in the page, as disclosed in the PR.

An independent domain fixture verifies top-level any tries an unsatisfiable group, restores its tentative values and selects the next group; an entire satisfiable group can satisfy any; and an unsatisfiable all returns visible=false for the notice. No residual values from the failed branch remain.

An independent PGlite fixture loads the actual floor c2f3c5bc repository over the candidate's stored tree. A normal floor view edit preserves the original tree; its Duplicate view creates a tree-less copy while leaving the original intact, matching the explicitly accepted exception. The actual floor linkedViewOf/linkedViewJson path preserves the tree during an ordinary linked-label edit. The candidate reload sees the original unchanged tree and the floor name edit. Using old and new inView on the same rows confirms rollback widens all and narrows any. This is repository/PGlite and JSON codec evidence, not a browser rollback or real Postgres/Worker run.

No confirmed blocker found. The corrected release wording must remain: old-created rows may disappear on the current build without an old-build notice. Native Pinyin/keyboard check belongs to Jazz's assigned G2-5 validation; I did not run it. No native device, CSV export of a grouped view, To-dos browser grouped view, deployed Worker/Hyperdrive or independent full application suite by reviewer.
