# B77 day draft: data side, end to end

Synthetic workspace only (no real data): `seed.ts <today> <yesterday>` writes a workspace whose yesterday has two
open to-dos and a "Tomorrow: …" note, and whose Day template has his newer shape (Morning Planning > Events / Top 3 /
Other, then Daily Reflection). Run a dev build with `DAYTHREAD_LOCAL_DATA_PATH` pointing at it, a fresh
`DAYTHREAD_SQLITE_PATH`, `DAYTHREAD_AUTH=off`, and `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` in the environment.

- `e2e.mjs <base>` (WebKit 390): opening today's page shows "Preparing…", then bands. Run on Oct 31: 1.7 s,
  $0.00024, 3 suggestions, all in the Top 3 slots (a new to-do from yesterday's "Tomorrow:" note, the two carried
  to-dos with their age), nothing in the reflection. Apply on one fills its slot; notice "Applied · Undo".
- `e2e2.mjs <base>`: after a reload the remaining bands are still there; Apply all applies both; one Undo takes
  back both rows and brings both bands back; a reload makes no second model call. 4 pass.
