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

## UI integration at 0111b219

Reviewed `dashboard-filter.tsx`, the drawn-view wiring and the shared header changes. Build passes with shipping CI dependencies. The sheet saves dashboard rules separately; widget menus and chips retain the widget's own stored view, while row drawing and creation receive the combined projection.

Independent 390 checks in `tests/evidence/dashboard/ratchet-filter-phone.mjs`: Chromium and WebKit **5/5 each**. These exercise opening the sheet, selecting/saving a global rule, fitting the sheet to the viewport, opening an unreadable-rule explanation from the widget, and removing the global rule; no page overflow or page errors observed.

Executed author's `filters.mjs` on my own built preview and synthetic store: Chromium **13/13**. Actual rollback code from my 9417eea2 checkout, against a separate synthetic store with real rule bindings: **7/7**, preserving dashboard rules and IDs through older-code writes. This is a SQLite domain rollback check, not a floor browser/Worker run.

Jazz's separate label-placement observation and the proposed Name-rule addition are not cleared by this head's evidence. Nested dashboard-owned groups are explicitly deferred by Jazz. Native Safari, Postgres/Worker and performance are not independently tested here.

WebKit `filters.mjs`: **13/13** on its own fresh store. UI head typecheck also passes. No additional reliability blocker found at 0111b219; the remaining visual placement and Name scope decisions belong to the separately announced follow-up.

## Name delta at 16829888

Source-reviewed the title marker in the domain, command schema and sheet. The fixed title ID bypasses name/type lookup, while changing between title and an ordinary property invalidates the old binding. Non-text title rules are refused. An additional independent fixture confirms the marker targets fixed titles across sources even when its display label matches a custom text property, and removing that marker rebinds to the ordinary property. Targeted tests **41/41 pass**, including all prior binding/group fixtures; typecheck passes. No new domain blocker. Browser/visual regating of this delta remains with Lead/Jazz; my earlier browser results apply to 0111b219.
