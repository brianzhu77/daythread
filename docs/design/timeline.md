# Timeline: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **steps 1 and 2 built and live** (#104, #108, 2026-11-04), except Rollup and Formula dates, now on R4-14. Checklist R4-1 and R4-2 say what differs.
- Asked by the Lead (4a1712e6). Settles R4-1's open point. Nothing is cut for lack of evidence, and use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [timelines][t]. I read it; I haven't used Notion's timeline. It doesn't cover moving a bar along the scale, making a bar, Group, sub-items, rows with no dates or the phone, so those parts are my proposal.
- **Brian's use:** no databases at the last read (Nov 3, rev 793), so examples are illustrations.

## 1. What Notion's page says

| Behaviour | Here |
| --- | --- |
| Time unit in a dropdown beside Today, "from hours all the way up to years" | **Hours, Day, Week, Month, Quarter, Year.** R4-1 said "from days", which was short by one, and I've corrected it. Hours only matter on dates with a time. Notion's page doesn't list the steps between, so these are mine |
| A date property holding a range, or start and end as separate properties, chosen in Layout → "Show timeline by" | As Calendar's "Show calendar by" (R3-1): asked when the view is made, with "+ New Date property" offered |
| A table to the left, opened by `>>` and `<<`, columns reordered by dragging, its own "Table properties" | As written. Shown or hidden is saved on the view |
| Calculations when the table is open | At the table's foot, the same as R3-8 |
| Drag an edge to lengthen or shorten | As written, with one Undo |
| Drag up or down to reorder | When the view is unsorted, as any layout |
| Arrows on a row whose bar is off-screen, which jump to it. Today returns to the current day | As written |
| "Load limit": how many pages show at once | The row cap and "Show 25 more" we already have (R1) |
| "Open pages in" | Comes with side peek (R4-11) |
| Conditional colour on bars | R4-12 |

## 2. What's mine

- **Moving a bar along the scale** keeps its length, with one Undo. Notion's page doesn't state this, but R4-1 asks for it and other sources describe it. It snaps to the unit shown: a day at Day, Week, Month, Quarter and Year (Jazz 1d3eda45), and an hour at Hours.
- **Making a bar:** on a row with no dates, a hover shows a one-day ghost bar, and a click or a drag sets its dates. `+` on the scale makes a row with dates from where it's clicked. `+ New` at the table's foot makes one with none.
- **Group** as in a list (R2), and a new row takes the group's value, as `+ New` does today. A group folds, and the scale stays aligned.
- **Sub-items:** nested in a toggle or flat (`sub-items.md`).
- **Where it was left:** the unit is saved on the view. The place on the scale is kept on this device and not synced, as Calendar's month is (R3-21).

## 3. R4-1's open point: odd dates

| The row has | It draws | Moving it |
| --- | --- | --- |
| A single day | A one-day bar, as wide as a day at that unit, with a minimum tappable width at Month and above | Keeps one day. Dragging an edge makes it a range, turning End date on |
| Start only, on two separate properties | A one-day bar on the start, marked by an open right edge | Sets Start. Dragging the right edge sets End |
| End only, on two separate properties | A one-day bar on the end, with an open left edge | Sets End. Dragging the left edge sets Start |
| End before Start, on two separate properties | One day on Start, in `--red` at its edge, with the date cell untouched. **We never rewrite dates to tidy them** | Moving sets both, which clears it |
| Neither | The "No date" line (R3-1), so a row is never silently missing | As in §2, making a bar |
| Created or Edited time | Read-only: one day, no drag, as R3-21 | Refused with a notice |
| A Rollup or Formula date | Read-only, the same | Refused with a notice |

## 4. On a phone

**Notion's page doesn't cover the phone, so this is R4-2's call, and I keep it.** Bars don't fit at 390. A list grouped by week: a row sits under its start's week with its dates in full, so a two-week row is listed once. **A row still running this week sits under this week, not its start's week** (Bumblebee, 1d3eda45), so it's never folded away as past. Tapping opens it. Dates change in the sheet. It draws from this week down, with a line at the top, "Earlier · 12", that opens the rest, because scrolling a block to this week on open would pull a day page around it (Jazz 1d3eda45). If nothing's left from this week on, Earlier is open already, so the view isn't blank. Rows with no date sit on the same "No date" line at the end. Weeks follow Week starts (R3-20). The unit and table settings stay as they are and are ignored here, so a phone never changes what 1280 shows.

## 5. Elsewhere

- **To-dos as a source (R2):** Start and Deadline are the natural pair, as a separate start and end. A move uses the task commands (R2-9), with one Undo. Planned isn't a range and stays out unless picked, as a one-day bar. A To-dos row with no dates sits on the "No date" line. **A move here never removes a line from a day page.**
- **On a day page or the Day template,** R2-7's bar holds. A linked Timeline is drawn when scrolled to, and its sideways scroll doesn't pull the page.
- **"This page's day" filter:** works as anywhere, and the scale opens on that day rather than today.
- **Keys at 1280:** keys don't leak (R1-26). A bar is reached by the table's row, and arrows don't move a bar. Dates change in the cell.
- **Export:** the rows and dates, as any view.
- **Dependencies' arrows:** drawn on top when on (`sub-items.md` §3).

## 6. For Roadbuster and Jazz

- **Cost:** a view of 100 rows within R3-7's bar. Bars outside the window needn't be drawn, but the arrows need to know they exist. Only rows' dates are needed, not bodies.
- **Dragging:** the same drag code as the Board's and Calendar's, if possible, and Safari's pointer events at 1280.
- **Older tab and rollback:** `layout: timeline` is new. Please state what an older build draws. It shouldn't lose the view's settings.
- **Jazz:** the look at both widths, the open edges, and the table's divider. Black, white and grey as elsewhere (116a40ab).

## 7. Release order, within Timeline

1. Bars from one Date or a pair, moves and edges, Today, units, and the 390 list.
2. The table beside it with calculations, arrows off-screen, Group, **and Rollup and Formula dates as read-only bars (§3's last row),** which step 1 doesn't offer (Jazz c3ff1937).
3. Sub-items and dependencies, when those ship.

## 8. Checks before release

Add to R4-1 and R4-2 when built:

- Every row of §3, at Day and Month. No date is rewritten unless that bar was moved.
- A move and an edge drag: one Undo each, and Edited moves once.
- A row never disappears: the count on the table equals rows with bars plus the "No date" line, and at 390 the rows listed plus "Earlier" plus "No date".
- A To-do moved on a Timeline keeps its line on its day page.
- At 390: the list, no sideways scroll, and a date changed in its sheet moves the row to the right week.
- Sideways scroll on a linked Timeline in a day page doesn't move the page, in WebKit.
- A copy of his real data at both widths (R3-18).

[t]: https://www.notion.com/help/timelines

## 9. As built, step 1 (Jazz, R4-1, R4-2, task #285)

- **The unit** is a dropdown beside Today, and also in Layout. **End** in Layout picks a second date; "Same property" reads a range.
- **Widths:** a day is 1152 px at Hours, 48 at Day, 24 at Week, 12 at Month, 4 at Quarter and 1.5 at Year. A bar is at least 10 px wide. A move or an edge snaps to an hour at Hours and a day at every other unit, so a date he didn't mean to change is never rounded.
- **A bar off-screen** shows its name at the edge of its line with an arrow, and a tap goes to it. So a row is never a blank line while the table beside it isn't built.
- **A date with a time** moves by hours at Hours and keeps its time elsewhere. One with no time moves by whole days at any unit.
- **Scale:** it runs over the rows and today, and what's on screen stays on screen when a move changes where it starts. Today's line is the day's middle, or the time now at Hours.
- **It opens** where it was left on this device, or on today. Only a view filtered to this page's day opens on that day.
- **A rollup or formula date** isn't offered, as on a Calendar, so §3's last row doesn't arise yet.

## 10. As built, step 2 (Jazz)

- **The table:** `«` and `»` beside the scale, saved on the view. It shows Name and the view's properties, and it's pinned, so a row and its bar stay on one line and scroll as one. A tap on a cell edits it, as in a table.
- **It takes at most 60% of the width,** so the bars keep room. Past that its columns scroll on their own under Name, as Notion's do: by the thin bar under the head, a sideways scroll over the table, or a cell reached by a key. A fade on the right says there's more. A scroll over the table doesn't move the bars, and where it was left isn't kept.
- **Rows move up and down** by the handle at the start of a line, with the table open or closed, when the view isn't sorted. Closed, the handle stays at the left of what's in view, over the bars, and a name off-screen sits just after it.
- **Calculations** sit at the table's foot, each group with its own, as a table's do. `⋯` → Calculate shows only while the table does.
- **Rows up and down** drag by the table's handle when the view isn't sorted, across groups too. With the table closed there's no handle: a bar's drag is along the scale.
- **Group** works as in a list: a section each, its fold, its cap and its `+ New`. Rows with no dates stay on the one "No date" line, not in their groups.
- **A row with no dates:** a drag across its lane sets a range, and a click sets one day.
- **Still to do:** Rollup and Formula dates (R4-14, with Calendar), and sub-items and dependencies when those ship.
