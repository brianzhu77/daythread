# Dragging, Nov 8

Status: **built Nov 8** on `design/drag-feel`. Brian (2026-11-08) sent a screen recording of a kanban board whose
drag he called "super cool" and asked for the same feeling, not its colours. What the recording does, frame by frame:
the card lifts under the cursor with a small tilt and a soft shadow; a hatched slot the card's size appears where it
would land; the other cards slide out of its way; on release the card glides into the slot and flattens.

## One feel, four places

`src/components/drag-lift.ts` holds it, and every drag in the app goes through it:

| Surface | Lifts | Where it lands | Makes room |
| --- | --- | --- | --- |
| Board cards | the card, tilted 3° | a hatched slot in the column, at the end or before a card | the column's cards and `+ New` slide; both column counts update while the card is held |
| Table rows | the row with its cells, tilted 1° | a hatched slot row | the rows and the group's foot slide |
| List rows | the line, tilted 1° | a hatched slot line | the lines and the group's foot slide |
| Sidebar pages | the row, tilted 1.5° | the Thread Blue line and the parent's tint, as before | nothing: nesting needs the line |

The copy keeps the grab point under the pointer and turns about it. Above a finger it rides 24 px higher in the
sidebar, where the finger would cover a 30 px row. Several picked cards show a count on the copy (R3-26).

## How it's built

- **Lift.** `lift(el, x, y)` clones the element (a table row with its table, cells at their widths) into a fixed
  layer under `body`, flat where the element was for one frame, then `.is-up`: `rotate(-tilt) scale(1.02)` and
  `--shadow-float`, 160 ms. The copy takes no pointer events, so hit-testing under it is unchanged.
- **Slot.** The lifted thing leaves the layout (`.is-lifted`, `display: none`) and a `.drag-slot` of its height is
  drawn in the React tree where it would land (`withSlot`). It's one keyed element, so within a column it slides
  rather than reappearing.
- **Room.** Before each redraw that moves the slot, the rects of everything that can move are measured; after the
  redraw each slides from where it was to where it is (`measure` and `flip`, Web Animations, 180 ms). The pointer is
  read against `layoutRect`, the box without the slide under way, so a card still moving out of the way can't take
  the slot back.
- **Landing.** On release the data moves first, so the row is drawn in its new place at once: a cross-column drop was
  already a pending cell; a same-column reorder now registers a pending move of its own until the save returns
  (`useMoveRow`). The row is drawn hidden (`.is-landing`) while the copy glides to its rect in 220 ms, then shows as
  the copy goes, in the same paint. A cancel glides back to where it stayed. The sidebar's move isn't optimistic, so
  there the copy waits where it was let go until the row has moved, or 450 ms, and glides then.
- **Reduced motion.** The lift and the slot stay; the tilt, the slide and the glide go.

## Checks

Run on a scratch SQLite on port 3001 (Nov 8), pointer events dispatched from the page, both colour schemes:

- Board: lift, slot before a card and at a column's end, counts 2/2/1 while held, cross-column and same-column drops
  land with the copy gone and the card in place; Esc returns the card. The slot reads in light and dark.
- List and table: a row lifted by its `⋮⋮`, slot at a group's end, drop into another group ("Moved to In progress")
  and a reorder within one; nothing left behind.
- Sidebar: the row rides under the pointer, the origin stays faint, the line shows, the copy glides to the moved row
  once the save is back; Esc glides it home.
- Not run: the phone (long-press) path, the geometry gate, and several picked cards.
