# B34a task165 — 1f2ad38 review

**PASS within the explicitly accepted interim scope.** Candidate 1f2ad38 includes live B33 main2750edc. Server-derived ancestry now applies to both planning commands; it no longer trusts a client `follows` hint. The previous separate-plus blocker is fixed: reviewer-authored `separate-adds.ts`, now sending no hint, independently produces Top3[A,B,b1,C], Other[].

Independent current-head checks: full suite **397 passed, 0 failed, 11 skipped, 4 todo** (412 total); typecheck and production build pass. The suite includes separate adds, partial add followed by rest, ordinary plan-task/date-picker semantics, child-first then parent, and absent-parent capacity. Earlier reviewer browser fixture on302025e passed all six assertions; it was not rerun by Ratchet on this head. Jazz independently executed current-head actual-row copies at390 WebKit touch and1280 Chromium: card order, reverse order, partial add/reload/Add all all pass with no page errors (5e8b9c36). Product independently checked current-head copied revision224, including reverse order (7150e7d9). These browser/current-real-row checks are attributed, not Ratchet executions.

## Confirmed accepted limit: second morning

Reviewer `second-day.ts` executes nested A/B/b1/C on Oct22, carries each independently to Oct23, then carries each to Oct24. Oct23 is Top3[A,B,b1,C], Other[]. Oct24 is Top3[A,B,b1], Other[C]. Flat carried rows do not retain parent identity, so b1 consumes a slot on the following carry. The exploratory assertion deliberately exits1 to expose the missing durable ancestry; it is outside the normal suite and is not described as passing. Evidence: `tests/evidence/ratchet-top3-165/second-day-output.txt`.

Lead explicitly accepts this limit until B34b in message2af13851 (Oct23 09:14Z), declines an interim ancestry field, and keeps B34b immediately after B35. Re-nesting restores the source tree for the next carry. Product recorded the limit in checklist mainae0bd26 and owns the usage trigger (6910427e). Durable ancestry plus a two-morning regression is required in B34b; this review does not claim it works today. Child-first tap order also remains flat until B34b.

No application changes, production writes or deployment by Ratchet. Lead owns final integration/release checks.

## Prior review (superseded by current result)

# B34a task165 — 302025e review

**REVISE for the unconditional child-capacity contract.** Separate single-plus commands in the same A,B,b1,C card order put C in Other because `followers` is local to one plan-tasks invocation. Real execution in tests/evidence/ratchet-top3-165/separate-adds.ts outputs Top3[A,B,b1],Other[C]. A refresh/partial-add and other planning entries likewise need persistent/derived follower identity, not an ephemeral client hint. Report657a4b86. Leadf74ab962 asks server-derived ancestry shared by all planning entries.

No additional independent blocker found in the reviewed delta. Independent full suite384pass0fail11skip4todo(399total), typecheck/build pass. Author card UI fixture independently rerun at1280: all6 assertions pass, including Top3 parent/child order and correct Other. No source task words/id changes. Product71173df6 and Jazza5081790 separately report actual revision223 copied-row card/Add all passing at phone/desktop; these are attributed, not reviewer execution on that data.

Lead's 13:30Z fallback is a product decision under this known finite boundary, not an unconditional reviewer pass: 302025e improves today's actual card as independently reported by Product/Design. I found no second issue; child-first taps can still split child/ancestor through the same capacity issue. Communicated609b0df7. Final release still needs integration with current live B33/B5 tree and Lead's checks; this branch predates those changes.

No app changes, real data writes or deployment. Await replacement head, then verify separate adds, persisted refresh/partial add, ordinary plan-task/date picker and ancestor overflow. Reviewer server stopped after evidence collection.
