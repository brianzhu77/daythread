# A12 · row actions on the day page — plan for review

- Author: Roadbuster · 2026-10-21 · status: **plan, not built**. No code until Ratchet's pre-review.
- Inputs:
  - checklist A12 ("Plan-row actions on the day page itself (Not today / Another day / Cancel)", partial: only in
    menus on Tasks, the facts strip, the hand-off and the review);
  - v0.3 `01-flows-and-ux.md` §2 vocabulary and "Deleting rows" (C3, D05), §7 review ("one-tap Done · Tomorrow ·
    Another day ▾ · Not today"); `02` §74 and §86 (one placement per task; a move updates the task, the placements
    and their presentations in one transaction);
  - Lead `d9487ce9` (A12 before A9b) and the A12 brief: entry points, reuse of the task commands, Top 3 / Other,
    Undo, reach at 390;
  - Bumblebee `16ce6fe4`: Tomorrow as its own action; Not today = D05 and the same command as deleting the row; Done
    stays the checkbox; every action with the hand-off's notice + Undo, the row back in its old place; reachable at 390
    with no hover;
  - Jazz: states doc to come, in parallel (entry, look, which rows, cancelled look). This plan doesn't decide those.
- Base: main 0ad04d9. Brian's data: 5 tasks; Oct 18–19 he carried 3 forward and finished 2 (Bumblebee).

## 1. What he can do from a task row on the day page

| Action | Command (existing) | Effect on the task | Effect on this page |
| --- | --- | --- | --- |
| **Tomorrow** | `plan-task { date: today + 1, from }` | planned tomorrow, carry-over on | the row **leaves** this page's plan (§2) |
| **Another day ▾** (Tomorrow · This weekend · Next week · Pick date… · No date) | `plan-task { date, from }`; "No date" = `not-today` | planned that day | the row leaves (§2) |
| **Not today** | `not-today { date: page date }` | paused, `plannedOn` cleared if it was that day; deadline kept (D05) | the row leaves (unchanged: `pause()` already removes it) |
| **Move to Top 3 / Move to Other** | `plan-task { date: page date, section }` | none | the row moves between the two plan sections |
| **Cancel task** | `task-status cancelled` | cancelled, restorable | the row stays, shown cancelled (Jazz) |

- **Same meanings as everywhere else (Bumblebee 2).** These are the commands the Tasks screen, the facts strip, the
  hand-off and the review already send. Not today here and deleting the whole row both end in the same domain
  `pause()`. Done stays the checkbox.
- **Which rows** (my proposal, Jazz decides): open plan rows (`role: plan`) on today's page and on future day pages.
  Reference rows keep their existing "Plan for today" button. Past pages are history: no row actions there. "Tomorrow"
  always means today + 1, as in the review.

## 2. One finding: a moved row stays on the page it left

`plan-task` → `place()` marks the old placement `moved` and adds the row to the new day's page, **but leaves the row on
the old day's page**. `pause()` (Not today) does remove it. Spec 02 §86 says a move updates the task, the placements
and their presentations in one transaction, so the row should go too.

- **Proposal:** `plan-task` gets an optional **`from: LocalDate`**, the day page the move is made from. When it's set,
  the task's plan row leaves that page's plan sections in the same command, exactly as `pause()` does for Not today. A12
  always sends it.
- **Why a parameter and not "always":** today, past pages keep their plan rows as history (yesterday's page still
  shows what was planned, and the hand-off reads it), and the review's "Tomorrow" leaves today's row in place. Changing
  `place()` for every caller would change those too. Lead, the review and the facts strip could send `from` as well,
  so a moved task never still sits in today's Top 3. Recommended, but it's your call whether it goes in this round.

## 3. Running a command while the editor has the page open

These commands edit the open page on the server (the row leaves, or moves section). The editor must never be dirty
at that moment, or its existing refresh reports "Page changed elsewhere · draft kept":

1. **Flush first:** any pending save is sent and confirmed. If that fails, the action isn't sent, and the notice says
   why.
2. **Hold input** during the request (`editor.isEditable = false`, as `performHistory` does for semantic Undo). It's
   one tap on a local server, so a short hold is invisible, and no typing can race the server's rewrite.
3. **Run the command;** the editor then applies the server's page through the existing external refresh, and editing
   is released.

- **Undo** on the notice is the existing `undo` command (the whole workspace as it was before that action), so the row
  comes back in its **old section and position** (Bumblebee 3), and the task's dates and pause come back with it. As
  everywhere, it's refused with "Cannot undo after later changes" if anything was saved since.
- **Notices** are the hand-off's, word for word: "Moved to Fri 10/23 · Undo", "Not today — won't carry over · due Fri
  still tracked · Undo", "Cancelled · Undo" (`useTaskActions`).

## 4. Where the actions are reached (engineering constraints for Jazz's states)

- **Inside the row, not the editor's side handle:** the task row is a custom block (`EditorTask`). A ⋯ button there
  (non-editable, 44 px at 390) is visible on both widths, with no hover needed (Bumblebee 4), and reuses `RowMenu`, the
  menu the other screens use. The side drag handle and the phone's touch handle stay drag-only.
- **Keyboard:** a shortcut while the caret is in a task row opens the same menu. The key is Jazz's call; it must not
  collide with the editor's own shortcuts.
- **Tomorrow as one tap** (Bumblebee 1): either a visible action on the row or the menu's first item. That's design.

## 5. Checks before the candidate

- **Unit:**
  - `plan-task` with `from`: the row leaves that page's plan only; without `from`, nothing else changes (the review,
    the facts strip and past pages behave as today);
  - Undo of each action restores the row in its section and position, and the task's dates and pause;
  - Not today by action and by deleting the row give the same task and placement state.
- **Browser, on a copy of his data, 1280 and 390:**
  - each action from Top 3 and from Other on today and on a future page; the notice text; Undo puts the row back in
    place;
  - type in a line, then use an action at once: the text is saved first, with no "changed elsewhere";
  - the action and the menu are reachable with no hover at 390;
  - the keyboard shortcut;
  - no page or console errors.
- **No format or data change:** no migration, no rollback script. `from` is an optional command field.

## 6. For review

- **Ratchet:** the flush-and-hold sequence (§3); `from` (§2) and its effect on the other callers; Undo's position
  guarantee.
- **Jazz:** which rows; the entry (⋯, Tomorrow as one tap, keyboard); the cancelled row.
- **Lead:** whether the review and the facts strip also send `from` in this round (§2).
