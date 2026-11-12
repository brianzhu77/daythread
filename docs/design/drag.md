# Dragging, Nov 8

Status: **built Nov 8, springs Nov 9** on `design/drag-feel` and `design/drag-springs`. Brian (2026-11-08) sent a screen recording of a kanban
board whose drag he called "super cool" and asked for the same feeling, not its colours; on Nov 9 he asked for
motion.dev "to improve the texture", so every movement became a spring. What the recording does, frame by frame:
the card lifts under the cursor with a small tilt and a soft shadow; a hatched slot the card's size appears where it
would land; the other cards slide out of its way; on release the card glides into the slot and flattens.

## One feel, four places

`src/components/drag-lift.ts` holds it, and every drag in the app goes through it:

| Surface | Lifts | Where it lands | Makes room |
| --- | --- | --- | --- |
| Board cards | the card, tilted 3° | a hatched slot in the column, at the end or before a card | the column's cards and `+ New` slide; both column counts update while the card is held |
| Table rows | the row with its cells, tilted 1°, grown 1% | a hatched slot row | the rows and the group's foot slide |
| List rows | the line, tilted 1°, grown 1% | a hatched slot line | the lines and the group's foot slide |
| Sidebar pages | the row, tilted 1.5° | the Thread Blue line and the parent's tint, as before | nothing: nesting needs the line |

The copy keeps the grab point under the pointer and turns about it. Above a finger it rides 24 px higher in the
sidebar, where the finger would cover a 30 px row. Several picked cards show a count on the copy (R3-26).

## How it's built

- **Lift.** `lift(el, x, y)` clones the element (a table row with its table, cells at their widths) into a fixed
  layer under `body`, flat where the element was for one frame, then springs up: `rotate(-tilt) scale(1 + grow)`
  (Motion, `SPRING.lift`) and `--shadow-float` (CSS, 160 ms). The copy takes no pointer events, so hit-testing under
  it is unchanged.
- **Lean.** While held, the hand's speed is smoothed over the last moves (px/s). Moving right the copy turns up to 2.5°
  further about the grab point, like a card held by one corner, on `SPRING.lean`; 60 ms without a move and it comes
  back to its tilt.
- **Slot.** The lifted thing leaves the layout (`.is-lifted`, `display: none`) and a `.drag-slot` of its height is
  drawn in the React tree where it would land (`withSlot`). It's one keyed element, so within a column it slides
  rather than reappearing.
- **Room.** Before each redraw that moves the slot, the rects of everything that can move are measured; after the
  redraw each springs from where it was to where it is (`measure` and `flip`, `SPRING.shift`). A slide still under way
  is read with `layoutRect` and taken over from where the eye has it. The pointer too is read against `layoutRect`, the
  box without the slide under way, so a card still moving out of the way can't take the slot back.
- **Landing.** On release the data moves first, so the row is drawn in its new place at once: a cross-column drop was
  already a pending cell; a same-column reorder registers a pending move of its own until the save returns
  (`useMoveRow`). The row is drawn hidden (`.is-landing`) while the copy springs to its rect (`SPRING.settle`), each
  axis starting with the hand's speed at release (capped at 600 px/s, none if the hand had been still 60 ms), and
  flattens on the way; it shows as the copy goes, in the same paint. A cancel springs back to where it stayed. The
  sidebar's move isn't optimistic, so there the copy waits where it was let go until the row has moved, or 450 ms.
- **Reduced motion.** The lift and the slot stay; the tilt, the lean, the slide and the glide go.

## Springs

Motion's physics springs (`stiffness`, `damping`, mass 1), set in `drag-lift.ts`. Damping against stiffness decides
what overshoots and by how little; a slide in pixels is over within half a pixel, a turn comes all the way to rest.

| Movement | stiffness | damping | Feel |
| --- | --- | --- | --- |
| lift | 520 | 32 | up in about 200 ms, a hair past the tilt and back: a pick-up, not a fade |
| lean | 320 | 26 | follows the hand a beat behind it |
| settle | 400 | 34 | lands with the hand's momentum, a touch past the slot, at rest in about 300 ms |
| shift | 700 | 50 | the neighbours get out of the way briskly and don't bounce |

Measured (headless, Nov 9): a card's tilt reads -1.9° at the first frame, -2.9° at 40 ms, -3.27° at 160 ms, then 3°;
dragged right at about 700 px/s it reads -4.3°, and -3.0° again 320 ms after the hand stops; after release the copy is
at the slot within 280 ms and gone, with the row shown, by the next sample.

## Checks

Run on a scratch SQLite on port 3001 (Nov 8), pointer events dispatched from the page, both colour schemes:

- Board: lift, slot before a card and at a column's end, counts 2/2/1 while held, cross-column and same-column drops
  land with the copy gone and the card in place; Esc returns the card. The slot reads in light and dark.
- List and table: a row lifted by its `⋮⋮`, slot at a group's end, drop into another group ("Moved to In progress")
  and a reorder within one; nothing left behind.
- Sidebar: the row rides under the pointer, the origin stays faint, the line shows, the copy glides to the moved row
  once the save is back; Esc glides it home.
- Not run: the phone (long-press) path, the geometry gate, and several picked cards.

Nov 9, springs, in headless Chromium at 1280 driving a real mouse (`drag-probe.mjs`, kept out of the repo): board
cross-column drops in light and dark with the lean and the glide sampled every frame; a table row from one group into
another and a reorder within one, the Done row sliding on its spring as the slot arrives; the sidebar row into another
page, gliding to its nested place once the save is back; reduced motion, where the copy is placed without a turn and
nothing slides. Still not run: the phone (long-press) path, the geometry gate, several picked cards, and the editor's
line drag, which is untouched.
