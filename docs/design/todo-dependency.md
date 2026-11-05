# A dependency between two to-dos: design

- Author: Bumblebee (Product) · 2026-11-05 · status: **draft for the Lead and Jazz to review, and for Ratchet to read before anyone builds**. Not approved and not built.
- Listed in `databases.md` §14, group 2, and owed by `sub-items.md` §4, which says it "needs its own design". Nothing is cut for lack of evidence, and use only sets the order (Brian 57deaed7). **Nobody has asked for this.** Brian has 26 tasks and has made no request for it. The evidence is Notion's Sub-items and dependencies page as read for `sub-items.md`, and the names "Blocked by" and "Blocking" are from memory, unconfirmed there too. Everything below is my proposal.

## 1. What it is

One to-do says it can't be done until another is. A to-do can't take extra properties (`databases.md` §11), so this is two more fixed ones, as Status and Deadline are: **Blocked by** and **Blocking**. They're two sides of one link.

## 2. What Brian sees

- **Nothing, until there's a link.** A to-do with none looks as today, pixel for pixel, on a day page, on Tasks and in a To-dos view. They're not default columns in a To-dos view; they're offered under Properties.
- **Adding:** in a to-do's row menu, `Blocked by…`, opening the to-do picker that a relation to To-dos already uses. In a To-dos view, by the Blocked by cell at 1280 and its sheet at 390.
- **Seeing:** while a blocker is open or paused, a quiet "Blocked by {title}" sits with the to-do's other marks, on a day page and on Tasks, and a tap opens the blocker's line. With several it reads "Blocked by 2". Once every blocker is done or cancelled, the mark goes and the link stays.
- **On Tasks:** a blocked to-do stays where it is. It isn't hidden, moved or sorted down, because Brian decides what to do today.
- **In a To-dos view:** both columns, a filter ("is empty", contains), and on a Timeline the arrows database dependencies already draw.

## 3. Rules

- **No date ever moves.** A database's dependency can shift dates (`sub-items.md` §3), and that's the difference I'd keep. A to-do's Planned day decides which day page its line belongs on, so moving it would move lines on pages Brian isn't looking at, for a reason Brian didn't state.
- **A loop is refused,** as R4-5's is, including a to-do blocked by itself.
- **Ticking a blocked to-do is allowed,** with no question. A warning would stand between Brian and a finished line.
- **Done and cancelled both stop blocking.** A cancelled blocker won't happen, so it shouldn't hold anything.
- **Deleting a to-do** removes its links, and Undo brings them back. A to-do on a page in Trash stops blocking until restored.
- **A copy of a line** is the same task (B22), so the link holds. A template's to-dos are copied empty, so they carry no links, and `Make a copy` carries none.
- **Reminders, the day draft and search:** unchanged. The draft sends the model no links.
- **Export:** "Blocked by {title}" on the to-do's line in the export.

## 4. For Roadbuster

- **Storage:** an optional list of task ids on a task, written by one new command with one Undo. Blocking is read from the other side, not stored. Please say whether a column or a side table is safer against an older build's task save, which must leave it alone.
- **An older tab** shows no mark and has no way to change it. Please run a rollback, including an older build deleting a linked to-do.
- **`edit-todos`** (R4-17) doesn't take these, as links aren't one of the four things its bar changes.
- **Cost:** the mark needs the blockers' status on Tasks and every day page. Please measure it against R1-18's day.

## 5. Open for review

- **Lead:** whether group 2 should wait on this draft, or the rest of group 3 go first. It's the only item in group 2 nobody has designed, and the least connected to what Brian does today. It's in scope either way.
- **Jazz:** where the mark sits on a task line at 390, where lines are already short.
- **Ratchet:** "no date ever moves" against any path that writes Planned, and links through Trash, Undo and B22's copies.

## 6. Checks before release

- A to-do with no link is unchanged on a copy of Brian's real data at both widths, and a day's budget stays under R1-18's bar with links present.
- Add, remove, loop refused, one Undo each, at both widths.
- A blocker ticked, cancelled and reopened: the mark goes and comes back on every surface, with no date or line moved.
- Delete and Trash with Undo, a copied line, a template, and `Make a copy`.
- An older tab keeps the links through its saves, and a rollback restores them.
