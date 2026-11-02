# B82: a tapped line stays between the clock and the toolbar

Native checks in the Home Screen app, on an iPhone 17 Simulator (iOS 26.4). **Simulator only: no real iPhone was used.**
Run from the repo root on a disposable store, with an Appium session of your own already started
(`tests/evidence/home-screen` has the setup): `JAZZ_APPIUM`, `JAZZ_SID_FILE`, `JAZZ_UDID`, `JAZZ_PORT` and `JAZZ_STORE` set.

- `seed-filled-day.ts <store> <date>`: 6 lines under TODO, 20 under Notes.
- `b82table.py <label> <runs> <entry> '<json lines>'`: tap each line, record where it ends up and how often the app scrolled.
- `b82more.py <entry> <empty|filled>`: the empty day, typing right after the tap, lines reached with the keyboard up, Enter five
  times, his own scroll left alone, the keyboard's ✓, and the Aa panel (B53).
- `timeline.py <label> '<json lines>'`: scrollY, offsetTop, visible height and the line's top, frame by frame after a tap.

## Cause

- **iOS on its own** puts a tapped line about 30 px above the keyboard, about 35 ms after the keyboard's resize.
- **B55's scroll** measured before that landed, so its first move used a stale position, and it often moved a second time.
- **A short editor** that fits above the keyboard is scrolled up whole by iOS: 225 px on an empty day, wherever he tapped.

## Result (main 20844995 → this branch), y of the tapped line

Toolbar top 440, clock's strip ends at 62. This branch: 5 runs per line on a filled day, each gave the same number. Main: one run per line.

| Line, y before the tap | Main | This branch | App's moves |
| --- | --- | --- | --- |
| TODO, 264 | 264 | 264 | 0 |
| Task 0, 295 | 295 | 295 | 0 |
| Task 2, 355 | 355 | 355 | 0 |
| Task 5, 445 | 367 | 367 | 1 |
| Events, 546 | 202 | 374 | 1 |
| Bullet under Events, 577 | 105 | 341 | 1 |
| Good Stuffs, 640 | 108 | 374 | 1 |
| Bullet under Good Stuffs, 671 | 11, hidden | 341 | 1 |
| Line 12, reached at 355 | 468, behind the toolbar | 375 | 1 |

Empty day, 3 runs per line: TODO 264 → 264 (main: 39, hidden), first task row 299 → 299 (main: 74), Events 366 → 366 (main: 141).
Safari on the same Simulator, 3 runs per line: every line clear, one move at most.

Also passing: typing right after the tap, lines reached with the keyboard up, a clear line not moving, Enter five times at the
bottom, his own scroll with the keyboard up left alone, the keyboard's ✓, B53's Aa panel. B4 and B58's browser checks pass, with
a faked keyboard.

Video, frame by frame: on main the page jumps at once; here it rises in one motion with the keyboard.

## Follow-up: a long block below the caret

Only the top 72 px of the next block is kept clear, so a long paragraph or a table below doesn't push his line up to the clock. 5 runs per line; main (fed22c9c) one run per line.

| Line, y before the tap | Main | This fix |
| --- | --- | --- |
| Above a long paragraph, 645 | 68 | 333 |
| Above a long paragraph, 495 | 68 | 333 |
| Line 19, above a 25-row table, 685 | 68 | 333 |
| Line 18, one line above that, 655 | 375 | 375 |
| Task 5, 445 | 367 | 367 |
| Events, 546 | 374 | 374 |
| Bullet under Events, 577 | 341 | 341 |
| Bullet under Good Stuffs, 671 | 341 | 341 |

## Limits

- The wait (120 ms of no movement) is based on the Simulator's timing. A real iPhone hasn't been measured.
- With the keyboard up, a short page is taller than before. The extra space sits under the keyboard and goes when the keyboard does.
