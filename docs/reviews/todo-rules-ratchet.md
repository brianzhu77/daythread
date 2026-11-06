# PR173 independent trigger and floor review

Task345; candidate b9418858. **Needs a fix to the once-per-task added trigger.** No runtime changes made here.

## Confirmed defect

With an active “A to-do is added” rule that creates a Log row, create a task with words and let it save. Erase that line's words and save, then type new words into the same line and save. Its canonical task ID remains the same throughout, but a second Log row is created.

`todoSources` compares projected nonblank rows, so an existing blank task is absent from `wasRows` and its next words look like a new row. Checking `before.tasks` identity as well would distinguish this from first saved words. The current accepted contract is once per canonical task, not once per transition from blank to nonblank.

Independent fixture `tests/ratchet-todo-rules.test.ts` asserts the identity stays present while blank and expects one Log row after retyping; actual result is two. Combined run: **10 passed, 1 failed** (three independent, eight author tests).

## Passing checks

- A tombstoned task pasted back alongside a genuinely new task in the same save fires only for the new identity.
- Copying the same task, planning it to another day, trashing/restoring its copied page, command Undo and creating a template day cause no new added-rule log.
- Reran the author's floor repository fixture, adapted to isolated PGlite using actual floor source 9417eea2. Seven checks pass: a current tick runs its rule, floor tick/plan/week-start writes and Undo leave `todo_automations` unchanged, the floor runs no rule, the floor's edits and planned day survive, and the current build runs the rule again afterwards.
- Source review confirms the new column is conditionally written only when rules change, and an old inverse without that field preserves it. The real floor SQL writes explicit workspace columns, leaving the new column untouched.

## Limits

The independent repository run uses **PGlite, not real Postgres**. No independent Worker, browser, migration rehearsal, tick/render budget, native phone or real-data template run. Those remain author/Lead evidence. The author owns the runtime fix; the saved trigger fixture should be rerun on that repaired head.

## Retest at 134154be

**The duplicate-trigger finding is fixed.** The original saved regression passes unchanged. Fifteen domain checks now pass (five independent, ten author), and the seven-check actual-floor/PGlite rerun passes again. A synthetic existing version-one blank task still fires when its first words arrive.

Product's version caveat is real for a stored blank record: set its deadline before any words, and its version rises above one; later words do not fire “added.” A separate fixture records this behavior. This is a limitation of the version heuristic, rather than a claim that a fresh empty editor box follows that path: current `save-editor` skips task creation while its words are empty. Product said this missed-trigger edge should be recorded rather than hold the release (message 20693793). No native/browser claim is made about legacy blank records.

No runtime fixes here. Prior independent evidence limits remain: PGlite is not real Postgres; Worker, browser, migration and performance are not independently rerun.
