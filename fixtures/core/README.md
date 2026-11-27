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
- `content-key/cases.json`: `{ name, document, key }`, a page's stored string and its `pageContentKey` (a synced block is stored without its lines, and the key is of that form).
- `saves/`: one file per save. `{ before, operationId, expectedRevision, action, after, message }` for a `save-editor` the server takes, `{ before, operationId, expectedRevision, action, refused }` for one it refuses (the domain's message). `same-operation-twice.json` also has `second: { message, after }`, the answer to the same command sent again.
- `today/cases.json`: `{ timezone, at, day }`, the local day of an instant in a time zone.

The to-do row. The script runs in a fixed time zone and never reads the clock; every case states its `today`, which is Thu 2026-11-26 unless it says otherwise.

- `dates/words.json`: `{ date, today, daysBetween, weekday, shortLabel, longLabel, near, sinceLabel, nextDayLabel }`, a date worded the web's ways.
- `dates/tags.json`: `{ name, deadlineOn, attentionOn, today, pageDate, planned, text, passed }`, `taskDateTag` and `deadlinePassed` for each shape of a to-do's dates on today's page, a past page and a future page, planned and not.
- `rows/menus.json`: `{ name, status, role, planned, pageDate, today, menu }`, what `rowMenu` offers (`null` for nothing).
- `rows/another-day.json`: `{ today, options }`, `anotherDayOptions` for a week of days.
- `rows/marks.json`: `{ name, workspace, pageId, blockId, today, planned, marks }`, what `rowMarks` says of one row (its role and plan day are the block's props); `planned` is the `plannedOn` of every to-do of the workspace.
- `carried/cases.json`: `{ name, workspace, taskId, today, since, label }`, `carriedSince` and its `Since` words (`null` for none).
- `repeats/words.json`: `{ rule, words, markName }`, a repeat rule in words and as the mark's name.
- `blockers/cases.json`: `{ name, workspace, blocked, words }`, each blocked to-do's blockers in link order and the words drawn.
- `notices/cases.json`: `{ name, intent, task, day, today, receipt, plannedAfter, text }`, the notice `rowNoticeText` gives a row action.
- `actions/`: one file per row command. `{ before, intent, taskId, day, today, action, receipt, after, plannedAfter, notice }` for one the server takes (`action` is the web's `rowAction`, `after` holds the Undo marker `{ operationId: "cmd-<name>", revision }`; `undo` has no intent and `plan-for-today-from-a-reference-row` the button's own notice), `{ before, operationId, today, action, refused, notice }` for one it refuses.

These files are generated. Never edit them by hand; CI fails when they differ from the domain. To regenerate them:

```sh
npm run fixtures
```
