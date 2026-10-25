# B27 · `@date` states (design)

Status: **proposal** for the first cut (Roadbuster's plan `docs/plan/b27-at-date-plan.md`, docs/b27-plan 62b921e; Lead
74dbbfdd). Covers the states listed in the plan's §8. Reuses existing pieces: the `[[` link list for the picker, the
page/line ref pill (`.page-ref`, `.line-ref`) for the chip and the row's link. No new tokens.

## 1. Picker (`@` or `＠`, same look and keys as the `[[` list)

| State | What shows |
|---|---|
| Just typed `@` | Today · Tomorrow · the next two weekdays, each as "Thu, Nov 20" with a quiet right label ("Today", "Tomorrow", "in 3 days"). First item highlighted, Return takes it. |
| Reading what's typed | One item: the reading, e.g. **Thu, Nov 20** and, on the right, **3:00 PM** or **All day**. "All day" is the "no time read" state: it tells him a time typed outside the chip won't count. |
| Year differs from the page's | "Mon, Jan 5, 2027". The year shows only then. |
| No reading (`@brian`, `@a`) | The list closes; his text stays as typed. No error. |
| Esc | List closes, text stays. |
| Phone | Opens above the keyboard like the `[[` list; only after a pinyin composition ends. |

Wording: dates as the app writes them elsewhere ("Thu, Nov 20"), times as "3:00 PM". No "Create event" label: the
chip is the result, not a dialog.

## 2. Chip (inline in the line)

- **Normal:** a pill like page refs: calendar glyph (14 px, `--ink-3`) + "Thu, Nov 20", or "Thu, Nov 20 · 3 PM". Year
  only when it isn't the page's year. Same height and padding as `.page-ref`, so a line with both reads as one family.
- **Today's date** reads "Today" (plus time); tomorrow "Tomorrow". Relative words only for those two; everything else
  is the date, so it doesn't change meaning when he reads the page next week. (Computed when drawn.)
- **On a to-do row:** same pill inside the title; the task's own date tag (right edge) is unchanged, so the two never
  read as the same thing. The chip is about the event, the tag about the task.
- **Tapped:** opens that day's page (desktop click and phone tap alike, one tap, as page refs do since B50).
- **In a past day's page:** same pill; nothing greys out. A past event is still what he wrote.

## 3. Events row (read live under the day's Events heading)

- **Layout:** one row per event, in the Events section, before his own Events lines. All-day first, then by time.
  Row = time in the marker/text column ("3:00 PM", or "All day" in `--ink-3`), title, then the line ref to where he
  wrote it ("↗ Thu, Oct 22 · Notes"), using the A11 line chip. Rows aren't editable lines: no caret, no checkbox, no
  ⋯ menu; the line chip is the only control. They align to the section's text column like a bullet line.
- **With a time / without:** as above.
- **Untitled** (the line is only a chip): "Untitled event" in `--ink-3`.
- **Written on a document page:** the line chip shows the page's title ("↗ Trip notes").
- **Written on the same day's page** (`@3pm`, `@今天` in Notes): the row reads as a link, not a copy: title in
  `--ink-2` and the chip says "↗ in Notes". (A chip written under that day's own Events heading gets no row.)
- **No Events heading on that page:** the rows show at the end of the page under a small non-editable label "Events"
  (`--text-meta`, `--ink-2`), so they don't look like stray lines.
- **Source page trashed:** no row (plan §2).

## 4. Choosing between rows in the editor and rows under the header (after Roadbuster's spike)

Prefer **inside the editor, under Events**: that's where he looks for the day's events and where his hand-written
Events lines are. Take the fallback (under the day header) only if the spike shows one of these at 1280 or 390:
the touch handle, side menu or keyboard-up reveal mis-measuring around the rows; the caret entering or skipping oddly
across them; or the alignment gate failing on the Events section. I'll judge from the spike's screenshots plus one
check with the keyboard up on a phone-sized view.

## 5. Not in the first cut (states for later)

Changing a chip's date by tapping it (second cut); events in Upcoming; capture-made events moving to their own day.
