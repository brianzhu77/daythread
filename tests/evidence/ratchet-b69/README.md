# B69 reproduction

Invented model-v2 workspace; no copied user data. Use a **new** `/tmp/ratchet230-ui.sqlite` (fixture operation IDs are idempotent):

```
node tests/evidence/ratchet-b69/seed.ts /tmp/ratchet230-ui.sqlite
DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/ratchet230-ui.sqlite npx vite --host 127.0.0.1 --port 3667
node tests/evidence/ratchet-b69/ui.mjs
node --test tests/v2-blank-tasks.test.ts
```

Browser replay mutates only this copy, so reseed a fresh database before repeating. It expects Oct 30, 2026 as today's date. Screenshots and accepted results are in `results/`.

Initial harness mistakes: the morning card uses `.mc-row`, not `.task-row`; a single suggestion has its own Add button, not Add all; past-day empty lines are initially hidden by B19 and must be revealed by focusing the TODO heading. These were corrected before the recorded final run. The first domain fixture incorrectly assumed a fresh blank checkbox creates a Task; the actual reproduction creates a title then clears it, matching a stored blank task. A separate test covers fresh placeholders.

The mutation log is a deliberate negative control: deleting `getDayView`'s blank filters caused failures; the original file was restored in `finally` and the passing domain run repeated. No application source change is part of this delivery.
