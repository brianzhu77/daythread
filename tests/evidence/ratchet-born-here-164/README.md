# B33 cut recovery (Ratchet 067be3eb), a required check

`cut-recovery.mjs` is Ratchet's reproduction (730cfd5): a whole new done task is cut while saves are blocked, then the
page reloads; the recovered draft's save must keep the task (a cut is a move). It runs on a store that the real-day
replay has already used (it needs `editor-task:new-task`, done, on `ratchet-writing`):

    node tests/evidence/ratchet-real-day/seed.ts /tmp/ratchet-155-NEW.sqlite
    DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/ratchet-155-NEW.sqlite npx vite preview --host 127.0.0.1 --port 3490
    node tests/evidence/ratchet-real-day/replay.mjs http://127.0.0.1:3490 /tmp/ratchet-155-NEW.sqlite /tmp/ratchet-155-NEW-results
    node tests/evidence/ratchet-born-here-164/cut-recovery.mjs http://127.0.0.1:3490 /tmp/ratchet-155-NEW.sqlite

On fix/born-here-delete (after the stash fix): {"recoveredCutStillHasTask":true,"stashContainsCutTaskIds":true}.
The replay and seed are Ratchet's (bba64b3), copied so the check runs from this branch.
