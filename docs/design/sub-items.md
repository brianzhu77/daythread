# Sub-items and dependencies: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **partly live** (#106, #107, #114, 2026-11-04), without arrows or moving a tree; checklist R4-4 and R4-5 say what's open.
- Asked by the Lead (4a1712e6). Settles R4-4's open point on To-dos, for the Lead to confirm. Nothing is cut for lack of evidence, and use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [sub-items and dependencies][h]. I read it; I haven't used them in Notion. It doesn't cover how to make a sub-item, "Blocked by" and "Blocking", arrows, rows with no dates, whether shifts go down a chain, or the phone, so those parts are my proposal.
- **Brian's use:** no databases at the last read (Nov 3, rev 793), so examples are illustrations.

## 1. The model

Both are ordinary relations, with a behaviour on top. **Turning either on makes two relation properties on the database itself, in the two-way form R3-5 and R3-6 already have.** So rollups, formulas (`Parent item.Sub-item.every(...)`), filters and export work with no extra design. Turning one off leaves every row and keeps the properties as plain relations, so nothing is lost.

## 2. Sub-items

**Turning on:** `⋯` → More settings → Sub-items, as Notion. It makes "Parent item" and "Sub-item", or uses a chosen self-relation.

| Layout | Display, per view | Filter, per view |
| --- | --- | --- |
| Table, List, Timeline | **Nested in toggle** or **Flattened list** | Parents only, Parents and sub-items, Sub-items only |
| Board, Calendar, Gallery | **Card property** or **Flattened list** | Parents only, as Notion's page says. Flattened shows them all, which I read as its other display |

**As Notion's page says:** it's visible in all views, duplicating a parent copies its sub-items, and deleting a parent deletes them. A move to another database (R4-10) takes them along, turning sub-items on there.

**Differs from Notion on purpose:** Notion warns to move them out first. **Here it says how many first, and one Undo restores them all, with Trash listing them together** (R4-4). The bar is that nothing is lost.

**Mine, since Notion's page doesn't say how one is made:**

- **Making one:** a `+` on a parent's row in a table or list, and the toggle's "New sub-item". On the row's page, the Sub-item property's `+`, which works at 390.
- **Nesting existing rows:** dragging a row onto another at 1280. Setting Parent item in its cell, at both widths.
- **Depth:** any, as a tree, but drawn with an indent that stops growing at 4 levels, so 390 stays readable. A row can't be its own ancestor: refused with the reason (R4-4).
- **A filter or sort on nested rows:** filters apply to each row. A sub-item that matches under a parent that doesn't still shows, with its parent's title above it, dimmed and not counted, so that it isn't an orphan. Sorting applies among siblings.
- **Counts and calculations:** count the rows shown, and with nested rows, a parent's closed toggle still counts its sub-items if the filter includes them. Caps say which they count (R4-4).
- **Group:** a sub-item sits in its own group, with no tree across groups. Its parent's title shows on it.
- **A row template** can't hold sub-items in this pass, since a template isn't a row (R3-12). A later item, not a cut: it goes with repeating templates (R4-6) if wanted.

## 3. Dependencies

**Turning on:** `⋯` → More settings → Dependencies: a mode, Avoid weekends, then Turn on, as Notion. It makes "Blocked by" and "Blocking". Those names aren't on Notion's help page; I recall them from its product, unconfirmed here, and R4-5 uses them.

| Mode | When a blocker's end moves |
| --- | --- |
| **Shift only when dates overlap** | The blocked row moves only if it would now overlap. The gap can shrink |
| **Shift and keep the time between** | The blocked row moves by the same amount |
| **Don't shift** | Nothing moves |

**Avoid weekends** keeps a shifted row from starting or ending on Saturday or Sunday, whatever Week starts says.

**Mine, since Notion's page doesn't say:**

- **Which date:** picked when it's turned on, one Date or a start and end pair, and with one choice it doesn't ask. Changing it later is in More settings.
- **Chains:** a shift goes on down the chain, since otherwise a chain would overlap after one move. **It's one change with one Undo, and the notice says how many moved** (R4-5).
- **Rows hidden by a filter** still shift, and the notice says so: "3 rows moved · 1 is hidden · Undo". A date shouldn't change out of sight with no word.
- **A row with no date** doesn't move or fail. The chain carries on past it from the last date known, and if that can't be worked out, stops, with the count saying so.
- **A loop** is refused with the reason (R4-5), using the cycle check from R3-7.
- **Read-only dates** (Created, a Formula or Rollup) can't be the chosen date.
- **Arrows:** on a Timeline at 1280, from a blocker's bar to the blocked one. Dragging from a bar's dot to another bar links them. Everywhere else, including 390, they're set in the cell.
  - **The line:** out of the blocker's end and into the blocked bar's start. Where that bar starts too soon, it doubles back between their lines, so an overlap reads by its shape. It goes under the bars and the table, and behind a row's name when its bar is off-screen. A bar far off leaves a line running to the edge, with no head. Hovering a bar darkens its own arrows.
  - **Only between bars on the scale:** a row with no date, hidden by a filter, past "Show more" or in a folded group has no arrow. A row in two groups goes by its first line.
  - **Linking:** hovering a bar shows a dot by each end. From its end, this bar blocks the one it's dropped on; from its start, that one blocks this. A dashed line follows the pointer and the bar under it is outlined. The notice says "Ship is blocked by Design", with one Undo. The same link again says "Already linked". A loop says why and changes nothing. Esc, or letting go on nothing or on its own bar, changes nothing. A link added between rows that overlap moves nothing until a date changes (R4-5).
  - **Unlinking** is in the cell, or Undo. Arrows take no clicks, so they can't get in the way of a bar. Removing one from the arrow itself could come later.
- **A row in Trash** keeps its links (R3-5) and doesn't shift while there. Restored, it isn't moved to fit, so that a restore never moves other rows.

## 4. R4-4's open point: To-dos

**I recommend no sub-items or dependencies on To-dos.** To-dos can't have extra properties (`databases.md` §11), and a to-do's nesting already lives on its page, where indenting makes the tree. A second tree would disagree with the first. **For the Lead to confirm, and written down either way:** a relation from a database to To-dos (R3-23) already gives "Project → its to-dos". What's lost against Notion's Tasks database is a dependency between two to-dos. If Brian asks for that, it needs its own design, and it stays listed in §14 as a later item rather than disappearing.

## 5. On a phone

Notion's page doesn't cover it. Toggles work at 390 with 44 px targets. Parent item, Sub-item, Blocked by and Blocking are edited in the row's sheet. No drag.

## 6. For Roadbuster and Jazz

- **Cost:** a tree is a walk of one relation, within R3-7's bar on 100 rows. A chain shift is one operation, whatever its length. A very long chain's limit is yours to state.
- **Undo after a shift:** the whole chain's rows in one inverse. Please test against a row edited in another tab: "Can't undo · edited since", never an overwrite.
- **Old tabs and rollback:** these are relations plus a setting, so an older build should show them as plain relations and keep them. Please run it. It may show a row's sub-items as flat rows.
- **Filter default:** the view's existing filter still has to mean what it says when sub-items turn on.
- **Jazz:** the toggle's column against the alignment gate, the indent at 390, and how arrows look. Black, white and grey as elsewhere (116a40ab).

## 7. Release order

1. Sub-items: on and off, nested and flat in a table and list, filter, delete with Undo.
2. Sub-items on Board, Calendar, Gallery and Timeline, and moves.
3. Dependencies: properties and modes without arrows. Then arrows on a Timeline, after R4-1.

## 8. Checks before release

Add to R4-4 and R4-5 when built:

- Turn on with rows, turn off: every row and value is unchanged, both ways.
- Delete a parent with 3 sub-items and one grandchild: the count says 4, one Undo restores all, and Trash lists them together.
- A row set as its own ancestor, two levels up: refused.
- Duplicating copies the tree, with its own links, not the old rows'.
- A chain of 5 in each mode, with weekends on and off, against a hand-worked table. One Undo returns all 5.
- A filtered-out row in a chain moves, and the notice says so.
- A row with no date mid-chain doesn't fail.
- Rollup of Sub-item for percent done, and a formula over it, give the same answer.
- A copy of his real data at both widths (R4-16).

[h]: https://www.notion.com/help/tasks-and-dependencies
