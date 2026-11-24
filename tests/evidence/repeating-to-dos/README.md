# Repeating to-dos: evidence for the screen

Scripts for `docs/design/repeating-to-dos.md` §7 ("Checks before release"). Each prints `PASS` or `FAIL` per check and exits 1 on any failure; none is part of `npm test`.

Browser scripts run against the app on a throwaway SQLite store, never real data. Start a server of your own on a free port:

```
DAYTHREAD_SQLITE_PATH=/tmp/rt.sqlite DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off npx vite --host 127.0.0.1 --port 3917
```

Every script that reseeds the store removes and rebuilds that file itself, so the server may be running. `seed.ts` makes the store: today's page with six to-dos (four repeating), tomorrow's page with a reference line, Notes, Lists.

## Scripts

| Script | What it proves | Command |
| --- | --- | --- |
| `hold.mjs` | A tick that writes an open page saves and holds it first: no conflict, no lost word, one Undo, offline held (§6 "A tick now writes another page's document"; §7 "The next one's day page open with unsaved words"). | `node tests/evidence/repeating-to-dos/hold.mjs <base-url> <store-path> [chromium\|webkit]` |
| `repeat.mjs` | The screen, R1 to R12: the icon and its row height (§3 "Seeing it"), set, change and Off with one Undo each, by keyboard too (§7 "Set, change and Off"), the editor's fields and its `Next …` line, the tick's and Cancel's notices and the one next to-do, Undo of both (§7 "Tick, then Undo", "Cancel makes the next"), the icon isn't text, the 390 sheet and the bar's menu, Tasks and Upcoming, a document page's reference line, offline (§7 "Offline: tick, Done, then back online"), dark. | `node tests/evidence/repeating-to-dos/repeat.mjs <base-url> <store-path> [chromium\|webkit] [shots-dir]` |
| `pixels.mjs` | A to-do with no repeat is unchanged, pixel for pixel (§3 "Nothing, until a to-do repeats"; §7 "unchanged ... at both widths"): five pages at 1280 and 390, light and dark, byte for byte on two servers; and the menu differs only by `Repeat…` under `Blocked by…`. | see below |
| `weight-seed.ts`, `day-weight.mjs` | What repeats cost a day at 390 with 4x CPU slowdown, against R1-18's bar (§6 "Cost"; §7 "a day under R1-18's bar", "the tick's real speed on a repeating to-do"): the day drawn, a letter typed, a tick of a repeating to-do and of a plain one, with none and with 25 of the 26 to-dos repeating. | `node tests/evidence/repeating-to-dos/day-weight.mjs <base-url> <store-path> <repeating> [runs]` |
| `limit.ts` | What the 1,000-repeat limit costs (§6 "Bound the number per workspace"): in memory, 1,001 to-dos over ten day pages; median of 21 runs of a tick of a plain and of a repeating to-do, `repeatsIn`, `dueTodoRepeats`, `repeatPages`, and the size of `todoRepeats`, with none and with 1,000. No browser, no database. | `node --no-warnings tests/evidence/repeating-to-dos/limit.ts` |
| `floor.ts` | The floor build and an older tab against the new server, on real Postgres with real writes (§7 "The floor build ticks a repeating to-do and deletes its line ..."). | `DATABASE_TEST_URL=postgres://… node --no-warnings tests/evidence/repeating-to-dos/floor.ts <floor-worktree>` |

`repeat.mjs` runs in Chromium and in WebKit (pass the engine). `R4` uses Option+Tab in WebKit, as Safari's Tab skips buttons by default. `R1` compares the long line's height with the same words in a store seeded `plain` (which the script makes itself): with the icon it may take at most one line more, never fewer, since the icon takes width at the line's end; both heights are printed. `R12` writes screenshots to `[shots-dir]` for the design review.

### `pixels.mjs`

```
node pixels.mjs <base-a> <base-b> [shots-dir]
```

`<base-a>` is a server of the build this work started from (`5b79bd68`, the parent of `97e70925 docs(design): repeating to-dos`), `<base-b>` of this branch. Seed one store with `plain` (no repeat), checkpoint it, and give each server its own copy:

```
node --no-warnings tests/evidence/repeating-to-dos/seed.ts <store-a> <today> plain
cp <store-a> <store-b>
git worktree add --detach <dir> 5b79bd68   # link or install node_modules there, then start its server on <store-a>
```

Use the commit the work started from, not an older `main`: anything else that changed on `main` in between shows as a difference. A difference writes both screenshots to `[shots-dir]` and fails.

### `day-weight.mjs`

`<repeating>` is how many of lines 0 to 24 repeat daily (0 for none; line 25 never does). The store is seeded again before every open, because a tick changes it. `tick` is line 0 (repeating when `<repeating>` > 0), `plainTick` is line 25, ticked on the same page after it, so its time includes whatever the first tick left behind. Run it with `0` and with `25` and compare.

### `floor.ts` has NOT been run on Postgres

It needs a real Postgres (`DATABASE_TEST_URL`, a disposable database; the schema `daythread_test_repeats` is dropped before and after) and a worktree of the floor build (an older build, whose `todo_repeats` table it has never heard of). Neither exists where it was written. It parses and prints its usage with no arguments (`node --no-warnings tests/evidence/repeating-to-dos/floor.ts`, exit 2) and type-checks. Its logic was exercised once against PGlite with the pre-feature build (`5b79bd68`) as the floor, which is not a real Postgres. The owner or CI must run it on Postgres before release.

Order differs from the plan in one place: an Undo only reaches the latest change, so the Undo of Charlie's tick comes before the Cancel without a day, not after.

## Results

Recorded 2026-11-24 on the build at `317eb118` (Task 10 of the phase 2 plan), served with `vite preview` on throwaway SQLite stores, macOS, Playwright's Chromium and WebKit, headless. RUN-PASS: run and seen to hold. RUN-FAIL: run and seen not to hold (what was seen is given). NOT RUN: not run, and why.

### The gate

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | RUN-PASS | clean, exit 0 |
| `TZ=America/Vancouver FUTURE_DAYS_CONTRACT=1 npm test` | RUN-PASS | 1404 tests, 1390 pass, 0 fail, 14 skipped. All 14 skip for want of `DATABASE_TEST_URL`: the two brake/first-sign-in races and the twelve "real Postgres:" tests |
| `npm run build` | RUN-PASS | builds, exit 0 (the usual `INEFFECTIVE_DYNAMIC_IMPORT` note for `export.ts`) |
| `node scripts/check-alignment.mjs` (fixtures from `scripts/align-fixtures.ts` on a copy of `tests/fixtures/v1/workspace.sqlite`) | RUN-PASS | 1214 passed, 0 failed, 2 missing ("picker dot on today" at 1280 and 390). Exit 1 because of the 2 missing; the base `5b79bd68` run the same way gives 1204 passed, 0 failed and the same 2 missing. `repeat mark on first line: "Fixture repeating to-do"` measured +0.0 px at 1280 and at 390 |

### The scripts

| Script | Engine / width | Result | Notes |
| --- | --- | --- | --- |
| `hold.mjs` | Chromium, 1280 | RUN-PASS | H1, H2, H3a, H3b, H4, H5, H6, H7: all passed. H3b as decided: `Saved \| Can't undo · edited since`, the next one stays. H7 after coming back online: the banner `Not saved — ticked "Take the bins out" was changed elsewhere`; before Keep mine the tick was open with no next one; after it, done, one next to-do, the typed words stored |
| `hold.mjs` | WebKit, 1280 | RUN-PASS | the same eight, the same words |
| `repeat.mjs` | Chromium, 1280 and 390 | RUN-PASS | R1 to R12, 14 checks. R1: rows 44 (1280) and 32 (390) high with and without a repeat; the long line 24 px = 24 plain at 1280, 72 px (3 lines) against 48 (2 lines) plain at 390, the one line the icon may cost. R11 back online: no notice at all, one next to-do, the page still `/day/<tomorrow>` (offline it said `Offline · 1 change will be sent`). R12 dark: the icon is `rgb(110, 110, 110)` = `--ink-3` |
| `repeat.mjs` | WebKit, 1280 and 390 | RUN-PASS | the same 14, the same numbers |
| `pixels.mjs` | Chromium, 1280 and 390, light and dark | RUN-PASS | `5b79bd68` against this branch on copies of one `plain` store: 20 of 20 screenshots byte-equal (14 to 46 KB each, sizes differing by page, so not blank pages); both ⋯ menus differ only by `Repeat…` under `Blocked by…` |
| `day-weight.mjs` | Chromium, 390, 4× CPU | RUN-FAIL on `words` | 9 runs each, alternating 0 and 25 repeating. Medians (ms), no repeats (min–max, spread) → with 25: `words` 685 (678–701, 23) → **742** (733–830): 57 ms over the median, past the 23 ms spread, and every run with repeats was slower than every run without; `typed` 309 (279–319, 40) → 310: within; `plainTick` 175 (152–192, 40) → 188: within; `tick` (not gated) 147 → 143 |
| `limit.ts` | Node, no browser | RUN-FAIL on the plain tick | median of 21, 1,001 to-dos, ten day pages, three runs. Plain tick 1.61 ms with none → 3.84 / 3.79 / 3.79 ms with 1,000 repeats: +2.2 ms, +136%, past "within 10% or 2 ms". `repeatsIn` 0.14–0.15 ms (≤ 2: pass). `dueTodoRepeats` 3.05–3.11 ms (≤ 10: pass). Also: repeating tick 4.59–4.66 ms, `repeatPagesForATick` 0.14 ms, `todoRepeats` 202,891 bytes. `todoRepeatLimits` not changed |
| `floor.ts` | Postgres | NOT RUN | needs a real Postgres (`DATABASE_TEST_URL`) and a floor build's worktree; neither exists on this machine. The owner or CI must run it before release |

### By hand (throwaway Playwright scripts outside the repo, Chromium unless named)

| Check | Result | What was seen |
| --- | --- | --- |
| A kept repeating tick doesn't ask for the mend again and again | RUN-PASS | every POST failing: the tick was retried 10 times by the outbox over 75 s, a reload and 45 s more; `run-repeats` was sent 0 times; the banner stayed `Offline · 1 change will be sent`. Back online: the tick landed, one `run-repeats`, one next to-do |
| The mend due while the next one's page mounts with a recovered draft | RUN-PASS | `draftword` typed on tomorrow's page, unsaved (POSTs failing); the bins finished by an older client's tick (no day), mend due on tomorrow; reload: one `run-repeats`, no conflict line, `Saved`, `draftword` shown and stored, `Tomorrow notes` kept, one next to-do |
| A second tap 700 ms after the first during a slow save (each save delayed 2.5 s) | RUN-PASS | one tick sent, the to-do done, one next to-do and one new row, the typed word stored, no conflict, `Task completed · Next Wed, Nov 25`; the second tap left the box ticked |
| The editor's `Next …` equals the day the server makes | RUN-PASS | weekly: `Next Tue, Dec 1` = Dec 1. Every 2 weeks on Mon and Thu: `Next Thu, Nov 26` = Nov 26. Monthly from Jan 31, 2027: `Next Sun, Feb 28, 2027` = Feb 28, 2027. When it's done every 5 days: `Next Sun, Nov 29 if done today` = Nov 29. Week starts Monday (set in Settings): the day row starts with Monday; every 2 weeks Mon and Thu `Next Thu, Nov 26` = Nov 26; weekly Wed and Fri `Next Wed, Nov 25` = Nov 25. Each tick's notice named the same day |
| The database Repeat menu looks and works as before | RUN-PASS | the template's menu at 1280 and 390, light and dark, unset (then Weekly) and with weekdays: 8 of 8 screenshots byte-equal between `5b79bd68` and this branch. `tests/evidence/repeats/repeats.mjs` on this branch: 14 of 14 in Chromium and in WebKit |
| The icon on a copied line on another page, and in Tasks' Today and Open | RUN-PASS | Copy from the ⋯ menu, pasted on tomorrow's page: a reference line to the same to-do, with the icon. Today and Open: the icon on the four repeating rows only |
| 390 Tasks: the icon's and ⋯'s hit areas | RUN-PASS | the icon's `::before` (44 × 44, inset −10 px) ends at x = 324, ⋯ starts at 324: overlap 0 on all four rows; no point of ⋯ hits the icon. A tap on ⋯ opened the menu (`Repeat · Every week…` under `Blocked by…`), no editor (`shots/manual-A7-chromium-390-menu.png`) |
| Space on the focused icon | RUN-PASS | on a day page line and in Tasks: the editor opens with focus inside it, nothing typed on the page |
| No icon on a to-do with no repeat, nor on a finished one | RUN-PASS | after ticking Weekly review: no icon on it on Today, in Tasks Today, Open, Upcoming, Notes (its reference line) or Lists; its next one has one (next week's page, Upcoming); `Book the dentist` and `Reply about the offsite` never have one |
| The editor open while the same to-do is ticked in a second tab | RUN-PASS | a second tab of the same browser ticked it; the first tab's editor stayed open while it was behind and closed within 0.5 s of the first tab being brought to the front |
| A drawn `Weekly` refused (the line deleted in another browser) | RUN-PASS | one notice `That to-do was deleted`, the editor closed by 90 ms, no icon on the line at any sample from 11 ms to 4.5 s (so the drawn icon, if drawn, went before the first sample), no repeat stored |
| Tick, then tap again within the notice, the next one's page not open | RUN-PASS | `Task completed · Next Wed, Nov 25`, then `Task reopened`; the to-do open, no next one: one to-do |
| A To-dos view | RUN-PASS | a repeating row's box: `Done · Next Wed, Nov 25`, one next to-do. Status → Done from the bar on Book the dentist, Reply about the offsite and Weekly review: `3 to-dos changed · Next Tue, Dec 1`, all three done, one next to-do (`shots/manual-S8d-chromium-after.png`) |
| H2 by hand | NOT RUN | not needed: `hold.mjs` H2 opened the peek and passed in both engines |

### By eye, 1280 and 390, light and dark (Chromium and WebKit; `shots/`)

| Check | Result | What was seen |
| --- | --- | --- |
| The icon sits in the trailing group after the deadline and `Since` | RUN-PASS for the deadline | on a line, `Due Fri` then the icon, in the one group (`shots/eye-deadline-*.png`); in Tasks `Due Fri`, the icon, then ⋯. A line with `Since` and a repeat was not set up: not seen |
| A repeating line is as tall as its neighbours | RUN-PASS | 44 px at 1280, 32 px at 390, every row, both engines, with and without a deadline |
| The long line wraps as it does without a repeat | RUN-PASS as decided | the same at 1280; one line more at 390 (3 against 2), as R1 allows and the design now says |
| The editor's fields line up as the database Repeat menu's do | RUN-PASS | labels in one column and controls in one column (editor: labels at x 967, controls at 1091; the database menu: 220 and 332), 40 px rows at 1280 and 44 at 390 in both. The weekday row has no label (Decision 11) |
| The sheet has a 44 px `Done` and 44 px day buttons | RUN-FAIL on `Done` | day buttons 38 × 44. `Done` is 39 × 25 px with no larger hit area (`button.app-link`, no padding, no `::before`), in both engines; it is the existing sheet's `Done` (`property-editors.tsx`) |
| Nothing is blue but the focus ring and the checked box | RUN-PASS | a scan of every element's text, background, border and outline colour on the lines, in the editor and in Tasks found no blue; in the screenshots the only blue is the focused `Repeat` select's border |

### Not run here; open before release

- A real iPhone or the Simulator: a tap on the icon with the keyboard up (the keyboard must not change), and a tick of a repeating reference line on the next one's own page with the keyboard up.
- `floor.ts` on real Postgres with a floor worktree.
- `pixels.mjs` on a copy of Brian's real data.
