# Dashboard storage independent review

Candidate d84d9f3b, before UI. Task348. Own isolated review tree uses shipping `daythread-ci/node_modules`; no browser, model, user data, production writes or floor rollback run.

## Findings

1. **Same-row singleton move loses the widget.** A dashboard with one row and one widget receives `moveWidget` naming that row with `beforeId:null`. It succeeds with `dashboard.rows=[]`. `leave` removes the emptied row, and the same-row path does not put it back. Keep/refuse unchanged; the UI should avoid sending an unchanged drop (Jazz06c36e09).
2. **Duplicate cannot copy held settings after a property deletion.** Set a widget filter on a source select, delete that property, duplicate the widget. It throws `Invalid view`. `newWidget` uses `cleanView`, whose new-view checks reject the stored columns/filter; `updatedView` correctly preserves held settings. Duplicate needs a checked identity allocation with preservation of its own stored settings. A plain source-property deletion can affect this even without a filter.
3. **Dashboard creation bypasses the host view cap.** Fill host views to the existing limit of 50; `addDashboard` adds another whereas `addView` refuses `Too many views`.

All reproduced in `tests/ratchet-dashboard.test.ts`. Author's 18 dashboard tests pass; independent tests have two passes and three failures.

## Independent passing evidence

- Stale placement with the old expected revision refuses without mutation. Retrying the same action/operation at the current revision preserves the concurrent widget name, and receipt replay is inert even with the old expected revision.
- An unrelated widget settings edit preserves future stored placement widths and reserved `dashboard.filter`.
- Source and schema read supports separated settings/placement intents. Global latest-operation Undo matches current implementation.

## Remaining step-1 checks

UI is unbuilt: full-page/day-link presentation, inert edit mode/gestures/no-op saves, per-block registration, source Trash/deletion states, performance and keyboard/menu behavior are not verified here. Floor9417eea2 rollback/persistence remains unrun. Whole-dashboard Duplicate is separately tracked by Lead ad6dae7b (plain menu `addView` currently refuses), including fresh widget/view ids. Per Lead's corrected contract, copying a database with its page/template can retain widget ids under a new host; verify commands stay host-scoped.

## Retest 4d1074c1 / 97f8987e

All three original findings are repaired. No-op moves now refuse `Already there` with state intact; widget duplication copies held settings as stored; host view cap applies to both add and duplicate-dashboard. The stale-placement fixture now includes a second row to keep its move meaningful under the accepted no-op rule. Independent whole-dashboard duplication preserves a missing source's held filters, future placement widths and reserved rules, deep-copies settings, and refuses a duplicate-id map atomically. Six independent fixtures pass.

On 4d1074c1, complete suite: **1,046 pass, 13 skip, zero fail**. Typecheck found the author's reported nullable-array guard issue; 97f8987e changes only that cast in the domain, plus initial unverified menu wiring.

A newly accepted rule remains unmet on 97f8987e: Jazz c80ba341 specifies that a same-row swap keeps each widget's own width (cross-row swaps exchange). Independent 4/8 same-row swap fixture fails: code exchanges the widths. This is a new specification delta, not failure to repair an original finding. Reported51b5bef4.
