# A12 · row actions on the day page — plan for review

- Author: Roadbuster · 2026-10-21 · status: **plan, not built**. No code until Ratchet's pre-review.
- Revised after Ratchet (section and Top 3 fallback on the server; stale row; Undo ownership) and Bumblebee 9462aa55.
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
  - Jazz `docs/design/day-row-actions-states.md` @ 0f58e8f (the design source: entry, rows, what happens to the row).
- Base: main 27763d3. Brian's data: 5 tasks; Oct 18–19 he carried 3 forward and finished 2 (Bumblebee).

## 1. What each row offers, and the command behind it (Jazz §1–§3)

| Row | Actions | Commands (all existing) |
| --- | --- | --- |
| today's open plan row | Tomorrow · Another day ▸ · Not today · Move to Top 3/Other · Cancel task | `plan-task { date, section, from }` · `not-today { date }` · `plan-task { date: page, section }` · `task-status cancelled` |
| a future day's open plan row | Another day ▸ · Not on {Wed} · Move to Top 3/Other · Cancel task (no Tomorrow) | the same, with `date` = that page's date for Not on |
| reference row (Notes) | Plan for today · Another day ▸ · Cancel task | `plan-task { date: today }` (the row stays: it's a reference) · `plan-task` · `task-status` |
| cancelled row | Restore | `task-status open` |
| done row, draft row | nothing | — |
| a past day's row | Bring to today only | `plan-task { date: today }`, no `from`: the past page keeps its row as history |

- **Same meanings as everywhere else (Bumblebee 2).** These are the commands the Tasks screen, the facts strip, the
  hand-off and the review already send. Not today here and deleting the whole row (Backspace) both end in the same
  domain `pause()` (Jazz §4). Done stays the checkbox.
- **A moved row keeps its section** on the new day (Jazz §3): A12 sends the row's current `section` explicitly
  (`place()` defaults to Other, Ratchet). **The server decides the fallback, in the same command:** with `from` set, if
  the section is Top 3 and the new day's Top 3 is full (the hand-off's `top3Full` rule), `plan-task` places it in Other,
  and the notice says so in the morning card's words: "Moved to Wed, Oct 21 · Top 3 is full · added to {Section} · Undo"
  (Bumblebee 5dfb8155, Jazz §3 @ 9f11ad2; if that day has no plan section left, the morning card's "section created" rule).
  The new day never gets a fourth Top 3 row. **Move to Top 3 on the same page** is still allowed with three rows there
  (Jazz): he's choosing it with them in front of him.
- **"Tomorrow"** is today + 1, as in the review.
- **A stale plan row** (Wed's row, the task now planned for Fri; Ratchet 9abc4857, Bumblebee 9462aa55, Jazz §4 @
  27763d3): its menu offers **"Remove from Wed"** instead of "Not on Wed", and "Not today / Not on {day}" (D05) is offered
  only while the task is planned for that page's day. "Remove from Wed" removes only this row; the task, its pause and
  Fri's plan don't change. Notice: "Removed from Wed · still planned for Fri · Undo". Backspace on the whole stale row
  does the same (`save-editor` already pauses only when `plannedOn` is the page's day).
  - **The server re-checks it**, because the menu is drawn from a workspace that can be a moment old: `not-today` gets an
    optional **`onlyThisDay: true`**, which A12 always sends. Planned for this day → D05 (clear the date and pause).
    Planned for another day → only this page's plan row is removed, and the receipt is the "Removed from Wed" line. A move
    made on another device a moment earlier can't turn into a pause.
  - Other callers of `not-today` (the facts strip's Continue, the hand-off) don't send it and behave as today.

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
  so a moved task never still sits in today's Top 3.
- **Only today and future pages lose the row (Bumblebee c67dfc97):** a past day's page keeps its rows as his record of
  that day, matching past days offering only Bring to today. One entry point can start from a past page: the evening
  review opened after midnight acts on yesterday. So `from` travels with **`today`** (the browser's day, as
  `save-editor` already sends it), and the server removes the row only when `from >= today`.
- **Lead 6c169851: yes, this round.** The review and the facts strip
  send `from` too, with one test each (A5 review, A8 card): "moved to another day → the row leaves the old page,
  appears on the new one, Undo puts it back in place".

## 3. Running a command while the editor has the page open

These commands edit the open page on the server (the row leaves, or moves section). The editor must never be dirty
at that moment, or its existing refresh reports "Page changed elsewhere · draft kept":

1. **Flush first:** any pending save is sent and confirmed. If that fails, the action isn't sent, and the notice says
   why.
2. **Hold input** during the request (`editor.isEditable = false`, as `performHistory` does for semantic Undo). It's
   one tap on a local server, so a short hold is invisible, and no typing can race the server's rewrite.
3. **Run the command;** the editor then applies the server's page through the existing external refresh, and editing
   is released.

- **Undo belongs to the server, not to editor history (Ratchet):** the notice's Undo is the existing `undo` command
  (the whole workspace as it was before that action), so the row comes back in its **old section and position**
  (Bumblebee 3), with the task's dates and pause. It goes through the same flush → hold → command → refresh sequence, so
  no autosave can follow it and delete the row again. As everywhere, it's refused with "Cannot undo after later changes"
  if anything was saved since.
- **The refresh that applies a server change is kept out of editor history.** Today the external refresh's
  `replaceBlocks` is an ordinary history step, so ⌘Z right after any server-side change to the open page would undo it
  locally, and the next save would write it back: for A12, a moved row's text would reappear without its placement. The
  refresh is applied with `addToHistory: false`. That fixes every server-driven refresh (Put back, the hand-off), not only
  A12, and ⌘Z then never reverses a server action; the notice's Undo does.
- **⌘Z after an action (Ratchet 980d5695):** while the action's notice is showing, ⌘Z runs that same server Undo (Jazz §4,
  the A2 pattern: a keydown in front of BlockNote's, only while nothing was edited since): the row and its placement come
  back together. Once the notice is gone, ⌘Z never brings the row back locally (the refresh isn't in editor history).
- **A failed action (Ratchet):** if the flush or the command fails, the editor is released at once, the typed draft is
  kept as it was, and the notice says the action didn't happen.
- **Notices** are the hand-off's, word for word: "Moved to Fri 10/23 · Undo", "Not today — won't carry over · due Fri
  still tracked · Undo", "Cancelled · Undo" (`useTaskActions`).

## 4. Where the actions are reached (Jazz §1)

- **1280: ⋯ at the end of the row,** shown on hover and while the cursor is in the row, and reachable by Tab. It's a
  non-editable button inside `EditorTask`, opening the existing `RowMenu`.
- **390: the grip handle.** Tapping it selects the row, and the bottom selection bar becomes **Tomorrow · Another day ·
  Not today · ⋯** (44 px each) for a single open task row. Other selections keep "1 selected · Delete". **Jazz §6: yes,
  the bar can switch by row type:** it's our own React element (`editor-selection-bar`), and the selected block's type,
  role and task are known from `selected.current`.
- **Keyboard:** the menu opens from the caret in a task row; the key is in Jazz's doc.

## 5. Checks before the candidate

- **Unit:**
  - `plan-task` with `from`: the row leaves that page's plan only (and never when `from` is before `today`), the section is kept, a full Top 3 falls back to Other
    with that in the receipt; without `from`, nothing else changes (the review, the facts strip and past pages behave as
    today);
  - `not-today` with `onlyThisDay`: planned here → D05; planned for another day → only the row leaves, the task
    unchanged; without it, as today;
  - Undo of each action restores the row in its section and position, and the task's dates and pause;
  - Not today by action and by deleting the row give the same task and placement state;
  - moving into a day whose Top 3 already holds this same task (three rows) doesn't count the task against itself and
    keeps it in Top 3 (Ratchet).
- **Browser, on a copy of his data, 1280 and 390:**
  - each action from Top 3 and from Other on today and on a future page, per row type (§1); the notice text; Undo
    puts the row back in its section and position; a moved row lands in the same section (Other when Top 3 is full);
  - Backspace on a whole plan row and Not today from the menu leave the same state;
  - type in a line, then use an action at once: the text is saved first, with no "changed elsewhere";
  - an action, then ⌘Z with the notice showing: the row and its placement come back together; after the notice is gone,
    ⌘Z doesn't bring the row back, and a following save keeps the state;
  - a failed action (server stopped): editing is released, the draft is kept, and the notice says so;
  - the action and the menu are reachable with no hover at 390;
  - the keyboard shortcut;
  - no page or console errors.
- **Regression of every ⌘Z path the refresh change touches (Lead):** Put back, the morning hand-off's actions, A2's
  paste Undo, and ordinary typing Undo, each checked in the browser after the change.
- **No format or data change:** no migration, no rollback script. `from` is an optional command field.

## 6. For review

- **Ratchet:** the flush-and-hold sequence (§3); `from` (§2) and its effect on the other callers; Undo's position
  guarantee.
- **Jazz §6, answered:** the selection bar can switch by row type (§4), and `plan-task` carries the section (§1).
- **Lead:** whether the review and the facts strip also send `from` in this round (§2).
