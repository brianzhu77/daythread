# PR203 independent review

Candidate a7793b0b; 349883fd changes only two task-id assertions. Synthetic fixtures only; no user notes, external model calls or deployed writes.

## Findings

1. **Skipped to-do offered again after remake.** Confirmed by `tests/ratchet-draft-remake.test.ts`: old ready draft suggests a task, user skips it, new model omits that task, `withFallback` returns it in `moreOpen`. `set-draft` preserves the skipped item but stores that new list; `draftView` offers the task again. Filter decided task ids from the new list. Reported ea6ab2bd.
2. **Failed remake bypasses automatic retry limit.** Source trace: server/functions.ts returns the same null action on a failed remake and on an already-current draft. use-day-draft.ts sets `outcome=done` before its null-action branch. `failuresOf(done)=0`; old draft stays stale; each later focus/pageshow can ask again. Preserve old bands but count this outcome as a failed ask. This finding has not been exercised in a browser. Reported 6f69e359.

## Evidence and boundaries

- Four saved baseline fixtures from task346 now pass: yesterday's nested context membership, old day recently updated, ordinary document recently updated, day save edit timestamp.
- Independent concurrent-choice fixture passes: skipping while a new draft is computed remains skipped after commit, original task id intact.
- Eight author domain tests pass, including failed/older-build remake refusal, exactly-once recipe replacement and unchanged-save timestamps.
- One independent skip/more-open fixture fails as described above (13 pass / 1 fail in targeted run).
- All-page timestamp change is specifically the save-editor path. Other commands such as rename-task still mutate page text without moving its timestamp; this predates this PR. No independent assertion that every possible page mutation now stamps editedAt.
- Context is bounded (5,000 characters/page, 30,000 earlier context); long pages preserve beginning/end while omitting middle lines. Nested source lines are represented with indentation but suggested output remains flat. These are implementation limits, not proof that every seven-day word reaches the model.
- Model priority is a prompt instruction, not a deterministic completeness guarantee. Author's real-model evaluation was read but not repeated. Its calculated `order` warning does not affect its pass/fail boolean.
- No independent browser, Worker, Postgres or real-model run for this review yet.
