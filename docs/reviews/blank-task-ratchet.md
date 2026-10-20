# Blank task and morning card count — task #78

**PASS db3cadb**, including unchanged domain fix 469cb63 and the subsequent card-count change. No migration or storage mapping changes.

On two fresh read-only SQLite backups of Brian's actual database, I built and ran the application with provider keys disabled:

- At 469cb63, independently reran the author's ten browser checks at 1280/390: card and Tasks Open contain only the named Calendar task, Oct19 TODO - Other still ends in its empty checkbox, actual typing makes that task appear in Open and on the card. A separate SQLite query confirms the same original task id now has the entered title; no replacement identity.
- At db3cadb, independently reran the author's count harness on a clean copy: card open has no other line; Later gives one other open task; reopen and actual + removes the other line. A separate SQLite assertion confirms the named task is planned on Oct20, the blank task still exists with its empty title and layout remains 4. Final card-open screenshot visually checked. No page or console errors in either browser run.
- Targeted morning-card and Upcoming suites: 21 passed. Source diff confirms one trim-based domain predicate covers relevant list queries and card draft eligibility, while the second commit only passes currently visible suggestion ids into FactsStrip. Editor content and stored tasks are preserved.

Evidence: tests/evidence/ratchet-blank-78. browser-base.log and its screenshots describe the earlier 469cb63 count semantics (one other while card open); browser-count.log and card-* screenshots describe the final accepted db3cadb semantics. Browser harnesses are author-written and reviewer-rerun; the identity and plannedOn assertions are additional reviewer checks. Full suite/typecheck results reported by the author are not claimed as separately rerun here. Physical phone/IME not tested. Reviewer made no production writes, model calls or deployment.
