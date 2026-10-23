# B28 independent review

Candidate: bf2857c (`feat/task-tree`). Reviewer: Ratchet. Task 174.

## Verdict: revise

A valid pair of page trees can produce a cycle in the derived cross-page ancestry and hide tasks from lists. Oct 22 has A > B, Oct 23 has B > A. Plan A on Oct 23 and B on Oct 22. `taskAncestry` selects A→B and B→A; `asTaskTree([A,B])` returns an empty array. Both open tasks disappear. This is reproduced through ordinary domain commands, not a fabricated ancestry map: `tests/evidence/ratchet-b28/cycle.ts`.

Lead ae4a02bd accepts keeping planned-day precedence and dropping the older source edge only when a cycle forms. Preserve every input task exactly once, including cyclic/unresolved components; add randomized coverage of this invariant. Source recency must be retained long enough to make that decision.

## Independently executed checks on bf2857c

- Full suite: 427 passed, zero failed, 11 skipped, four todo. Typecheck and build passed.
- Author's browser fixture rerun on a new disposable SQLite store: six assertions each at 1280 Chromium and 390 WebKit. Today order, two levels, parent-title/child-checkbox alignment, outside-parent label, Upcoming and Review plan cards passed, with no page errors.
- Additional prepared synthetic tomorrow draft (no model calls): six suggestions out of order became P > c1, c2 > g; c3 names absent R; Q remains a root. Removing P retains five suggestions and c1 names P. Passed in both browsers. Scripts: `draft.ts` and `tomorrow.mjs` in the evidence directory.
- Logs preserved in evidence directory. Initial server launch used a non-listening module; browser checks were rerun against a confirmed Vite preview server. Initial draft setup lacked tomorrow's page; corrected with ensure-day before the successful browser run. Neither harness setup failure is a product finding.

Only disposable data was changed. Native keyboard checks are outside this review. Real-row product observations are Bumblebee's evidence, not claimed as independent reviewer execution. No app code was changed.
