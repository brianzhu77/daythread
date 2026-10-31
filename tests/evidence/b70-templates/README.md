# B70 part 1: templates, day pages' default

Build: `feat/day-template`, on main 6c0780d.

## How to replay

```sh
DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/b70/ws.sqlite npx vite --host 127.0.0.1 --port 3595
node tests/evidence/b70-templates/flow.mjs http://127.0.0.1:3595   # on an empty store
```

`flow.mjs` (Chromium, 1280 and 390): Templates shows the built-in line; Edit makes "Day", the day pages' default;
the template page shows Default for and the grey line; typing "Water plants" in a to-do and "Gym?" under Notes;
the `/` menu on a template has no Page item; no page errors; a day three days ahead copies "Gym?" and an empty
to-do; Pages doesn't list the template; the list row reads "Default for day pages". Screenshots in `results/`.
In `1280-new-day.png`, "Gym?" is a paragraph because the script's Backspaces after the `/` check turned that
template line into one; the copy keeps the template's types.

## Results (2026-10-31, this Mac)

- `node --test tests/v2-templates.test.ts`: 14 pass.
- `npm test`: 165 pass, 0 fail, 3 skipped. `npm run typecheck` clean. `npm run build` ok.
- `flow.mjs`: 13 checks pass.
- `check-alignment.mjs` on the align-fixtures copy, `/day/2026-10-21 /day/<today> /day/2026-12-31`: 287 passed,
  0 failed, 0 missing (`results/alignment.txt`). It doesn't measure the template screen itself.
- Mutation check: removing the template branch in `save-editor` fails 2 template tests.

Not tested: WebKit, a real phone, Postgres round trip (the row mapping is unit-tested; `pages.type` is unconstrained
text), dark mode screenshots.
