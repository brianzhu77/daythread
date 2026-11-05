# Independent PR161 review

Candidate 8419e638. Not clear: two independent domain fixtures fail.

1. Restore a row via delete-page followed by restore-batch with a Row added rule setting N=5. The restored row changes from N=1 to N=5 and the receipt reports the rule. Restore must not fire (§3/§5.7). quietActions names restore-pages, not restore-batch.
2. Create a Select condition isAnyOf(done), then change that property to Number. automationProblem returns null. The incompatible condition remains apparently healthy rather than showing the immediate broken warning required by §5.4. Step targets validate types; triggers only validate existence.

Reproduce: node --experimental-strip-types --test tests/ratchet-automations.test.ts. Both fail on this candidate. Existing tests/automations.test.ts: 11 pass.

Source review: matching is frozen before rule writes; each rule runs on a disposable clone and only successful copies are retained. Domain failures discard that rule's copy, pause it, and preserve the user's edit. A shared budget spans automation rules and remaining matched rules pause after exhaustion. The root button has a separate budget; this review did not measure combined button/rule request cost. No independent Worker, real Postgres, UI, performance, replay or rollback execution in this review. Candidate also predates the dedicated To-dos refusal fix in 15fa10b8; preserve that fix when merging the stack.

Evidence fixtures are synthetic, in-memory only. No user data touched.
