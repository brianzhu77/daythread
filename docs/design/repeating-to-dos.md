# Repeating to-dos: design

- Author: Claude · 2026-11-24 · status: **proposal, waiting for Brian's approval. Not built.**
- Asked by Brian (2026-11-24): add repeating to-dos; look at how Todoist and TickTick do it, then design and plan ours. He
  suggested a to-do line that expands on focus to show extended properties, stored either as block properties
  (Notion's way) or in a separate table, and left the choice to me.
- Listed as out of scope in `day-template-states.md` §5 and `specs-v0.3/00-scope.md`. Nothing here is built on use:
  Brian named no particular to-do he wants repeated, so the examples are illustrations.
- **Evidence:** Todoist's help pages on recurring dates and on completing a recurring task, TickTick's own post on
  repeating from the completion date, and Cultured Code's notes on Things 3.23. I read them on 2026-11-24 and used none of
  the three apps for this. Anything about them marked "from memory" isn't confirmed.

## 1. What the others do

| | Where the rule lives | Ticking it | Schedule or completion | Missed days | Stopping |
| --- | --- | --- | --- | --- | --- |
| **Todoist** | In the due date, typed as words ("every mon", "every 3 days") | The same task stays open and its date jumps to the next one. The finished one is only in the activity log | `every` keeps the schedule; `every!` counts from the day it was done | Only future dates are made: done late, it jumps past what was missed | "Complete forever" in the task's menu |
| **TickTick** | A Repeat field in the date picker: daily, weekly, monthly, yearly, weekdays, custom | The task moves to its next date and a finished copy is kept (from memory) | "Due date" or "Completion date" | Stays overdue until done, then moves on (from memory) | End date or a count; Skip for one (from memory) |
| **Things 3** | A repeating to-do is a template that makes copies | The copy is finished like any to-do | Fixed schedule, or after completion | A fixed schedule makes the next copy whether or not the last is done | Stop the template. Since 3.23 a change asks: this one only, or the rule |
| **Notion** | A repeating template of a database | A new row each period | Schedule only | Runs on their server | Turn Repeat off |

Notion's is already ours for databases (R4-6, `automations.md` §6, `src/domain/repeats.ts`).

What I take from them:

- Everyone offers both counts: by the schedule ("pay rent on the 1st") and from the day it was done ("water the plants
  5 days after the last time").
- Todoist and TickTick never stack missed ones: one live to-do, and what was missed is skipped. Things' fixed schedule
  stacks copies, which is its known annoyance.
- Todoist's single moving task leaves no finished record on a day. That's the part that can't work here (§2, A).

## 2. Approaches

**A. One to-do whose day moves (Todoist).** A tick doesn't finish it; its Planned day jumps on. Smallest to store.
It breaks what a day page is: Monday's line is the same to-do as Wednesday's, so Monday can't show it done. It would read
"Moved to Wed", as if he had put it off. A finished to-do stays on the day it was finished (R2-9), and `doneOn` holds one
day. Rejected.

**B. A repeat that makes a new to-do when the last one is finished (chosen).** Each time is its own to-do with its own
line, tick and day. The rule is kept apart from any one of them, and names the one that's current. Ticking the current
one makes the next, planned on its day. Monday's page keeps Monday's, done. Until it's ticked it's an ordinary open
to-do, so carry-over, Not today, Upcoming, the calendar, To-dos views and reminders already handle it.

**C. Make to-dos on a schedule, as database templates repeat (R4-6).** Reuses `run-repeats` whole. But it makes one
each period whether or not the last was done, so after a long weekend today's page holds three of the same line, since
carry-over brings the old ones too. It can't count from the day something was done. Rejected as the mechanism; its
schedule arithmetic and its editor are reused (§6).

### Where the rule is stored

| | Verdict |
| --- | --- |
| **On the line (block props)** | No. A line is only where a to-do shows: a carried to-do has a line on each day, and a copied line is the same to-do (B22). The rule would be copied and drift apart, and it has to outlive the line, since the next one is a new line on another page. |
| **A field on the task** | No. The rule belongs to the run of to-dos, not to one. And an older build writes a task's row whole without it (`workspace-rows.ts` `taskRow`), so an old tab or a rollback would drop it. `todo-dependency.md` §4 met the same thing. |
| **A table of its own (chosen)** | As links and comments are: an older build never reads or writes it, and one row per repeat names its current to-do. |

### A line that expands on focus

Not in this design. My reasons:

- To-dos take no extra properties (`databases.md` §11, option 1). There are four facts besides the words (Planned,
  Start, Deadline, Blocked by) and this adds a fifth, so there's no open-ended list for a panel to hold.
- A panel that opens under the line with the caret pushes every line below it down. The Blocked by mark already had to
  be designed around that ("nothing jumps under a finger", `todo-dependency.md` §2). On the phone, focus also raises the
  keyboard, which leaves the panel little room.
- A to-do's actions already have a home: the line's `⋯` at 1280 and the selection bar at 390 (`day-row-actions-states.md`).
  Blocked by went there. Repeat goes next to it.

If Brian wants one place on a line for all of a to-do's facts, that's a design of its own, and it would also cover
Start and Deadline, which a line can't set today. The Repeat editor below is one self-contained panel, so it could move
into such a place unchanged.

## 3. What Brian sees

- **Nothing, until a to-do repeats.** A to-do with no repeat looks as today, pixel for pixel.
- **Setting it:** in an open to-do's menu, under `Blocked by…`: **`Repeat…`**, wherever that menu is today: a day
  page's lines (the `⋯` at 1280, the bar's `⋯` at 390) and Tasks. A line on a document page has no menu today
  (`rowMenu` returns null without a page date) and gets none here, so its to-do is set from Tasks; once it repeats, the
  icon below opens the editor there too. It opens a popover at 1280 and a sheet at 390 with the fields of the database
  Repeat menu (`RepeatSettings` in `database-menu.tsx`), less the time:

  ```
  Repeat        [ Weekly      v ]     Off · Daily · Weekly · Monthly · Yearly
  Every         [ 1 ] week
                S  M  T  W  T  F  S   Weekly only
  From          [ Its day     v ]     Its day · When it's done
  Ends          [ Never       v ]     Never · On a date
  Next Mon, Dec 7
  ```

  With From set to "When it's done" the next day depends on the day he ticks, so the last line reads
  "Next Sun, Nov 29 if done today". Once set, the menu item reads `Repeat · Every week…`.
- **Seeing it:** every line of the current to-do, plan or reference, on any page, carries a small repeat icon at its
  end, with the deadline and "Since" in the one group there (`editor-date-tag`); Tasks and Upcoming show it too. It's an icon alone so that a to-do's words wrap
  as they do now at 390; its accessible name says the rule ("Repeats every week"). A tap opens the same editor. Like
  the Blocked by mark it isn't text: the caret skips it, a copy of the line leaves it out, and a tap on a phone raises
  no keyboard. **Finished ones carry no icon:** they're ordinary done to-dos.
- **Ticking it:** the line is done and stays on its day, as any to-do. The box shows the tap at once, as now. When
  the server answers, the notice reads **"Done · Next Mon, Dec 7 · Undo"** and the next one is on that day's page and
  in Upcoming. Each screen keeps the words its tick notice has today and adds the day: a day page says "Task
  completed · Next Mon, Dec 7", Tasks says "Done · Next Mon, Dec 7" (`page-editor.tsx`, `task-row.tsx`). Undo takes
  back the tick and the next one together. **Offline,** the notice is the plain one that screen has today; the
  next one appears when the tick is sent, with no late notice. The browser never draws the next line ahead of the
  server (`draw-ahead.ts`: nothing he can type into is shown before the server has it).
- **Not ticking it:** nothing new. It carries over as any open to-do, and no second one is made while it's open.

## 4. Rules

- **One current to-do per repeat.** The next is made only when the current one is finished, so missed days never stack.
- **Where the schedule starts:** at the to-do's Planned day when the repeat is set, or that day (today) if it has none,
  as a to-do only on a document page or a paused one. That start is fixed and is the first slot, so "monthly" from the
  31st stays the 31st after a February. Weekly picks that day's weekday unless he picks others; if the ones he picks
  leave its own day out, the current one stays where it is and the next follows the schedule. Changing Repeat, Every or
  the weekdays starts the schedule again from the current one's slot. Changing only From or Ends doesn't.
- **The next day, "Its day":** the first day of the schedule after both the current one's slot and today. The slot is
  the schedule day it was made for, kept with the repeat, since Planned moves with carry-over and with Another day.
  Weekly on Monday: done on Wednesday, next Monday; done on the Saturday before, the Monday after its own. Daily,
  carried from Monday and done on Wednesday: Thursday.
- **The next day, "When it's done":** the day it was finished plus the interval. Weekdays aren't offered here.
- **Monthly and yearly keep their day where they can:** from the 31st, February's falls on its last day (as
  `repeats.ts` does now).
- **What the next one copies:** the line's words with its tags, links and page references. Start and Deadline keep
  their distance from the slot (due two days after its day stays so). A `@date` chip in the line moves by the same
  number of days and keeps its time, so its reminder follows. It doesn't copy Blocked by links, comments or lines
  nested under it; those stay with the finished one.
- **Where the next one's line goes:** on its day's page where a planned to-do goes today (`planOn`: with the other
  to-dos), making the day page if there isn't one, as Another day does.
- **Another day and Tomorrow** move the current one only. The slot and the schedule don't change.
- **Not today** pauses it as any to-do. The repeat waits with it, as nothing is made until it's done.
- **Cancel task** cancels this one and makes the next: "Cancelled · Next Mon, Dec 14 · Undo". It's how one is skipped,
  with a record on its day. Stopping the repeat is `Repeat…` → Off.
- **Off** keeps every to-do it made, the current one included, as ordinary to-dos.
- **Changing the rule** counts from the current one: its day doesn't move, and the next is worked out by the new rule.
  No date moves for a reason he didn't state (`todo-dependency.md` §3).
- **Ends on a date:** when the next day would fall after it, none is made and the notice is the plain "Done".
- **Renaming the current one** renames it alone; the next copies its words as they are then. Finished ones keep theirs.
- **Reopening the one just finished,** by its box or by Restore after Cancel, takes the next one back while that one
  is as it was made: open, on the day it was made for, with the same words. The reopened one is current again. A second
  tap on a box is a fresh "open", not an Undo (`task-ticks.ts`), and without this rule a slip of the finger would leave
  two of the same repeat to carry onto one day. If the next one has been touched (moved, renamed, ticked), both stay
  and he decides. The repeat remembers one step back only: reopening an older one leaves it an ordinary open to-do.
- **Deleting the current one's last line** deletes the to-do as today, and its repeat goes out of force but is kept,
  as links are, so Undo or pasting the cut line back brings the repeat back with no extra write.
- **A copied line** is the same to-do, so it repeats. A template's to-dos and `Make a copy` carry no repeat.
- **The day draft, search and blank to-dos:** unchanged. The draft is sent no repeat. A to-do with no words can't repeat.
- **Rules on To-dos** (`automations.md` §7): the next one counts as a to-do added, once, and rules don't run on what
  that sets off in turn.
- **Export:** "Repeats every week" on the current to-do's line.

## 5. Not in the first version

- Typing the rule as words ("every mon"), Todoist's way. It belongs with natural-language capture, which is undecided
  (`PRODUCT.md`); the stored rule is what it would write.
- "The 3rd Friday", "the last day of the month", an end after a number of times.
- Lines nested under a repeating to-do coming back unticked (Todoist's "Reset sub-tasks"). The obvious next step, for
  routines with steps.
- A count, streak or history of a repeat. Finished ones aren't tied back to it, so this needs its own storage.
- A time of day. A to-do has a day; a time is a `@date` chip on its line.
- A Repeat column in To-dos views. Phase 3 below, read-only.

**It fails, even if it works, if:** a to-do that doesn't repeat changes in any way; a tick gets slower; a day ever
shows two of the same repeat that he didn't make; or a date or line moves on a page he isn't looking at, other than the
one new line the notice names.

## 6. For the builder

- **Storage:** a `todo_repeats` table (name is the builder's), one row per repeat: its id, the current to-do's id and
  slot, the one before it and its slot (for §4's reopening; null at first), `start`, `every`, `interval`, `weekdays`,
  `from` (`schedule` or `done`), `until`, `createdAt`. `Workspace.repeats?`,
  absent until there's one, in `RowDiff` as `links` is, so an inverse written by an older build leaves it alone. A repeat
  whose to-do is missing is kept, not in force. Bound the number per workspace and refuse over it; name the number
  after measuring.
- **Schedule arithmetic:** reuse `Repeat`'s `every`, `interval`, `weekdays` and `start`, and `occurrences` in
  `repeats.ts`, behind one new function for "the first day after this one". Calendar weeks go by the Week starts
  setting, as there.
- **Commands:** one new one to set, change or turn off a to-do's repeat, with one Undo. `task-status` and
  `edit-todos` make the next one inside the same operation when a repeat's current to-do goes to done or cancelled,
  under the workspace lock, and the receipt says which to-do and day, for the notice. The next one's id is made from
  the repeat and the slot, as `repeatRowId` is, so a retry, two tabs or a rollback can't make it twice.
- **An older tab against the new server** makes the next one too, as the server runs the command for every tab
  (`postgres-repository.ts`). It shows its plain "Task completed". The next one needs the tick's `today`: a tick sends
  it, but no Cancel does today (`task-row.tsx`, `page-editor.tsx`, `todos-source.ts`), so the new build's three Cancel
  callers send it, and a Cancel that comes without one makes nothing in the command and is left to the mend.
- **The floor build's server** ticks it and makes no next one. `run-repeats`, on opening the app, mends that and a
  Cancel without a day: a repeat in force whose current to-do is finished gets its next one, once, saying nothing, as
  scheduled rules don't. **The mend never writes to a past day.** "Its day": the first schedule day on or after today
  that's after the slot. "When it's done": the day it was finished plus the interval, or today if that has passed; with
  no day recorded, today plus the interval.
- **A tick now writes another page's document.** `task-status` is drawn by its own path today (`draw-ahead.ts`:
  `own`) and changes no document; `edit-todos` ticks too and is drawn `ahead`. Neither prediction makes the next line
  (§3). When the next one's day page is open in an editor with unsaved words (tomorrow's page in the main pane, today's
  in peek), the new build's tick has to go the way row actions do: flush, hold, command, apply (`row-actions.tsx`).
  An older tab can't be taught that: there the page's next save meets the save-conflict state it already has for a
  change made elsewhere, with what he typed kept. This is the one place I expect trouble.
- **Cost:** the icon needs "is this to-do some repeat's current one" on every line. Work it out once per copy of the
  workspace, as `blockedIn` does, and measure a day against R1-18's bar.

**Phases, each shippable:**

1. The table, the schedule function, the commands, the mend on open, and tests. No screen.
2. `Repeat…` in the menus, the editor at 1280 and 390, the icon, the notices.
3. Export, and a read-only Repeat column offered under Properties in To-dos views.

## 7. Checks before release

- A to-do with no repeat is unchanged on a copy of Brian's real data at both widths; the geometry gate at 1280 and
  390; a day under R1-18's bar with repeats present; the tick's real speed on a repeating to-do.
- Set, change and Off, one Undo each, at both widths, by keyboard too.
- Daily, weekly with two weekdays, every 2 weeks, monthly from the 31st, yearly from Feb 29: done on its day, late,
  early, and on a past day's page.
- "When it's done" after a late finish. Ends on a date, on the last one.
- Carried for five days, then ticked: one next one, on the right day, and no second line anywhere.
- Tick, then Undo: the tick and the next one both go, and its day page is as it was. Tick, then tap the box again,
  and Cancel then Restore: the next one goes and the first is current. The same after the next one was moved, renamed
  or ticked: both stay. Reopening one from two steps back: an ordinary to-do.
- A repeat set on a to-do with no Planned day, on a paused one, and with weekdays that leave its own day out. A rule
  changed mid-run: monthly from the 31st still lands on the 31st in March.
- Offline: tick, "Done", then back online: one next one, no late notice. A tick from a To-dos view (`edit-todos`).
- The mend after a floor tick five days old, and after a Cancel with no day: the next one is on today or later, never
  on a past page.
- Cancel makes the next. Not today makes none. Another day moves one and leaves the schedule.
- A line with a tag, a link, a page reference and a `@date` chip with a time: the next one has them, the chip on its
  new day with its time, and its reminder is set.
- Delete the current one's last line and Undo; cut and paste it on another page; a copied line; a template; `Make a copy`.
- The floor build ticks a repeating to-do and deletes its line, and an older tab ticks one against the new server:
  on the new build the repeat is whole, and opening the app makes the missed next one once. On real Postgres, with a
  real floor write.
- Two tabs tick the same one; a retry of the tick; a tick replayed from the outbox after coming back online: one next one.
- The next one's day page open with unsaved words, in the main pane and in peek: nothing typed is lost and no save
  conflict shows. From an older tab: its existing save-conflict state, with what he typed kept.
- A rule on To-dos set off by Done still runs once, and one set off by a to-do added runs once for the next one.
- Over the limit refuses the whole operation.
