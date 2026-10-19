# Drag feedback and date navigation (design proposal)

Status: proposal for Brian's review (feedback 2026-10-17 21:18Z, items 1, 3, 4, 6). Not built.
Owner: Jazz (design). Product rules: Bumblebee, `docs/design/date-navigation-rules.md` (product/date-rules 80c3b62); this doc only covers how those rules look and feel.
Prototype: `prototypes/drag-and-dates/index.html` (`?only=drag|past|today|future|emptypast|calendar|phone`).

## 1. Drag: show what is moving

| Moment | What the user sees |
|---|---|
| Press the handle | The exact blocks that will move get a light blue tint at once (a heading = its whole section, empty lines included). A contiguous range reads as one tinted block; only its first handle stays visible. |
| Start moving (4px) | The originals stay in place at 35% opacity. A card follows the pointer showing the real content: the heading in bold, then up to 3 non-empty lines with their checkbox or bullet, then "+N more". Slight lift (shadow, -1deg). Multi-selected lines show a count badge. |
| Over a valid spot | Blue drop line with a ring at its left end (unchanged). |
| Drop | The moved blocks flash the same blue in their new place and fade over 0.9s. Notice "Moved 'Notes' · Undo". |
| Phone | Long-press (350ms) on the right-edge handle lifts; the tint appears on touch-down so the user sees what a long-press would lift. Same card under the finger. |

Rule: the tinted range, the card content and what actually moves always come from the same range function (`sectionRange` / selection). They can never disagree.

Implementation note: desktop can keep HTML5 drag and pass a cloned card to `setDragImage`; phone already uses a custom pointer drag and can render the same card element.

## 3. Header and Today

- Title is the date picker: "Yesterday, Fri, Oct 16 ⌄". The separate "Oct 16, 2026 ⌄" pill is removed (it repeated the title).
- Right side: `Today  ‹  ›`. Today sits left of the arrows (Google Calendar, Apple Calendar, Notion Calendar order). On today it is hidden but keeps its space, so the arrows never move and no inactive "Today" button sits on the Today page.
- `›` on today: dimmed, not clickable; hover/long-press shows the tooltip "Future days open from the Calendar".
- Phone: relative day ("Today", "Yesterday") is a small blue line above the date so the title never wraps.

## 4. Future and empty days

- Date picker: future dates greyed and disabled; dot = day has a page.
- Calendar (month grid): future days greyed, no "Empty page" cards; planned/due tasks still listed, greyed. Clicking a future day opens "Wed, Oct 21 hasn't happened yet · Create its page now to plan ahead? It starts from your day template. · Cancel / Create page".
- Future URL without a page: same message as a page-sized dashed state, with Create page and the tasks already planned for that day.
- Past day without a page (R10, team addition): "Nothing written on Sat, Oct 10 · Start this page".
- Sidebar DAYS: past days with content only; today is not repeated.

## 6. Removed from the day header

The "Local only · AI simulated" developer line, the date pill, the second Today control, and "Nothing else open ›" (shown only when there is something: "3 other open tasks ›").
