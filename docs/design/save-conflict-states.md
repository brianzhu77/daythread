# Save conflict: "Load latest" states

- Author: Jazz (Design) · 2026-10-21 · status: **design states, approved in principle** (Lead `8781f41f`); slotted
  after B20, about a day, Roadbuster builds.
- Inputs:
  - Jazz `b76290d5`: today every failed save shows "Retry saving · Copy draft". After a conflict, Retry hits the same
    conflict, and there's no way to load the latest;
  - Bumblebee: no clipboard (it would silently replace what he copied last); his version goes back into the page as
    ordinary lines, the same rule as the B21 conflict (`synced-block-states.md` §5); new tasks stay tasks;
  - Roadbuster's engineering notes 1–4 (the spec): the draft kept in this browser must be cleared once his version is
    in the page, or a reload brings the conflict back; lines matched by id; tasks; Undo is the editor's own;
  - Jazz `14b0d3a9`: "his changes" are measured against what the page held **when he started**, not against the latest.
- **Editor only.** No format change, no command.

## 1. Two failures, two lines

The editor's status line (`editor-save-line`) splits by cause.

| Cause | Status line | Buttons |
| --- | --- | --- |
| **Network or server failure** (anything that a retry could fix) | "Couldn't save · draft kept" | **Retry saving** · Copy draft (unchanged) |
| **Conflict:** the page changed elsewhere since he started | "Changed in another tab · draft kept" | **Load latest** (only) |

- No "Copy draft" on a conflict: Load latest already keeps every word, and two buttons make him decide something he
  doesn't need to.
- "Another tab" covers his other devices too; it's the words he'd use for the case we can see (two tabs).
- Same text and buttons at 1280 and 390, 44 px buttons at 390.

## 2. What Load latest does

One step, then one notice.

1. The page loads its latest content.
2. **His changes** are found by comparing his draft with the page **as it was when he started** (the save's starting
   point), matched by line id:
   - a line he **changed** → his text goes **right below that line** in the latest page, as a new line;
   - a line he **added** → right after the line it followed in his draft;
   - if that neighbouring line no longer exists in the latest → at the **end of the page**;
   - a line **only the other side changed** → untouched (it isn't his change, even though his draft has the old text);
   - a line he **deleted** → not repeated; the latest page wins for deletions. Nothing he typed is lost by that.
3. **Tasks** (Bumblebee):
   - a task he **added** in his draft comes back **as a task**, in its place, so it stays in his plan and carry-over;
   - a task that already exists in the latest isn't inserted again (no duplicate task);
   - if he **edited the title** of an existing task, his title comes back as a **plain line** below the task, so his
     wording survives without a second task.
   If new and existing tasks can't be told apart reliably, all of them come back as plain lines and the notice adds
   "tasks came back as text" (Bumblebee's fallback).
4. The draft kept in this browser is cleared **after** his lines are in the page (Roadbuster 1), then the page saves
   normally.
5. Notice, the editor's existing strip:
   - **"Latest loaded · your changes are below their lines · Undo"**;
   - with the fallback: "Latest loaded · your changes are below their lines · tasks came back as text · Undo";
   - if he had no changes left after the comparison (the other side made the same edit): "Latest loaded".
   **Undo** is the editor's undo of the insert: the latest page without his lines. It does not bring the conflict
   back; his draft is gone from the browser by then, and that's fine because Undo only removes lines he can see.
6. The caret goes to the first inserted line, scrolled into view, so he sees where his text went.

## 3. States checklist (copy of his data, two tabs, 1280 and 390)

1. A and B open the same day. B types in line 2; A changes line 5 and saves; B saves → "Changed in another tab ·
   draft kept · Load latest", no Retry, no Copy draft.
2. Load latest → line 5 shows A's text, B's line-2 text sits below line 2, A's line 5 is **not** duplicated or undone.
   Notice and caret as §2.5–6.
3. Reload B afterwards → no conflict comes back (the browser draft was cleared).
4. B adds a task in its draft → after Load latest it's a task on the plan, once. B edits an existing task's title →
   the task once, plus B's title as a plain line below it.
5. A deletes the line B was editing → B's text lands at the end of the page.
6. Undo on the notice → the latest page exactly, without B's lines.
7. Network failure (server stopped) → "Couldn't save · draft kept · Retry saving · Copy draft", and Retry works once
   the server is back.
8. Geometry: the status line at 390 fits with its button, nothing clipped (`check-alignment` unaffected).
