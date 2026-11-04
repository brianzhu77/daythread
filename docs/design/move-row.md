# Moving a row to another database: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **design for Lead and Roadbuster to review**. Not approved and not built. Task #290, checklist R4-10.
- **Evidence, weak:** I found no Notion help page on this. [A third-party guide][g] says only properties of a matching type carry over, and [a third-party copy of the SDK docs][s] says incompatible properties may be lost. I read our code on main and ran nothing.
- **Brian's use:** no databases at the last read (Nov 3, rev 793).

## 1. Why it isn't just `move-page`

A row is a page whose parent is a database (`databaseOfRow`), so `move-page` would change its parent. But its values are keyed by the old database's property ids (`RawValues`), so they'd silently stop showing. **This needs its own command: one operation that moves the row and rewrites its values, with one Undo.** The page id stays, so links, `[[`, line links and the body need no change.

## 2. The flow

1. The row page's `⋯` → **Move to…** At both widths. A row in a peek too, which #286 checks, since no peek exists yet (0d35f50b).
2. A picker lists databases by recent use, with search. Not this one, not one in Trash, and not To-dos, as a to-do has no page.
3. **If nothing would be lost, it moves with no question.** Otherwise it says exactly what's lost, first (§4), with Move and Cancel.
4. The notice: "Moved to Reading list · Undo". The page stays open, now showing the new database's properties. The row goes to the end of that database's order.

Several rows at once isn't in R4-10 or in R3-26's bar. It'd follow from this command, but I'm leaving it out until a source says Notion has it.

## 3. What happens to each value

| Value | Result |
| --- | --- |
| Same name and same type in the target (trimmed, ignoring case) | Comes along |
| Select, Multi-select or Status, where the target lacks the option | **The option is added to the target,** in the same operation (Lead c3eb70ca), so nothing's lost for want of a word. Status joins its group, or To-do if the target has no such group. Undo removes it, unless another row has used it since |
| Relation to the same database | Comes along. A two-way partner updates |
| Formula, Rollup, Created and Edited time | Not stored values. A Created time stays true, as the page's own |
| ID | Takes the target's next number. The old one isn't reused |
| No match | Stays behind and is counted (§4). Undo brings it back, so the operation records the old values |

## 4. What it says first

Only what's actually affected, with names, not a general warning:

- "2 values won't move: Rating, Source."
- "3 rows in Authors will lose their link to it" (§5).

## 5. Things pointing at the row

- **A relation in another database that targets the old one** can't hold a row of the new one, as a relation's target is fixed. Those links are removed, named first (§4), and one Undo restores them. Rollups over them recompute.
- **Page links and line links:** keep working, since the id doesn't change.
- **Linked views of the old database:** the row leaves them. Calculations follow.

## 6. Sub-items and limits

- **Sub-items (once #291 ships):** the whole tree moves, with one Undo, as `sub-items.md` §2 says. A dependency on a row left behind is removed and counted in §4.
- **The target's 10,000-row limit (`workspace.ts:906`):** counts the tree, and refuses with the reason before anything moves.
- **Row templates and pages inside the row:** row templates aren't rows here, and stay where they are. Pages inside move with the row, as their parent is unchanged.

## 7. Failure and old tabs

- **Offline or a failed save:** nothing moves, and unsaved typing in the row is saved first (`flushEditor`), with the move not running if that fails.
- **Another tab on the old database (Roadbuster 0d35f50b, `move.mjs`, both engines, SQLite):** new builds send the database they think the row is in, and the server refuses with "This row moved to X" and writes nothing. A tab on an older build gets "Property not found" for a cell, but its title edit can still go through if that tab is at the latest revision. That's accepted, since a title belongs to the row wherever it is.
- **Rollback:** an older build reads a moved row as a normal row of the new database. Run on SQLite in both engines, with no floor change (0d35f50b).

## 8. Open

- **Answered:** a repeated name in the target isn't possible, because `uniqueName` refuses it per database, ignoring case (Roadbuster 1445dbeb).
- **Not known, needs Notion itself:** what Notion really does on a mismatch. Ours loses less than the sources suggest either way.

[g]: https://super3.super.site/blog/move-notion-page-into-database
[s]: https://www.mintlify.com/makenotion/notion-sdk-js/api/pages/move
