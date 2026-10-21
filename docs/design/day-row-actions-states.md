# A12 · Row actions on the day page: states

- Author: Jazz (Design) · 2026-10-21 · status: **design states for review**. Base main dbde533.
- Inputs:
  - v0.3 `01-flows-and-ux.md` §2 (the vocabulary table, "Deleting rows", D05) and §9.2;
  - checklist A12 ("only in menus on Tasks, facts strip, hand-off, review");
  - Lead `011b524e` (A12 next: entry points, reuse of the task commands, Top 3 / Other, Undo, reach at 390);
  - Bumblebee `16ce6fe4` (Tomorrow as its own tap, D05 unchanged, Undo puts the row back in place, no hover on the
    phone).
- **Evidence:** on Oct 18–19 he had 4 tasks, carried 3 forward and finished 2 (Bumblebee). Moving a task on is a
  daily, morning action, and today it needs a trip to the Tasks screen.
- **Nothing new in meaning.** Every action is an existing command with its existing notice (`task-row.tsx`
  `useTaskActions`, v0.3 §2). A12 only puts them on the day page's own rows.

## 1. Which rows get actions

| Row (editor task row) | Actions |
| --- | --- |
| Open **plan row** on today (Top 3 / Other) | **Tomorrow** · **Another day ▸** · **Not today** · Move to Top 3 / Move to Other · Cancel task |
| Open plan row on a **future** day | **Another day ▸** · **Not on {Wed}** · Move to Top 3 / Other · Cancel task. Tomorrow is left out because it's relative to today, not to the page |
| Open **reference** row (a task shown outside the plan sections) | Plan for today (already on the row) · Another day ▸ · Cancel task |
| **Done** row | none. The checkbox reopens it, as now |
| **Cancelled** row | **Restore** |
| Row on a **past** day | Bring to today (existing past-page rule; the placement there is read-only) |
| Draft row (typed, not yet a task) | none |

**Done stays the checkbox** and never goes in the menu (Bumblebee 2).

## 2. Where they're reached

One action set, two surfaces, so there's nothing to learn twice.

- **Desktop, 1280:** a **⋯** button at the end of the row, shown on hover and while the cursor is in that row (so
  it's reachable by keyboard: Tab from the row's text lands on it, Enter opens it). It opens the app's existing
  `RowMenu`, the same menu as on the Tasks screen:
  - Tomorrow · Wed, Oct 21
  - Another day ▸ This weekend · Next week · Pick date…
  - Not today
  - divider · Move to Other (or Move to Top 3)
  - divider · Cancel task (red)
  The ⋯ sits left of the date tag, so the tag never jumps when it appears.
- **Phone, 390, no hover (Bumblebee 4):** tap the row's **handle** (the grip at the right edge, which today selects
  the block and shows "1 selected · Delete"). For a single task row, the existing bottom **selection bar** shows the
  actions instead:
  ```
  [ Tomorrow ]  [ Another day ]  [ Not today ]  [ ⋯ ]
  ```
  Each button is 44 px tall. ⋯ opens Move to Top 3 / Other, Cancel task, and Delete line. The bar replaces
  "1 selected · Delete" only for one open task row. Any other selection keeps today's bar.
- **Keyboard:** Backspace or Delete on a selected whole plan row stays **Not today** (D05), the same command as the
  menu item (Bumblebee 2). No new shortcuts in A12.

## 3. What each action does to the row

| Action | Task | The row on this page | Notice |
| --- | --- | --- | --- |
| Tomorrow / Another day | planned for that date, deadline unchanged | **leaves** this page and appears on that day in the **same section** (Top 3 stays Top 3) | "Moved to Wed, Oct 21 · Undo" |
| Not today / Not on {day} | leaves that day, carry-over paused, deadline and start kept | **leaves** this page | "Not today — won't carry over · due Fri still tracked · Undo" (the "due" part only when there's a deadline) |
| Move to Top 3 / Other | none (display only) | moves to the **end** of the other section | none, ⌘Z undoes it (v0.3 §2) |
| Cancel task | cancelled, restorable | **stays**, muted and struck through, with "Cancelled" | "Cancelled · Undo" |
| Restore | open again | stays, back to normal | "Restored · Undo" |

- **The row leaves; nothing jumps.** The lines below close up, and the cursor (if it was in the row) goes to the end
  of the line above. The notice is the editor's existing strip, so the phone bar and notice never stack: the
  selection bar closes when an action runs.
- **Undo comes from the action's own server operation, not the editor's history,** so the restored row stays: the
  next autosave can't remove it again (Ratchet `9abc4857`). ⌘Z right after an action does the same Undo while its
  notice is showing, as in A2.
- **Undo puts the row back exactly** in its old section and position, with its text (Bumblebee 3), and puts the task
  back to its previous plan date and carry-over state. If the page has changed since and the old position is gone,
  it goes to the end of its old section. It never goes into the wrong section.
- **Moving a Top 3 row to a day whose Top 3 already has 3 rows** (Bumblebee `5dfb8155`): it goes to that day's plan
  list instead, and the notice reads "Moved to Wed, Oct 21 · Top 3 is full · added to {Section} · Undo", the morning
  card's wording (`morning-card-build.md` §6). The new day never gets a silent 4th Top 3 row. If that day has no plan
  section left, the morning card's "{Section} section created" rule applies.
- **Move to Top 3 on the same page with three rows already:** still allowed, because he's choosing it there, in
  front of the three rows. Top 3 is a section name, not a hard limit, the
  same as dragging a row there today.
- **The facts strip and the morning card** update at once, as they do for the same commands from the Tasks screen.

## 4. Edge cases

- **The task was changed on another device** after the page loaded: the action applies to its current state, and
  Undo restores what this action changed (the existing versioned Undo, v0.3 §8 "Undo blocked" if it can't).
- **A row whose task is now planned on another day** (a stale plan row, e.g. Wed's row after the task moved to Fri;
  Ratchet `9abc4857`): the actions follow the **task's current state**, not the page. That row is shown and treated
  as a **reference row**: its date tag reads "Do Fri", and it offers Plan for {this day} · Another day ▸ · Cancel
  task. **No "Not today / Not on {day}"**, because that would pause the carry-over of a plan that lives on another
  day. Backspace on it removes only the line (it's a reference now), with "Reference removed · Undo".
- **In general, "Not today / Not on {day}" is offered only when the task is planned on that page's day right now.**
- **The save is still pending** when he taps an action: flush first, then act (the A2 rule), so the row's latest
  title is what moves.
- **Read-only pages** (past days, trashed pages): no ⋯ and no bar actions except Bring to today on past days.

## 5. Checks (his data copy, 1280 and 390)

1. Today, Top 3 row → ⋯ → Tomorrow → the row leaves, "Moved to Wed, Oct 21 · Undo", and the row is in Top 3 on
   Wed's page. Undo → back in the same Top 3 position. With Wed's Top 3 already full → "… Top 3 is full · added to
   {Section}" and the row is in Wed's plan list.
2. Today, Other row → Not today → "Not today — won't carry over · Undo". It doesn't come back tomorrow. Undo → back in
   place, carry-over on again.
3. The same row deleted with Backspace gives the same notice and result as 2.
4. Another day → Pick date… → the native picker on 390 and on 1280.
5. Move to Other / Top 3 → end of the other section, ⌘Z moves it back, no notice.
6. Cancel task → struck through with "Cancelled" → ⋯ → Restore.
7. 390: tap the handle on a task row → the bar shows Tomorrow / Another day / Not today / ⋯, each at least 44 px,
   and fits at 390 with no overflow. Tap the handle on a text line → "1 selected · Delete" as before.
8. Keyboard at 1280: from the row's text, Tab reaches ⋯, Enter opens the menu, ↑↓ and Enter choose, Esc closes.
9. A future day's row shows "Not on Wed" and no Tomorrow. Move that task to Fri from the Tasks screen → Wed's row
   reads "Do Fri" and offers no "Not on Wed". A past day's row offers only Bring to today.
10. Done and draft rows show no ⋯.

## 6. Open questions for the plan

- Can the phone's selection bar switch its contents by row type without changing how selection works for text?
- "Same section on the new day": does `plan-task` already carry the section, or does the plan need to pass it?
