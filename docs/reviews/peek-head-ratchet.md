# Independent peek header review

Candidate 2a991bad (includes PR121 at 4779a33a): no blocking finding in this review.

Independently reran `tests/evidence/peek/head.mjs` in Chromium and WebKit: center and side paths, narrowest 420px side panel, all five controls fitting, folded path, Esc closing its fold first, breadcrumb navigation saving freshly typed words, Back restoring the peek and words, and close retaining the host page. No page errors.

Own `tests/evidence/ratchet-peek-head/esc.mjs` checks the changed RowMenu handler in both center and side peek in both engines: one Escape closes Row actions but leaves the peek; the next closes the peek. All passed without page errors.

Build and typecheck passed. Unit tests: 713 passed, 0 failed, 5 skipped. Not run: Worker/real Postgres, real phone, render budget or alignment gate. Held-save races were covered in the separate PR120 review, not repeated on this stack. Initial exploratory body-menu probes targeted a day-only task menu on a document row and then a context menu that did not open; those were harness failures and are not product findings or coverage claims.
