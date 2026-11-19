# iOS Simulator pass: notices (#217) and Move to a day (#218)

Jazz, Nov 19, for the Lead (0d4b5df3). **Simulator only (iPhone 17, iOS 26.5): no real iPhone was used.**

Run from the repo root against `vite dev` on your own port, with `DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=<throwaway store>`.
The scripts reseed that store (`tests/evidence/draft-snooze/seed.ts`). Never his data.

- `start.py`: starts your own Appium Safari session. Needs `JAZZ_APPIUM`, `JAZZ_SID_FILE`, `JAZZ_UDID`, `JAZZ_WDA`.
- `sim.py`: the day page's Skipped notice, run with `MODE=safari` or `MODE=hs` (the Home Screen app, already added from
  the same origin). Needs `JAZZ_APPIUM`, `JAZZ_SID_FILE`, `JAZZ_PORT`, `JAZZ_STORE`, `JAZZ_REPO`; screenshots go to `JAZZ_OUT`.
- `tasks.py`: Tasks → ⋯ → Pick date… on a to-do (`MODE=hs`).

Gestures are XCUITest `dragFromToWithVelocity` (pt/s). `dragFromToForDuration` holds first and then moves fast, so it
can't make a slow drag.

## What it found on main 532d1b28

1. **Pick date… chose today by itself.** iOS Safari fills an empty date field with today as it takes focus, and sends
   `input` + `change` 28 ms later, before any picker shows. So the notice's Pick… tried to move the to-do to today
   (refused, shown as "Not moved · changed elsewhere"), and on the Tasks screen "Pick date…" planned the to-do on today
   with no calendar shown (`tasks.py` on main: FAIL, planned 2026-11-18).
   Fix: the field starts at the earliest day it allows; iOS then opens its calendar and sends `change` only for a
   tapped day. The Tasks screen uses the same `pickDate`.
2. **A fast short flick could arrive with one move or none** (18 pt at 1500 pt/s: down, then up 16 ms later). The flick
   speed needed two moves, so it didn't close. Fix: the press is the first sample, the release counts as the move when
   none came, and a finger that stopped for 50 ms before lifting isn't a flick.
3. A refusal for a day that isn't later now says `Not moved · pick a later day`, not "changed elsewhere".

## Result on fix/ios-date-pick

`sim.py` 16/16 in Safari and 16/16 in the Home Screen app; `tasks.py` 3/3. Swipe up 44 pt at 60 pt/s closes; 20 pt at
40 pt/s springs back; an 18 pt flick closes; a sideways slide on a day button and a swipe from Undo fire nothing;
Mon → `Moved to Mon, Nov 23` → Undo → Skipped → Undo; Pick… opens the calendar, picks nothing for 12 s, a tapped
Tue 24 moves it and the calendar closes; Dismiss on a mix fits at 402 pt.
