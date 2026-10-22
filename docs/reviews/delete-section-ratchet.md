# Delete/Undo section boundary review — task #116

**PASS: PR #8, a068e72.** Independent review by Ratchet. No remaining blocker found within this change. Only synthetic local workspaces were mutated.

## Behavior and evidence

On the original UI candidate 055ca74, independently ran the boundary harness on fresh SQLite fixtures at 1280 and 390: 6/6 cases at each width. Delete at a task/bullet end before a role heading and Backspace at that heading start are silent no-ops. A selected range can still remove the heading. Undo and save/reload restore its semantic role.

Additional independent browser cases passed: plain paragraph before Other is protected; Backspace at each of four role headings is protected; custom headings remain normally editable; headings on document pages remain normally editable, including Undo/reload. The first extra harness run used an incorrect page URL and was corrected; it is not a product failure.

Independent domain checks on final a068e72 passed:
- A malformed daily template Other is repaired on ordinary save.
- An existing role prevents a second restored template role.
- A same-title user heading and a template-shaped heading ID on a document page remain custom.
- Remove original Other, create a replacement via ordinary task planning, restore original: exactly one Other remains; replacement keeps the role and restored original keeps its words as custom.

The last scenario failed on a5b1980, confirming the metadata fallback duplicate-role defect. a068e72 fixes it by resolving restoration candidates against already claimed roles. The final revision changes domain code only; UI guard evidence from 055ca74 remains applicable.

Synthetic rollback compatibility passed through new repair → old checkout 8b494b2 (same application code as live 89fe761) save → new save, retaining exactly one Other. This is a domain save/read test, not a browser rollback test or a claim about real user data.

Final typecheck passed. Final full suite: 343 passed, 0 failed, 11 skipped, 4 TODO (358 total). Final production build passed. Initial UI candidate build/typecheck and suite also passed (340 passed).

## Scope and limits

Collapsed boundary guards preserve role headings; selected-range deletion remains intentional. Repair happens through normal domain save/section creation paths, with no out-of-band real database edits. This review does not certify every historical malformed workspace. Native IME/accessibility assistive technology was not separately exercised here. Designer WebKit checks and Lead real-database-copy rollback checks are separate evidence owned by those reviewers.

Scripts: tests/evidence/ratchet-delete-116/. Logs from this run: /private/tmp/ratchet116/. Own QA services on ports 3426–3428 stopped after checks.
