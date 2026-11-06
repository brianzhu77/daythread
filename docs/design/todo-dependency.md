# A dependency between two to-dos: design

- Author: Bumblebee (Product) · 2026-11-05 · status: **approved to build with the changes below (Lead 495829a7, from Jazz's read and Ratchet's `docs/reviews/todo-dependency-ratchet.md`, b735d624, both before any build).** Not built. Roadbuster's, after #167.
- Listed in `databases.md` §14, group 2, and owed by `sub-items.md` §4, which says it "needs its own design". Nothing is cut for lack of evidence, and use only sets the order (Brian 57deaed7). **Nobody has asked for this.** Brian has 26 tasks and has made no request for it. The evidence is Notion's Sub-items and dependencies page as read for `sub-items.md`, and the names "Blocked by" and "Blocking" are from memory, unconfirmed there too. Everything below is my proposal.

## 1. What it is

One to-do says it can't be done until another is. A to-do can't take extra properties (`databases.md` §11), so this is two more fixed ones, as Status and Deadline are: **Blocked by** and **Blocking**. They're two sides of one link.

## 2. What Brian sees

- **Nothing, until there's a link.** A to-do with none looks as today, pixel for pixel, on a day page, on Tasks and in a To-dos view. They're not default columns in a To-dos view; they're offered under Properties.
- **Adding and removing:** in a to-do's row menu, `Blocked by…`, opening the to-do picker that a relation to To-dos already uses, with current blockers ticked so a tap removes one, and the menu then reads "Blocked by 1…" (Jazz). In a To-dos view, by the Blocked by cell at 1280 and its sheet at 390. **A to-do that would make a loop is greyed in the picker and says why,** rather than being refused after the choice, and a to-do isn't offered against itself (Jazz).
- **Seeing:** while a blocker is open or paused, a quiet "Blocked by {title}" sits **on its own line under the to-do's words, aligned with their left edge, in `--ink-2` at the meta size, at both widths, ending in an ellipsis (Jazz, decided).** A to-do's words have only 275 px at 390, and sharing that would change how the name wraps. That row grows 16 px, only on a line with a link. On a day page and on Tasks, a tap opens the blocker's live line, by the same resolver Tasks uses. With several it reads "Blocked by 2", counting only blockers still in force (Ratchet), and a tap opens a small menu naming them (Jazz). Once every blocker is done or cancelled, or **the to-do itself is finished (Jazz),** the mark goes and the link stays. Reopening it works the mark out again.
- **Nothing jumps under a finger (Jazz, the one real risk here):** ticking a blocker just above what it blocks would pull every line below up 16 px as someone reaches for the next box. A row keeps its height until the next scroll or reload.
- **The mark isn't text:** the caret skips it, a copy of the line leaves it out, and a tap on a phone raises no keyboard. It's drawn over the line, as a tag is, and never goes in the document. B88's and B89's keys are checked on a line with one (Jazz).
- **On Tasks:** a blocked to-do stays where it is. It isn't hidden, moved or sorted down, because Brian decides what to do today.
- **In a To-dos view:** both columns, a filter ("is empty", contains), and on a Timeline the arrows database dependencies already draw.

## 3. Rules

- **No date ever moves.** A database's dependency can shift dates (`sub-items.md` §3), and that's the difference I'd keep. A to-do's Planned day decides which day page its line belongs on, so moving it would move lines on pages Brian isn't looking at, for a reason Brian didn't state.
- **A link is between tasks, not lines (Ratchet):** canonical task ids, so moving a line or Planned doesn't break one, and the link command writes only the links, outside database dependency shifting. Linking, unlinking, a tick, Trash and restore change no date, plan line or page document.
- **A loop is refused,** as R4-5's is, including a to-do blocked by itself. **The check covers links not in force too** (paused, done, cancelled, in Trash), so reopening or restoring one can't complete a loop, and it runs under the workspace lock, so two tabs making A and B block each other get one (Ratchet).
- **Ticking a blocked to-do is allowed,** with no question. A warning would stand between Brian and a finished line.
- **Done and cancelled both stop blocking.** A cancelled blocker won't happen, so it shouldn't hold anything.
- **Deleting a to-do** takes its links out of force rather than removing them, so he sees them gone, and Undo brings them back without writing links, so no newer link edit can be overwritten; one that would make a loop is refused (Ratchet; as built in #168, Roadbuster, agreed by Bumblebee). A deleted to-do's links count nowhere he can see: not the mark, "Blocked by N…", the picker's ticks, export or Timeline arrows, nor either limit (Roadbuster, at 44cf0b2a). A done blocker still counts as selected, so it blocks again when reopened (Ratchet). **The loop check still counts a deleted to-do's links,** as one can come back by pasting its copied line, on the floor build too, with no loop check on that path (Ratchet 3fdb1b20). When that greys a choice, the reason names the to-do as deleted, e.g. "Would make a loop through Buy paint (deleted)". **A to-do stops blocking in Trash only when no live line of it is left,** as a copied line elsewhere keeps it live (Ratchet). A restored line brings the link back into force.
- **A copy of a line** is the same task (B22), so the link holds. A template's to-dos are copied empty, so they carry no links, and `Make a copy` carries none.
- **Reminders, the day draft and search:** unchanged. The draft sends the model no links.
- **Export:** "Blocked by {title}" on the to-do's line in the export.

## 4. For Roadbuster

- **Storage (decided, Lead 495829a7, Ratchet's protected store):** links in their own table, as comments are, keyed on canonical task ids, in one direction, written by one new command with one Undo. Blocking is read from the other side, not stored. An older build can't touch it, and a link with a missing end is kept, not in force, rather than deleted. A plain field on a task wouldn't survive `TaskRow`. **It needs a real floor write before it ships.** Bound the blockers per task and links in all, and refuse a whole operation over the limit; name the numbers after measuring.
- **An older tab** shows no mark and has no way to change it. Ratchet's fixture for the rollback: A blocked by B and C blocked by A on this build; the floor edits, ticks and plans A, deletes its last line and undoes that; back on this build, the same links, dates and newer edits, on real Postgres.
- **`edit-todos`** (R4-17) doesn't take these, as links aren't one of the four things its bar changes.
- **Cost:** the mark needs the blockers' status on Tasks and every day page. Please measure it against R1-18's day.

## 5. Settled in review

The Lead has placed it after #167 and ahead of To-dos as an automation's source (`databases.md` §14). Jazz's and Ratchet's answers are written in above. **Not tried by Jazz:** a deadline chip on the same line, a real phone, and typing in a line with a mark; the sketch at 390 and 1280 was the words added to a live page, not a build.

## 6. Checks before release

- A to-do with no link is unchanged on a copy of Brian's real data at both widths, and a day's budget stays under R1-18's bar with links present.
- Add, remove, loop refused, one Undo each, at both widths.
- A blocker ticked, cancelled and reopened: the mark goes and comes back on every surface, with no date or line moved.
- Delete and Trash with Undo, a copied line, a template, and `Make a copy`.
- An older tab keeps the links through its saves, and a rollback restores them, by §4's fixture on real Postgres, with a real floor write.
- A row keeps its height after a tick until the next scroll or reload. The caret, a copy of the line, a phone's tap, and B88's and B89's keys on a line with a mark.
- A task and its copied line, with the original in Trash, the last live line in Trash, and a different line restored first.
- A loop through a done, paused and trashed to-do, and two tabs racing to make one.
- Undo after another tab has changed the links. Over the limit refuses the whole operation.
- Dates and page documents snapshotted through every state, including a blocker whose database relation shifts dates elsewhere. The tick's real speed with links present.
