# B72: to-do checkbox ticks at once, ignores taps while saving (task #240)

Spec: Lead d6d0cc5f in #daythread:b842c6d3. Cause: Brian's two "Done" writes one second apart (16:36Z Oct 31). The box
followed the stored status, so for the 200–440 ms save it stayed empty and a second tap sent "done" again. A second tap
landing just after the answer would have reopened the to-do.

## Every caller of the done/open command

`grep -rn "'task-status'" src` (excluding tests):

| Caller | Surface | Before | After |
| --- | --- | --- | --- |
| `page-editor.tsx` `EditorTask` checkbox | Day pages and every page with to-dos, desktop and phone (same component) | own `run(task-status)` | `useTaskTick` → `toggleTask` |
| `task-row.tsx` `useTaskActions.markDone` | Tasks screen (`ListTaskRow`: Today, Upcoming, Open, Not today) | own `run(task-status)` | `toggleTask` |
| `task-row.tsx` `useTaskActions.cancel` | Cancel task (row menu) | unchanged: not a tick | unchanged |
| `page-editor.tsx:1721` | Typing intents (cancel / reopen by keyboard) | unchanged: not a tap on a box | unchanged |

No other component ticks a to-do. The strip (`facts-strip.tsx`) and the Start the day card (`start-the-day.tsx`) only
plan, add, move and set aside. Review step 1 no longer exists: `/review` redirects to `/`. Search and tag views show
read-only, disabled boxes, and the tomorrow block has no checkbox. The
`TaskRow` component in `task-row.tsx` is not rendered anywhere today; its box reads `useTaskTick` too, so it behaves the
same if it comes back.

## Behaviour

- One place: `WorkspaceProvider` keeps `ticks` (to-do id → tapped state, `saving` or `holding`), logic in
  `src/components/task-ticks.ts`.
- A tap ticks at once: the box and the strike (`task-done` / `is-done`) read `shownStatus`. No spinner.
- While that to-do's save is out, further taps on it are ignored. The guard reads a ref, so a tap before React
  re-renders is ignored too.
- After the answer a tap toggles as normal, so unticking on purpose works.
- A failed save drops the tick, so the box shows the stored state again, and the header's usual error and Retry show.
- Rows that leave on Done (Tasks screen lists) read `heldWorkspace`: a ticked to-do stays in its list, ticked and greyed,
  until 1 s (`HOLD_MS`) after the save answered. That is the only timer. Day-page rows don't leave, so nothing changes
  there.
- An Undo during the hold shows at once, because the box reads the stored to-do whenever no save is out.
- **Retry** (Ratchet 4bae2184, a8096d15): a failed tick's Retry goes through the same `runTick`, with the original
  operation id and the explicit status it asked for. It ticks at once, ignores taps while it saves, and holds the row.
  Before, Retry called `run` directly: the box stayed empty, the row left at once, and a tap during it added a write.
- **Day-page row display** (Jazz 0b71b20, cherry-picked as a3a3c9c): while a tick saves, the row's ⋯, date tag,
  Moved-to and Plan for today follow the tapped state, so a pending row matches a saved one and nothing re-wraps when
  the save answers. Every action still uses the stored to-do.

## Checks (head a3a3c9c)

- `tests/task-ticks.test.ts`: 7 tests (double tap, the tap just after the answer, failure, stale answers and timers,
  cancelled, Undo during the hold, held list membership).
- `npm test`: 180 pass, 0 fail, 3 skipped. Typecheck clean. `npm run build` passes.
- `b72.mjs` (slowed-save replay): every POST to a server function is held 1 s, and task-status writes are counted from
  the request body. Service workers are blocked so WebKit's requests pass through the route.
  - **Usage, dev build:** `node b72.mjs <base url> <label>` against a dev build with `VITE_DEV_MENU=1` on a **fresh**
    SQLite file. Each pass seeds sample data. Restart the server for a fresh file; deleting the file under a running
    server doesn't reset it.
  - **Usage, production build:** seed a copy on a dev build, then run `ONLY=webkit SKIP_SEED=1` and
    `ONLY=chromium SKIP_SEED=1`, each against `vite preview` on its own fresh copy.
  - `output-fix.txt`: dev build, WebKit 390 (touch) and Chromium 1280, **32 pass, 0 fail**. That's 16 per browser, 5 of
    them for Retry.
  - `output-prod-build.txt`: production build (`vite preview`), **32 pass, 0 fail**.
  - `output-main.txt`: control on main 4cbe74d (the first 11 checks only; Retry was added later), **11 fail**. A double
    tap sends `["done","done"]`. On the Tasks screen, the taps at the first row's spot send `["done","done","done"]` and
    tick the neighbour.
  - Tasks screen on this branch: `["done","open"]`. The fast second tap is ignored; the third tap lands in the hold on
    the same row, so it reopens that to-do (a tap after the answer toggles, per the spec). The neighbour stays open.
  - Flake seen on 8924c51 and handled: once in 3 runs WebKit logged "Importing a module script failed" right after a
    navigation on the dev server, and the first tap was lost. The script now waits for `networkidle`. It never happened
    on the production build: 5 of 5 runs on 8924c51, and the run above.
- Ratchet's `retry.mjs` and `retry-double.mjs` (review/ratchet-b72), pointed at this branch's dev build. Retry pending:
  checked `true`. The row is still there 250 ms after the retry answers. Writes: `2` (the failed one plus the retry;
  the tap during Retry is ignored). On 8924c51 they gave `false`, `0` and `3`.
- `../b72-design/look.mjs` (Jazz) on the production build: pending equals saved pixels on day pages, and pending equals
  holding pixels on Tasks; the row is gone after the hold. All 12 pass (WebKit 390 and Chromium 1280, light and dark):
  `look-prod-build.txt`.
- `alignment.txt`: `scripts/check-alignment.mjs` on the v1 fixture plus `align-fixtures.ts`, at 1280 and 390: 287
  passed, 0 failed, 0 missing. It measures stored rows only. The pending look is covered by `look.mjs` above.

## Not covered

- A real iPhone. Playwright WebKit at 390 with touch is the closest check.
- Jazz's design check (390 WebKit, 1280 Chromium) is still to come.
- Postgres: no storage change. The command is the same `task-status` write as before.
