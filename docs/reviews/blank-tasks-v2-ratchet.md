# B69: blank task lines — independent check

**PASS: no application fix required.** Baseline c9bc2ef (main plus checklist changes), local invented SQLite copy only. Task #230. No production data was accessed or changed.

A stored Task can have an empty title after its words were cleared. That is a retained editor line, not a visible open task. A newly inserted blank checkbox does not create a Task at all until words are typed. Counting stored open rows therefore overstates the task count shown to the user. Current `isBlankTask` filtering already enforces the requested behavior.

## Executed evidence

- **5 new v2 regression tests pass**, in `tests/v2-blank-tasks.test.ts`. They cover blank and whitespace titles, prior-day suggestions/carry, current-day lists/count sources, paused/attention/calendar/Upcoming, search, Markdown export, retained raw backup, same-identity activation/clearing, and fresh placeholder creation. A named child under a blank parent still carries without carrying the blank parent.
- **9 browser assertion groups pass**, Chromium 1280 and WebKit 390, on `/tmp/ratchet230-ui.sqlite`, own port 3667. Morning shows one named task, no blank count or unfinished hint; Tasks Open lists one; retained past-day blank/whitespace checkboxes can be revealed; adding the named suggestion carries only that task and yields one unfinished task; typing a title into the retained checkbox activates the same task and offers it in the morning.
- **Mutation check:** temporarily removing the two blank filters from `getDayView` makes the new regression suite fail. Restoring the original source makes all five pass. No source diff remains.
- Full suite **151 pass, 0 fail, 3 skipped**; typecheck passes. Evidence logs, screenshots, seed and browser replay are in `tests/evidence/ratchet-b69/`.

## Paths audited

`getDayView` filters before constructing planned/dayTasks/openPool/handoff/carry/paused/attention, so dependent task counts consume filtered data. `getCalendarTasks` and `getUpcomingByDate` independently filter blank tasks. Morning suggestions and Tomorrow's unfinished count also guard blank titles. Search indexes only trimmed nonempty text, using the live task title. Markdown skips empty checkbox items; a named child remains exportable.

**Export distinction:** `workspace.json` intentionally preserves all stored task records and editor rows, including blank ones. It is a lossless backup, not a task list. Excluding those records would discard the saved editor state. The regression test locks this distinction in.

**Past-day distinction:** B19 hides initially empty rows on old day pages on screen only. Focusing the TODO heading reveals the section's rows; the saved document keeps them throughout. Today's blank row stays visible. No B19 behavior was changed for B69.

No app change, migration, cleanup of Brian's rows or production deployment is needed. This does not revalidate production rendering or inspect Brian's device; it demonstrates the current code on an isolated copy.
