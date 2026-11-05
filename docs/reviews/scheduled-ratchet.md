# PR163 scheduled rules independent review

Candidate 47ff26a2. Not clear against the current §6 schedule-version contract.

Reproduced: run a daily rule at 09:00; edit its scheduled time to 10:00, preserving the existing repeat marker as the editor does; tick at 10:00 that day. Only the earlier row exists. `last` stores a date and suppresses the new upcoming time; there is no schedule version. The design requires a version changed on edit/resume. Decide the intended behavior, then make the marker and generated effect IDs agree with that identity. Merely clearing last can collide with the existing `every:ruleId:date` IDs.

Independent failure experiment passes: Add row then Edit rows with an invalid numeric value drops the added row, keeps existing N=1, pauses the rule and leaves last unset. Object.assign(state, copy) only occurs after all steps and settleSynced succeed, so this tested partial failure does not leak the copy. Author's 15 automation tests pass, including retry/latest-only/resume/failure cases. Independent fixtures: one pass, one fail.

Run: node --test tests/ratchet-scheduled.test.ts tests/automations.test.ts. Synthetic in-memory domain data only. No independent real Postgres concurrency, Worker, UI notice, native, performance or rollback test. Author's reported Postgres race is not counted as our evidence.
