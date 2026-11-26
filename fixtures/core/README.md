# Core cases

The cases the native app (`native/`) is held to, made from the TypeScript domain in `src/domain` so the two cannot drift.

- `documents/`: `{ "document": string }`, a page's stored string, one case per file. `day-with-everything.json` is the day page of 2026-10-22.
- `workspaces/`: the workspace around a document, as the app holds it (what the server sends: no receipts, no undo copy, pages without their synced lines).
- `inline-text/cases.json`: `{ content, pageDate, text }`, what `inlineText` reads from inline content.
- `changes/`: `{ before, changes, after }`, a workspace, the changes a command made, and the workspace they give (`null` when `changes.from` is not `before.revision`).
- `commands/`: `{ before, action, rows: { tasks }, after }`, a workspace, a command, the tasks it is predicted to change, and the workspace after it (`after` is `before` when the server refuses it).
- `day-page/cases.json`: `{ name, workspace, date, live, trashed }`, the id of a date's live day page and of its latest page in Trash (`null` for none).
- `written-days/cases.json`: `{ name, workspace, days }`, the days `writtenDays` counts, sorted.
- `labels/cases.json`: `{ name, workspace, action, label }`, what the outbox's `labelFor` says of a change.
- `today/cases.json`: `{ timezone, at, day }`, the local day of an instant in a time zone.

These files are generated. Never edit them by hand; CI fails when they differ from the domain. To regenerate them:

```sh
npm run fixtures
```
