# R1-17 on a copy of his data: the browser part

Code: `feat/databases-ui` at aa3dc3f1 (this file and its scripts came after it, and change nothing in `src`). Built app
(`vite build`, `vite preview`), SQLite, auth off. The store comes from the `2026-11-02-before-62` backup: revision 719,
29 pages, 18 tasks. His production database wasn't touched. The native part is Jazz's run on the same code.

| Check | Result |
| --- | --- |
| `check-alignment.mjs`, 390 and 1280, his 12 days, 2 empty November days and the fixture page | 1150 passed, 0 failed, 0 missing |
| 16 browser scripts, each seeded on top of his data, Chromium and WebKit | 32 of 32 pass |
| `keys.mjs`, 5 more runs per engine | 10 of 10 pass |
| Every page of his, main (d04e92c1) against this build, text, pixels and errors, 2 engines, 2 widths (32 paths) | 126 of 128 identical; see below |
| Written by opening those pages | only today's new day page and its draft, the same on both builds apart from random ids |
| `npm test`, typecheck | 253 pass, 0 fail, 4 skipped; clean |
| Render at 390, 4x CPU, built app, median of 9, this build only | a day with 40 lines 471 ms; with a 25-row table 572 ms |

## The 2 of 128

WebKit's last path at both widths came out blank on this build. It's the harness: WebKit draws the 64th page opened in
one browser run blank. With the order swapped, the 64th was main's, and main's went blank (`goto` timed out) while this
build's rendered. A new context partway through doesn't help; it still happens, so the limit looks like the browser's.
That path alone, in a fresh browser, is identical on both builds at both widths, to the byte.

## The heads after this one

- **97224382** (clipboard and Worker fixes): 34 of 34 script runs, 17 scripts in both engines.
- **f917f61e** (menu on screen, checkbox centring, a wider gate): the gate 1285 passed, 0 failed, 0 missing; the 9 scripts
  touching those changes, 18 of 18; the pages again 126 of 128, the same 2.
- **31523c10** (main with #63 merged, what went live as #61): not rerun here. The Lead's gates and Jazz's native run were on it.

## Limits

- SQLite, not Postgres or the Worker. Those gates are the Lead's.
- The opening pages comparison opens them; it doesn't edit his days. Editing is covered by the scripts on Books, a page
  added to his data, and by `align-fixtures.ts` for the row types.
- The delay scenarios in `review-fixes.mjs` only delay in Chromium, and `offlineTurnStillOffline` is Chromium-only.

## To run it again

```
node make-store.ts <repo> <backup-dir> <store>        # never on a store that exists
node clear-scratch.ts <repo> <align-copy>             # his template fills the fixture's scratch day
DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=<align-copy> TZ=America/Vancouver node scripts/align-fixtures.ts
node scripts/check-alignment.mjs <url> /day/2026-12-31 /day/<each of his days> /day/<another day this month>
run-scripts.sh <url> <store> <copy> <log-dir>
node compare.mjs <main-url> <this-url> <main-store> <this-store> <out-dir>; node diff.mjs <out-dir>
```
