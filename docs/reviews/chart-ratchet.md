# PR157 independent calculations and rollback read

Candidate 983cadb9. Not cleared: three reproduced chart-data defects. No application changes made.

## Findings

1. **Year inherits the week's year.** A date axis stored with groupDateBy=week and chart.byYear=true puts Jan 1, 2027 under 2026. The settings UI reaches that state by switching Week to Year without changing groupDateBy. chartData slices the week-start group key. Compute calendar year from each row's actual date, or use an appropriate safe intermediate grouping for Year, without storing an unsupported groupDateBy on the rollback floor.
2. **Hidden middle date groups return as zero.** With rows in January, March and April, hide March. viewGroups excludes it, but gap filling reconstructs March as an empty group. The chart thereby shows a hidden real value as zero. Respect hiddenGroups when generating gaps, and ensure Year uses consistent visibility semantics.
3. **Drawing cap truncates the Data table too.** With a daily axis spanning Jan 2026 to Jan 2030, chartData keeps only the early 201 periods plus No value. The far row is absent from points. The UI correctly refuses to draw, but its Data table uses those same truncated points, contradicting the stated all-data fallback. Separate drawing-limit detection from complete (possibly paginated) data; do not lose actual groups or present the partial group count as the full count.

`tests/ratchet-chart.test.ts` has the original three failing assertions. All 11 existing chart tests pass.

## Actual rollback floor

Executed candidate seed generation, then imported the actual c2f3c5bc domain modules from a detached worktree. The stored chart view with byYear=true and groupDateBy=week is readable by old viewGroups. An old updateView rename preserves layout=chart, chart settings and the safe week groupDateBy. Thus keeping Year out of groupDateBy avoids the dateGroupName exception on this exercised path. The old LaidOutView source falls through unknown layouts to DatabaseTable.

This is actual floor *domain* execution and a render-source read, not an old-browser, database-store or deployed rollback test. No Worker, real Postgres, PGlite, browser, physical phone, screenshot, build or performance run by me. The candidate's linked-view path and old Duplicate view were not replayed in this fixture.

Reproduce:

    node --test tests/chart.test.ts tests/ratchet-chart.test.ts
    node tests/evidence/chart/ratchet-floor-seed.ts /tmp/chart-state.json
    node tests/evidence/chart/ratchet-floor.mjs /path/to/c2f3c5bc/worktree /tmp/chart-state.json

The seed and all tests use invented disposable data.
