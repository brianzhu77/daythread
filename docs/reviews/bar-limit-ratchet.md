# Independent bulk-row limit review

Candidate 9c5c7e3e: no blocking finding.

Read the schema/domain limits, repeats' separate bound, new trashTogether traversal and client selection lookups. Independently reran all 11 bar-limit tests. Own domain.ts creates a synthetic balanced 10,000-row sub-item tree: deleting its root reaches all rows and one Undo restores the exact pages. A stale last item in a bulk edit and a missing last item in a bulk delete both refuse atomically. Local timing is not a Worker or phone performance result.

Independently reran big-view.mjs with 250 rows at 390 in Chromium and WebKit: All → edit and All → delete on both Table and Board, and each Undo, pass with no page errors. Build passed.

Not run: 10,000-row browser, relation-heavy bulk edits, Worker, real Postgres, deployed CPU/memory, physical phone, full suite, alignment or render budget. Author/Lead's performance measurements remain separate. PR130's command/UI bound needs checking on its merged head; this approval covers PR128 alone.
