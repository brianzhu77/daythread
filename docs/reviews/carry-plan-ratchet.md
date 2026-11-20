# PR223 B101 backstop review

48e495de againstb4d60e9e: NOT CLEAR. Independent reducer probe tests/ratchet-carry-probe.ts demonstrates two legacy identity gaps. An old recipe2 open task line carried today either through matching model new_todo or with no original matching line in request keeps no from and becomes recipe4. After applying today, the old draft still offers it, and applying there creates a second task. Matching model blocks must inherit recovered identity; missing source needs retained legacy matching identity/status rather than silent recipe promotion.

Existing six author tests pass independently. No reviewer runtime fixes, servers, production writes or paid model calls. Exact scope read from Leadbf60ec67; no-skipped-draft/no-model-lines remains accepted limit. Handed back to author for repair.

Third matching branch also reproduces: matching model existing task item (taskId without block) after current Apply does not suppress legacy old line; old Apply creates task2. Sent followup while original repairs ongoing.

Recheck88c302dc option2 closes three original branches while the old page stays untouched. Sweep96 and carry6 pass. NOT CLEAR e2f546d2: after today applies the carried line, save an unrelated note on the old page. Old band changes from hidden to offered; Apply creates task2 in all three probe modes. linesCarriedOn dynamically returns false once old page becomes actedOn, undoing completed handoff. Needs durable distinction between acted before vs after handoff.

8ade65f8 stored took pointer closes original probes and old-page later edit. NOT CLEAR62b1a000: prepare carried successor while old open, apply old, then store prepared successor and apply it:2tasks in all3matchingforms. Pointer validation checks existence but not intervening source decision. Independent race script tests/ratchet-carry-race.ts; author sweep starts after successor stored and misses this interleaving. Returned to author for storage-time revalidation.

2530a5c3 closes storage-decision race; independent asserted carry modes1task and existingtask2matches own exactc4a7fe02 baseline (accepted B104 exception). OriginalposteditprobesPASS, draft53/typesPASS. Still NOT CLEARb49eef07: failedNov21→readyNov22handoff→RetryNov21 withfreshUUIDs/modelnone revivesbothbands; missingsourceApplyboth→2tasks. RetryreplacesreferenceditemID. ExplicitRetryhook permitspastpage; authorchainusesrestartingdeterministicIDandRetrybeforeforwarding, missingthiscase. Own tests/ratchet-carry-chain.ts.
