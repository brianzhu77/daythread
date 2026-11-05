# Independent Files sweep review

Candidate 119f6eac (PR126): no blocking sweep finding in this review.

Read file-store.ts, both repositories' heldText implementations, the sweep endpoint, request account gate and account-deletion file cleanup. IDs are searched conservatively across stored text, regardless of current property type; a seven-day minimum age protects recent unattached uploads. Current account determines the prefix, not request input. Report mode lists candidates without calling delete. A repository/read/list failure propagates before deletion. R2 pagination and deletion batches were inspected, not exercised against Cloudflare.

Independent `tests/evidence/ratchet-files/sweep.ts` uses actual SQLite and PGlite repository implementations with invented workspaces and an instrumented file-store adapter. Both pass: report removes nothing; apply removes only an eight-day-old unheld Alice object; a trashed row holding a file under a property changed to Text, a trashed day body, the current Undo preimage, a young object, and Bob's object all survive. This tests repository retention, not merely JSON.stringify on a domain harness. The adapter models object inventory/deletion; no external files were deleted.

Author files.test.ts rerun independently: 10 passed, including ordinary folder storage, age/report/account separation, retained type values, templates, duplicate/move, bodies and Trash. Typecheck passed.

Not run by Ratchet: Worker/R2, deployed memory, real Postgres account isolation, a copy of Brian's workspace, physical iPhone, Take Photo or Home Screen app. Those are not implied by the PGlite or adapter checks. In particular the Lead's report-only copy and second-account gate remain separate. No production access or writes used.
