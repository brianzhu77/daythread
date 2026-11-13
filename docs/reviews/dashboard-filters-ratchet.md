# Dashboard step 3: early domain review

Reviewed 467c50e9 against 0e17612c, following revised design decisions through Lead 8db52bde. No UI exists in this head. Reviewer: Ratchet.

## Original finding at 467c50e9: empty group is lost on + New

Confirmed by an independent fixture: a Board widget has no own filters, groups by Status, and the dashboard asks for Status=Done. Adding in the Board's No Status group produces Status=Done and `visible: true`. Ordinary `newRowValues` preserves the clicked empty group by clearing that property. The new dashboard merge reintroduces the dashboard default because the cleared property is absent from `mine.values` and not mentioned in the widget filter.

This violates §7.4's grouping precedence: the clicked group must win, even if that leaves the new row hidden by the filter. Preserve explicit clearing for group and subgroup defaults when merging. Test both empty group and empty subgroup, alongside nonempty grouping and contradictory widget filters.

Reproduction: `node --test tests/ratchet-dashboard-filters.test.ts`. At this head: 2 pass, 1 fails (`done` instead of undefined).

## Independently verified

- All 33 author dashboard tests pass on shipping CI dependencies.
- My never-bound projection fixture passes: drawing reads the newly added matching property without writing; the next explicit filter save binds it; deleting the bound property and adding a replacement does not redirect that binding, including after another save.
- My property/option rename fixture passes: both retain their IDs and the rule still reads its old bound option even after an unchanged rule save.
- Source review confirms options are stored by source IDs, filtered views combine whole groups without mutating stored widget views, and property identity changes rebind deliberately. Dashboard-only `widgetFilter` branches isolate new default behavior from ordinary views.

## Limits

No UI/browser/Worker/Postgres or independent rollback run for this head. No claim of implementation clearance while the empty-group regression remains. The earlier design experiment proving the old default-overwrite behavior is separate from this new grouped-row regression.

## Repair at aa27a5be

The empty-group finding is repaired. My unchanged empty-group assertion and an additional empty-subgroup fixture both pass. A clicked nonempty group is retained while the empty subgroup stays empty and hidden by the dashboard filter. The fix marks group/subgroup properties as occupied defaults before the merge.

Independent targeted run: **38/38 pass** (34 author tests, 4 reviewer fixtures). Typecheck passes on shipping CI dependencies. No remaining domain blocker from this early review; UI, browser integration and actual rollback remain separate checks on the finished implementation.

Full local suite at the repaired domain head with my fixtures: **1056 passed, 13 skipped, 0 failed**. The skips are not counted as verified Postgres coverage.
