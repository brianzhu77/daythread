# Adopting HeroUI v3 (design note)

Status: design note for Brian's instruction of 2026-10-17 21:33Z ("Web uses the latest HeroUI; its official style is good; don't reinvent wheels"). Not built.
Owner: Jazz. Editor library review: Bumblebee + Wheeljack (separate).

## What HeroUI v3 is (checked 2026-10-17)

- Latest `@heroui/react` / `@heroui/styles` = 3.2.6 (npm). v3 is a rewrite: React Aria Components (keyboard, screen reader, WCAG 2.1 AA), Tailwind CSS v4, styles separate from logic, CSS transitions instead of Framer Motion.
- Theming = CSS variables (`--background`, `--surface`, `--overlay`, `--accent`, `--muted`, `--default`, `--danger`, `--border`, `--separator`, `--radius`, `--field-radius`, shadows), light/dark switched by `data-theme` on `<html>`. Theme Builder exports these variables.
- Principles that matter for us: semantic variants (primary = one forward action per context, secondary, tertiary = dismiss, danger); composition (compound parts we can omit); beautiful defaults, customise only through variables.
- Our project has no Tailwind today; adopting HeroUI means adding Tailwind v4 (engineering).

## Design rule

Use HeroUI's default theme as-is. No colour, radius or font overrides in the first pass. Our own CSS shrinks to page layout and the editor surface. This also retires the Craft-sampled tokens in `craft-v1-prelaunch-replace.md`, which removes that App Store risk.

## Deliberate deviations from the default theme

1. Header date picker only: unavailable (future) dates are plain grey, no line-through. Reason: a struck-through date reads as "cancelled"; these days simply haven't happened (Bumblebee + Jazz, 2026-10-17).

## Our custom pieces and their HeroUI replacement

| Today (custom) | HeroUI | Notes |
|---|---|---|
| Buttons, icon buttons, `‹ ›` | `Button` (primary/secondary/tertiary/ghost, `isIconOnly`), `ButtonGroup` | Day header: `Today` = secondary, arrows = two separate icon-only `Button`s, 4px gap (no `ButtonGroup`: the Tooltip wrapper on the disabled arrow breaks its joined edges). Disabled `›` = `Tooltip` > `Tooltip.Trigger` > `Button isDisabled` (Ratchet task #46 verified the tooltip shows on hover in 3.2.6): "Future days open from the Calendar". |
| Date pill + native `<input type=date>` | `Popover` + `Calendar` with `maxValue={today}` | Title opens it; future days unavailable for free. No "has a page" dots (would need custom cells). |
| "Hasn't happened yet · Create page" | `Popover` (Calendar cell) / `AlertDialog` (phone) | Create page = primary, Cancel = tertiary. |
| Edit notices "Deleted 'Notes' · Undo" | `Toast` with action button | Position: top on phone, bottom on desktop (unchanged rule). Undo toasts stay at least 8s and do not close while hovered or focused (product rule). |
| Capture sheet (phone) | `Drawer` placement bottom; desktop `Modal` | |
| Task row "More" menu, Actions | `Dropdown` | |
| Tasks pills Today · Upcoming · Open · Not today | `Tabs` | |
| Calendar Earlier / Later | `Button` (secondary), `← Earlier  Later →  Today` | Paging actions, not a selectable state, so not `Tabs` (a screen reader would announce "selected"). Today appears last, only when today is out of range; nothing is reserved, so Earlier/Later never move. Rule: Today sits on the side away from the group's aligned edge (header is right-aligned, so `Today ‹ ›`). |
| Tags: Due, Not today, Was due | `Chip` | danger only for passed deadlines (existing rule). |
| Morning card | `Card` + `Button` | One primary ("Keep all"), the rest secondary. |
| Loading text | `Skeleton` / `Spinner` | |
| `⌘J` hints | `Kbd` | |
| Sidebar nav | `ListBox` or `Link` items on `Surface` | |

Stays custom (no HeroUI equivalent): the month grid with tasks (HeroUI `Calendar` is a picker, not an agenda; its `maxValue` would also make future days unclickable, which removes Create page, so it is used only in the header date picker), the phone tab bar, and the editor surface. These use HeroUI variables only (`--surface`, `--separator`, `--muted`, `--accent`), never new colours.

## The editor and HeroUI

BlockNote renders its own menus (slash menu, formatting bar, side menu) with Mantine; it also ships shadcn and Ariakit variants, but none for HeroUI. If we keep BlockNote, its menus must take HeroUI's look through BlockNote's CSS-variable theme (map `--overlay`, `--overlay-shadow`, `--radius`, `--accent`, font). Otherwise the page will mix two visual systems. Whichever editor library Wheeljack recommends, this mapping is part of the switch.

## Effect on the drag-and-dates prototype

The behaviour decisions stand (press tint, faded original, content card, `Today ‹ ›`, greyed future dates). Only the controls change to HeroUI components above; the prototype's hand-drawn buttons are placeholders.
