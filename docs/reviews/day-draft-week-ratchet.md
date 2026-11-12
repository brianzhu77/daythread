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

## Retry confirmation

`tests/ratchet-draft-retry.test.ts` executes the actual hook body with controlled hook bindings, fake focus events, an old ready draft and the server's failed-remake null response. It observes **four requests** (initial plus three focus events), exceeding the two-failure automatic limit. This confirms the client control-flow finding independently; it is a controlled hook test, not a browser or actual model failure. The unchanged draft and mock refresh reproduce the server path above.

## Retest 517a7d58

Both original findings are repaired. The skipped-task test passes unchanged. The hook test now supplies the new server response's `remakeFailed: true`, and passes the two-request ceiling. 47 targeted checks pass (own seven-day/remake/hook tests plus author week/synced-record tests). Source review confirms no-model and failed-model remakes return that flag while preserving the stored old draft.

One new confirmed gap remains from the synced timestamp repair: `tests/ratchet-draft-synced-recency.test.ts` creates an ordinary note with a synced block, dates its own document October 1, edits only the block's words October 21, and prepares October 22. The words are stored, but the note retains its old timestamp, the record has no edit timestamp, and input says `EARLIER PAGES (none)`. Thus the new seven-day input rule misses recently edited synced content on old pages. Keeping synced edits to one record write can remain an invariant; the draft corpus needs another recency signal for that content, or an explicit accepted limitation. Reported cf5f7beb. This is a domain/model-request fixture, not a browser run.

## Final retest 96537d45

The synced recency finding is repaired. Record `editedAt` is persisted in the existing row column; input uses the later page/record edit time, preserving the one-record write. My original fixture was rerun on 517a7d58 and still failed with no conflict copy and its page timestamp unchanged; on 96537d45 it passes. Additional assertions verify that only `synced:record` is written, its timestamp survives the row round trip, and the loaded workspace still selects the words. Lead corrected an earlier attribution to the fixture in message 56e0053e; no fixture repair was required to get this before/after result.

49 targeted tests pass, including both original remake regressions, the seven-day baseline, synced recency and synced-record/storage invariants. No independent browser, deployed Worker or external model run was added. No remaining confirmed blocker in the reviewed changes.
