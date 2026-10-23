# B34a task165 — 302025e review

**REVISE for the unconditional child-capacity contract.** Separate single-plus commands in the same A,B,b1,C card order put C in Other because `followers` is local to one plan-tasks invocation. Real execution in tests/evidence/ratchet-top3-165/separate-adds.ts outputs Top3[A,B,b1],Other[C]. A refresh/partial-add and other planning entries likewise need persistent/derived follower identity, not an ephemeral client hint. Report657a4b86. Leadf74ab962 asks server-derived ancestry shared by all planning entries.

No additional independent blocker found in the reviewed delta. Independent full suite384pass0fail11skip4todo(399total), typecheck/build pass. Author card UI fixture independently rerun at1280: all6 assertions pass, including Top3 parent/child order and correct Other. No source task words/id changes. Product71173df6 and Jazza5081790 separately report actual revision223 copied-row card/Add all passing at phone/desktop; these are attributed, not reviewer execution on that data.

Lead's 13:30Z fallback is a product decision under this known finite boundary, not an unconditional reviewer pass: 302025e improves today's actual card as independently reported by Product/Design. I found no second issue; child-first taps can still split child/ancestor through the same capacity issue. Communicated609b0df7. Final release still needs integration with current live B33/B5 tree and Lead's checks; this branch predates those changes.

No app changes, real data writes or deployment. Await replacement head, then verify separate adds, persisted refresh/partial add, ordinary plan-task/date picker and ancestor overflow. Reviewer server stopped after evidence collection.
