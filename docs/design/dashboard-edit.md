# Dashboard: edit mode at 1280, and the layout at 390

- Author: Jazz (Design) · 2026-11-12 · status: **proposed, for Roadbuster to build step 1 from (Lead 24174e13).** Not
  built, nothing tried. Measures are my judgement, to be held by a check once built.
- Reads with `dashboard.md` (D13, approved) and `DESIGN.md`. Where they differ, `DESIGN.md` wins: its **Lift Rule**
  (Nov 8) replaces `dashboard.md` §3's "a line shows where a widget lands". A hatched slot shows it instead, as on a
  board. Bumblebee, please bring §3 into line.

## 1. Read mode, for reference

- **The dashboard's own width:** from the sidebar's edge to the window's, less the page's 48 px gutters. At 1280 that's
  924 px, up to 1100 (the database width in `DESIGN.md`).
- **Rows of widgets,** 24 px apart in both directions (`--dash-gap: 24px`).
- **The page goes wide with it:** on a page showing a dashboard, the breadcrumb, title and dashboard head start at the
  dashboard's left edge, so the page keeps one left line (Jazz 6f0ebb20).
- **A widget's head:** its heading is its database's name, and its view tab names its view, which a new widget calls by
  its layout ("Table"), as any linked view does.
- **A widget is its linked view:** its name as the heading, its own chips and head, with no outline, fill or shadow.
- **Heights** are the stored row height. Within that the content scrolls only as a table scrolls today: sideways, and
  down past its row cap.

## 2. Entering and leaving edit mode

- **Head:** "Edit" is a secondary button at the right of the dashboard's head. In edit mode it becomes "Done", a
  primary button (Ink, white on dark), in the same place and at the same width, so it's where the hand is.
- **Leaving:** Done or Esc ends the mode. Esc only does that when no menu, sheet or drag is open, as the rest of the
  app's Esc. The mode isn't kept across a reload.
- **Nothing moves when it opens.** Every widget keeps its position and size. Edit mode only draws on top, as below.
  A one-frame check compares each widget's rect before and after entering.

## 3. A widget in edit mode

| Part | Look | Measure |
| --- | --- | --- |
| Edge | 1 px Hairline (`--line`) ring, 12 px corners (`--radius-block`) | drawn by `::before` at `inset: -8px`, outside the content, so nothing shifts |
| Content | inert (`inert` on the body): no edits, ticks, opens or focus inside | no dimming: it reads as it will |
| Surface | the whole widget is its drag handle; `cursor: grab`, `grabbing` while held | no separate grip icon |
| `⋯` | ghost icon button, 44 px square, at the top right, over the view head's own `⋯` (hidden in edit mode) | centred on the heading's first line |
| Hover (pointer) | the ring steps to `--line-strong` (Border-control) | 120 ms |
| Focus (keyboard) | the 2 px Thread Blue focus ring at 2 px outside the Hairline ring | as every focus ring |

**The widget's menu (`⋯`):** Duplicate, then Move left and Move right, each only where it can move, then "Move to its own row" (a full-width row
right under its current one, hidden when it's already alone) and "Join the row above" (at that row's end, re-divided,
hidden when that row has 4 or there's none), then Remove. With the swaps these reach any layout a drag can, so arranging
by keyboard is complete (Bumblebee 9337a4b0). Both are `moveWidget`; neither shows at 390, where rows aren't visible. Remove says "View removed", with
Undo, and takes no rows, as R2-3. The Move items are how a keyboard arranges, and they're the whole of arranging at
390 (§7).

**A menu move is a swap (Bumblebee cb8dc72e).** It trades places with the previous or next widget in reading order
(left to right, then down). **Within a row each keeps its own width,** so a 1/3 · 2/3 split he set stays his. **Across
two rows each takes the other's width,** as the place's width is what keeps both rows full: the first widget in a row,
moved left, swaps with the last widget of the row above. Nothing else in the layout changes. It's one
command and one Undo, `swapWidget {viewId, widgetId, withId}`, refused unless the two are next to each other in
reading order. A drag is still `moveWidget`, with its re-divide (§4).

**Keys (R1-26):** in edit mode, Tab moves from widget to widget in order (left to right, then down). Enter or Space
opens its `⋯`. Delete removes it, with Undo. Keys inside a widget never act, since its content is inert.

## 4. Moving a widget (the Lift Rule, `drag-lift.ts`)

- **Pick up:** a press on the widget, and a move of 4 px. The copy lifts as a board card does: 3° tilt, 2% growth,
  Float shadow, the grab point kept under the pointer.
- **Where it lands:**
  - Into a row with room (fewer than 4 widgets), before or after a widget, by the pointer's side of its middle. The
    row's widgets then share its width equally (1/2, 1/3 or 1/4), as Notion does, and the moved widget takes the row's
    height.
  - Between rows, or above the first or below the last: a new row of its own, full width, keeping its own height.
  - **Within its own row,** a drag reorders it and every widget keeps its width (Bumblebee 1e0d2d51), so the slot is
    the widget's own width, and the others slide past it at theirs.
  - A full row (4) shows no slot. Let go there and it goes back.
  - **Back where it started** sends no command at all: no Undo entry, nothing saved, and the copy settles back as a
    cancel does (the command refuses it too, "Already there").
- **The slot:** a hatched `.drag-slot` the widget's landing size, with the row's neighbours sliding to their new widths
  (`measure`/`flip`, `SPRING.shift`). Between rows the slot is full width and the rows below slide down.
- **Release:** the change is saved first and drawn in place, then the copy settles into it (`SPRING.settle`). One
  move is one command and one Undo. A cancel (Esc while held) springs back.
- **Reduced motion:** the lift and the slot stay, and the tilt, slide and glide go, as everywhere.

## 5. Width and height handles

Rows are always full. Widths in a row add up to the whole and snap to 1/4, 1/3, 1/2, 2/3 and 3/4. So a handle sits
only between two neighbours, and it trades width between them.

| Handle | Where | Look | Hit area |
| --- | --- | --- | --- |
| Width | in the 24 px gap between two neighbours, full row height | a 2 px × 32 px bar, `--line-strong`, 1 px corners, centred in the gap | 16 px wide, full height; `cursor: col-resize` |
| Height | in the 24 px gap under each row, full row width | a 32 px × 2 px bar, centred | 16 px tall, full width; `cursor: row-resize` |

- **At rest the bars show only on the row being hovered,** so twelve widgets don't carry twenty bars. While dragging,
  the bar is Ink-faint.
- **In a row of three** (Roadbuster e46e76d0): no single pair trade from 4 + 4 + 4 is an allowed split, so a handle
  steps the whole row. Between A and B in A | B | C: 3 + 6 + 3 dragged left, 4 + 4 + 4 in the middle, 6 + 3 + 3 dragged
  right, and the same for B and C. The badge shows all three ("1/4 · 1/2 · 1/4"), and it's one `sizeSplit` and one Undo.
- **Snapping:** a width moves only between snap points. Each snap the pointer passes shows at once, and neighbours never
  go under 1/4. A height moves in 40 px steps from 160 to 800.
- **The value while dragging:** a Meta-size badge (Paper-fill, Ink-soft, 6 px corners) centred on the handle at the
  pointer's height, kept inside the row so it never covers a name, saying
  "1/3 · 2/3" for widths or "320 px" for heights. It's state, so the Quiet Copy Rule allows it, and it goes on release.
- **One drag is one command and one Undo.** The value only saves on release.
- **Keys:** a focused handle (Tab reaches it after its row's widgets) moves one snap with ← → or ↑ ↓. Each step saves.

## 6. Adding

- **`+ Add widget`** under the last row, in Ink-soft UI type like `+ New`, opens the same database-and-view picker as
  `+ Add view` and adds a full-width row at the end.
- **On a row with room,** a ghost `+` (44 px square) appears in the page's right gutter beside the row while the row is
  hovered or focused. It adds the widget at that row's end, and the row's widths go equal.
- **At 12 widgets:** "12 widgets at most" in Meta Ink-soft replaces `+ Add widget`, and the row `+` doesn't show. It's
  state, not instruction, as the filter rules' limit is.

## 7. At 390 (step 2, G6-3)

- **Every widget is full width,** one above another, in reading order (left to right, then down). Stored widths are
  ignored and nothing is stored differently.
- **Height follows content,** up to 360 px. Past that comes a fade into the page colour and "Show more" (the link
  button, as Feed's), and the widget never scrolls inside, so a thumb can't get trapped. Off-screen widgets hold their
  space until they load.
- **Edit mode:** the same Edge ring and `⋯` (44 px). There's no dragging and there are no handles. The `⋯` menu says
  Move up and Move down, the same swap as 1280's Move left and Move right (§3). In a one-column list that reads as up
  and down, and the 1280 layout keeps every other widget where it was. After a move the page scrolls to the widget
  and gives it the moved-line flash (Thread Blue wash, 1 s, as `DESIGN.md` lists).
- **Edit and Done** sit in the head as at 1280. `+ Add widget` is under the last widget. The row `+` doesn't exist.
- **Between 900 and 1100, or with the Comments pane open,** a row wraps when a widget would go under 200 px
  (`--widget-min`; Roadbuster 94fa8ad0: four quarters at 1280 are 213 px, so 280 would always wrap a row of four). This
  isn't stored. In edit mode a width handle shows only between neighbours that sit side by side.

## 8. States to check once built

- Entering and leaving edit mode moves nothing (rects before and after, at 1280 and 390).
- No content inside a widget takes a click, tap or key in edit mode. In read mode it all does.
- A drag into a row with 1, 2 and 3 widgets, between rows, and onto a full row, each with its slot and widths. Undo
  takes each back as one step.
- Width and height snaps, their badges, and their keys.
- At 12, the limit line. At 390, the order, the 360 px cap with Show more, and Move up and Move down with the flash.
- Dark mode: the ring, bars and badge are on the scale, with nothing restated.
- Reduced motion.
