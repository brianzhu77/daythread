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

Not tested: WebKit, a real phone, the Cloudflare Worker path, dark mode screenshots.
- `postgres-roundtrip.ts` on a local embedded Postgres (schema `daythread_b70_check`, dropped after): create Day, save with a titled to-do (no task), new day copies it with fresh ids, clear default, Undo, each step through a fresh repository load: PASS. Stored row: `type=template, parent_id=days`.

## Revision after Ratchet b0315979 and f0e1b4fd (plus Jazz adf1462)

- **Task isolation:** on a template, `EditorTask` reads no task (`rowsOnly`), so no checkbox, row menu or Plan action
  can change a real task; and a pasted or cut row has its task id replaced with `editor-task:<row id>` as soon as it
  lands (suppressed, outside history), not only on save.
  `isolation.mjs <base> <sqlite>` (Chromium 1280, real keyboard cut from today and paste into the template, then a
  click on every template checkbox): on this head 5/5 pass, twice; the real task stays open, same version. **Control:**
  the same script on 745f2f2 fails: the pasted checkbox reads "Complete Preserve real task" and ticking it marks the
  real task done (version 2), Ratchet's finding.
- **Single-flight Edit:** a second click while the first create is on its way does nothing, a retry reuses the page id,
  and `create-template` with `dayPage` returns the existing day default instead of a copy. `dblclick.mjs`: a double
  click with 600 ms POST latency makes 1 template (PASS); unit test for the server side.
- Jazz adf1462 (Edit line only before any template exists; "Templates" crumb) cherry-picked as is.

## Part 2 (`feat/template-subpages`, on ac4dfba)

- "+" New template (blank, title focused, single-flight), Delete (straight delete, notice with Undo, clears its
  default), Default for: None, Day pages, Pages inside any day, Pages in… (documents; a current target that is a day
  or in the trash is kept in the list, marked "in Trash").
- A new empty page made directly inside X starts from X's default; directly inside a day page, from the default for
  pages inside days (the nearer target wins). Top-level pages and pages made with words stay as they are. The template's
  title isn't copied. Targets `days` / `day-subpages` are reserved page ids.
- Checks: `tests/v2-templates.test.ts` 18 pass; `npm test` 169 / 0 / 3; typecheck clean; `flow.mjs` 13 pass and
  `flow2.mjs` 7 pass (Chromium 1280: + New template, Pages in Recipes, a `/` Page in Recipes starts from it, Delete,
  Undo), on a throwaway SQLite.
- Not tested: WebKit, 390, dark, alignment of the list with two rows, Postgres for part 2's targets.

### Part 2 revision (Jazz dbb8b038, Bumblebee 3e77b442, Lead 80555761)

- Fourth target, **Top-level pages** (`"top-level"`, reserved id); both Pages + buttons use it.
- **One creation rule:** any new page whose body is empty starts from the nearest default, however it was made: `/`
  Page, Subpages +, Pages +, `[[` New page with a title, and link pages saved from a paste. A page made with words
  keeps them. A link page's preview still fills in while the page is the template's untouched copy (quote on top,
  title from the preview); once he has written on it, a late preview leaves it alone.
- **Delete** moved to a ⋯ on the crumb row (`RowMenu`), same notice. **Pages in…** lists every document page, nested
  and link pages included; nested ones read "Title · in Parent".
- Checks: template tests 20 pass; `npm test` 171 / 0 / 3; typecheck clean; `flow.mjs` 13 and `flow2.mjs` 7 pass.
