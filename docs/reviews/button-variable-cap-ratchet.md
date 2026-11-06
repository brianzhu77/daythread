# PR167 cap review at 93837cc6

Button-step sharing and atomic refusal pass independently. Two slow steps over 50 picked rows consume exactly 100 readings and succeed. Over 51 rows, with an earlier Add row, refusal leaves the complete workspace byte-for-byte unchanged: no partial row changes and no added row. Author's 101/100/cheap-101 boundary test also passes.

One reproduced scope gap remains against buttons.md's “a tap may do that 100 times at most”: root button steps use one newBudget, then triggered rules receive another newBudget in runAutomations. A root property button over 100 rows using prop("twice")+1 consumes 100 whole-workspace readings; a property-edited rule writing format(prop("twice")) over those same 100 rows also runs, reports Follow in ran and no pause. Thus the tap gets 200 readings. The independent fixture expects the triggered rule to pause after the root has exhausted the command allowance, keeping the root edit and dropping that rule's staged effects, matching the existing automation limit semantics.

Share the remaining reading allowance across root and triggered-rule execution, or obtain an explicit separate-budget decision and adjust the contract. No partial-data-loss defect is claimed; this is the scope of the CPU cap used to settle the earlier cost concern.

Run node --test tests/ratchet-variable-cap.test.ts tests/button-variables.test.ts: 13 pass, one root/rule cap failure. Synthetic in-memory only, no new Worker, real Postgres, browser or native run.

## Retest after Lead decision f0cda13c

The accepted contract is now 100 readings for the root button plus 100 shared by all rules it triggers. The previous expectation of one shared root/rule allowance is superseded.

On candidate 93837cc6, the updated independent regression and author variable tests pass: 15 tests, zero failures. Independent checks cover the button's exact limit across steps, whole-button rollback over the limit including an earlier Add row, a button consuming 100 followed by a rule consuming another 100, a second rule receiving no fresh allowance, and a failing rule rolling back its earlier Add row and property changes while preserving the successful button.

Conclusion: clear against the revised allowance contract. No runtime code changed. These are domain tests in Node; combined Worker/Postgres timing and the browser refusal notice remain the Lead's gate, not independently verified here.
