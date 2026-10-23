# B34b task169 — ff0bbdd

**REVISE for late-parent capacity/section consistency.** Reviewer executed `late-parent.ts`: previous Top3 is P with child c, X, Y; individual taps c,X,Y,P produce Top3[c,X,Y], Other[P], with no nesting. The arriving P is counted in addition to its already-present child before capacity is decided; subsequent nesting refuses the cross-section pair. Expected3 parent slots with c under P. Message6bc583a5.

Independent normal suite407/0/11skip/4todo(422 total), typecheck/build pass. Reviewer original second-day.ts now passes, preserving4 rows in Top3 across two mornings. Author browser fixture independently repeated on fresh synthetic stores:1280Chromium taps6 assertions and390WebKit touch Add all5 assertions pass, including24/48px card tree, placements and reload nesting, no errors.

Lead b410a499 independently ran Supabase rollback round trip on copied revision224: nesting/tasks/save/reload intact on live9dea4ec and candidate; old build drops empty starter rows under Other/Events/Good Stuffs/Notes. This stated loss is attributed, not reviewer execution. Lead explicitly waived repeating that round trip absent new evidence; inspected `needsTemplateRows` side fix matches its reason. No additional schema/layout change.

Old B34a-carried pages retain their flat arrangement; source ancestry cannot be inferred until re-nested. Product/Jazz verified actual-row behavior and accepted flat top-level tap ordering. No production writes or deployment by reviewer. Replacement head must add late-parent and genuine overflow/child relocation cases before pass.
