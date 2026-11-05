# Independent Timeline pane review and live replay

No confirmed blocker in the executed checks. No application changes by reviewer.

At PR143 5116f6ae, the 29 pane checks pass in each engine. An independent closed-table grouped-row fixture moves Trip between groups, undoes it and then aborts its next set-values request: the persisted group and revision remain unchanged and a retry state is visible. Both engines pass.

After the release and follow-up merges, rebased the evidence tree onto main 96384eae (including PR142, PR146, PR148 and PR149). Build passes. The current rows.mjs suite passes 80 checks per engine, covering parent/sub-item drops, context parents opening under filters, manual close reset, and Esc cancellation in a peek. todos-many.mjs passes 32 per engine, including delayed and queued pending states and failure recovery. These are independent reruns of author scripts, not independent scenario designs.

An independent calculation-foot fixture creates a count on the seventh off-screen column, scrolls it to the end and compares header, row and foot positions: all x=800 and Count4 in each engine. No new defect found.

This is a local built-app/SQLite check. No Worker, real Postgres, real trackpad, physical device, or edge-drag replay by reviewer. Lead's release gates are separate evidence. The original PR143 design note has a redundant old sentence saying the closed table has no handle, superseded by the implemented rule.
