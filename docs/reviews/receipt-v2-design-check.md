# Capture receipt v2 — design check of Step 1 (c) (Jazz, 2026-10-19)

Checked against `docs/design/capture-receipt-v2-check.md` (spec 0274472). First run on d242e2f, recheck on **ad69333**, on my own copies (ports 3092-3095, throwaway SQLite in `/tmp/jazz-receipt/`), fake provider only, no paid calls. Headless Chromium at 1280 and 390. Screenshots in `/tmp/jazz-receipt/`.

Fix commits from me, on branch `design/receipt-title-clamp` on top of ad69333:
- **da19f69**: long titles wrap to 2 lines then ellipsis. Chromium ignores line-clamp on a `<button>`, so a long Chinese title was cut to one line with no ellipsis. The tap-to-edit title is now a span with role=button (Enter/Space open it).
- **c0e4b16**: model-failure receipts use the amber border (#f0d6bd), not the red `.status-failed` one.
- (4653aa0, phone row layout, already in ad69333.)

## Result on ad69333 (+ da19f69, c0e4b16)

| Row | Result | Note |
|---|---|---|
| His text first in every state | pass | |
| Group order | pass | Needs a look → saved → Update → "wasn't saved" → footer |
| One line at 1280; chips under title at 390 | pass | 390 was broken on d242e2f, fixed by 4653aa0 |
| Long Chinese title: 2 lines + ellipsis | pass with da19f69 | fail on ad69333 alone |
| 44 px taps at 390 | pass | chips keep their look with a 44 px halo; Save/Remove/Undo all 44 px |
| Date chip with role, "No date", never "Unscheduled" | pass | |
| Saved link shows host | pass | |
| Title edit in place, Enter saves, Esc reverts | pass | same 17 px font |
| Type menu; date menu with role + day + No date | pass | current choice is checked on ad69333 |
| ⋯ = Remove, Open | pass | |
| Reason chips, copy | pass | |
| Time flag: TIME group, No time, Set time… | pass | No time clears the flag; Set time… opens a time input |
| Save / Remove; row moves, chip goes after fixing | pass | |
| Header "{n} waiting for you" / "Saved from" | pass | counts the waiting Update too |
| Update row: chip, role/date changeable before Apply | pass | Do → Due → Apply checked |
| **Undo all refused: "Can't undo · edited since"** | **fail** | The domain refuses correctly (Ratchet #70), but the screen shows the generic red **"Not saved — your changes are still here · Retry"** bar. That says the wrong thing and offers a Retry that can only fail again. The receipt's `send` goes through `run`, whose error path is the save-failed banner. Needs: show the refusal text inline under the receipt footer in `--ink-2`, no Retry. |
| "1 part wasn't saved as an item · See your text" | pass | muted |
| Organizing… with spinner, field free | pass | |
| No key: "Simulated · no model key" + field line | pass (tag) | the simulated receipt is still the old v1 row ("✓ Task … Unscheduled", no chips, no Undo all), see follow-ups |
| Key rejected | pass | Retry + field line |
| http500: unavailable + Cost unknown + Retry, next capture works | pass | |
| error-cost / malformed: unavailable + Retry, no Cost unknown | pass | |
| Paused: copy, no Retry, field line persists | pass | earlier failed receipts also lose Retry while paused |
| Budget used up: no Retry | pass | |
| Nothing red | pass with c0e4b16 | |

## Follow-ups (don't block)

1. Simulated (no key) captures still render the v1 receipt. Matters only if Brian runs without a key.
2. Receipts aren't newest-first everywhere: in the 1280 sheet the newest (failed) receipt sat below an older applied one, below the fold. The newest capture's receipt should always be first.
3. An older receipt shows the date from capture time ("Tax Return · No date") after a later update moved the task. It should show the task's current date.
4. A held row saved without fixing keeps its reason chip in the saved list. I'd drop the chip once he taps Save.

Not checked: real phone, IME, motion, paid-model output.
