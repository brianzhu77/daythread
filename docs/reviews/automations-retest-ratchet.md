# PR161 retest

Candidate b170c532. Both findings are clear: the two original independent fixtures pass unchanged, alongside the author's 12 automation tests (14 total, zero failures).

Restore-batch leaves restored N at 1 and reports no automation. A Select isAnyOf condition whose property becomes Number immediately reports Status changed type. The localized changes use the correct action name and validate the condition operator against the property's supported operators.

Run: node --test tests/ratchet-automations.test.ts tests/automations.test.ts.

This is synthetic domain execution plus source review. No independent Worker, real Postgres, browser, native phone, performance or Button-property rollback test. The earlier clone-per-rule/frozen-match review remains applicable; deployment gates remain with Lead. Evidence is scoped to the two requested fixes and does not claim measured whole-request cost.
