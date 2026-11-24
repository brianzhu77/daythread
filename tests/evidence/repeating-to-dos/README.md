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

Left for the run that records them.

| Script | Engine / width | Result | Notes |
| --- | --- | --- | --- |
| `hold.mjs` | | | |
| `repeat.mjs` | | | |
| `pixels.mjs` | | | |
| `day-weight.mjs` | | | |
| `limit.ts` | | | |
| `floor.ts` | | | |
