# B34b follow-up990d05f

**PASS.** Small domain-only delta excludes an arriving parent's already-present descendants from Top3 capacity. Reviewer late-parent.ts now produces Top3[X,Y,P,c], Other[], with c nested under P; original second-day.ts still passes. Full suite408/0/11skip/4todo(423 total), typecheck pass. Added domain tests also cover the extra-Z and genuine3-item-overflow cases. Prior ff0bbdd browser/rollback conclusions remain applicable: no client or stored-shape change in this delta. The original late-parent limit is fixed by990d05f, not by ff0bbdd.

# B34b task169 — ff0bbdd

**PASS within Lead00606815 explicitly accepted scope.** The late-parent capacity/section gap below is accepted for a separate follow-up, not claimed fixed. No other blocker found. Reviewer executed `late-parent.ts`: previous Top3 is P with child c, X, Y; individual taps c,X,Y,P produce Top3[c,X,Y], Other[P], with no nesting. The arriving P is counted in addition to its already-present child before capacity is decided; subsequent nesting refuses the cross-section pair. Expected3 parent slots with c under P. Message6bc583a5.

Independent normal suite407/0/11skip/4todo(422 total), typecheck/build pass. Reviewer original second-day.ts now passes, preserving4 rows in Top3 across two mornings. Author browser fixture independently repeated on fresh synthetic stores:1280Chromium taps6 assertions and390WebKit touch Add all5 assertions pass, including24/48px card tree, placements and reload nesting, no errors.

Lead b410a499 independently ran Supabase rollback round trip on copied revision224: nesting/tasks/save/reload intact on live9dea4ec and candidate; old build drops empty starter rows under Other/Events/Good Stuffs/Notes. This stated loss is attributed, not reviewer execution. Lead explicitly waived repeating that round trip absent new evidence; inspected `needsTemplateRows` side fix matches its reason. No additional schema/layout change.

Old B34a-carried pages retain their flat arrangement; source ancestry cannot be inferred until re-nested. Product/Jazz verified actual-row behavior and accepted flat top-level tap ordering. No production writes or deployment by reviewer. Roadbuster owns the late-parent capacity fix and must add late-parent and genuine overflow/child relocation cases. Acceptance does not convert the failing assertion into a pass.
