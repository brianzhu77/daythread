# A11 · Link to a line: states

- Author: Jazz (Design) · 2026-10-21 · status: **design states for review**. Base main 48cfcaa.
- **v1 scope (Lead 2026-10-22, A11 thread `#daythread:4685e651`):** no cross-page move identity. A paste always gets
  fresh ids, as today; only task links follow their task. A plain line that is cut and pasted (to another page or
  within the same page) or deleted reads "**Line not found · {page}**". Move identity is v2, triggered by Bumblebee's
  usage-read count.
- Inputs:
  - Brian `c5c9142e` #1 (Oct 18): "block-level query and reference like Notion";
  - Lead `4aa0a79b` (A11 next: Copy link to line in the row ⋯ menu and ⌘/, inline look next to a `[[` page link,
    opening it at 1280 and 390, deleted or moved lines, Linked from, a fixture for the geometry rule);
  - Bumblebee `961b5f0f` (follow the line when it moves; a removed line still opens its last page and says so; "query"
    is the Tags list) and Roadbuster `dde11650` (an optional `blockId` on the A9a link; the existing `?block=` route);
  - design sources reused: the `[[` page link and its states (`page-links-states.md` §1), Linked from (§5), the
    selection bar, the row menu and ⌘/ (`day-row-actions-states.md` §2), and the tag jump (`page-editor.tsx`: "bring
    that block into view and tint it briefly").
- **Nothing new to learn.** A line link is a page link that also knows its line. It's copied like Notion's "Copy link
  to block" and pasted like any text.

## 1. Copying a link to a line

Three ways to reach the same action, all already on screen today:

- **⌘/ (Ctrl+/) on any line:** the row menu gains **Copy link to line**. On a task row it goes last, under a divider,
  after the task actions; on other lines it's the only item. **Where the menu opens:** under the line's own box, at its
  text start, like the row ⋯ menu; if there's no room below (a line near the bottom of the screen, which is where he
  types at the end of a page), it opens above the line. Never anchored to the caret alone, and never partly off-screen
  (build check of f672ba9).
- **The ⋯ on task rows** (A12) is the same menu, so it has it too. Other lines don't get a ⋯; the page stays quiet.
- **Selection bar, with exactly one line selected** (desktop: click the handle; 390: tap the handle):
  ```
  Block selected   [ Copy link ]  [ Delete ]
  ```
  At 390 that's the phone's way in; buttons are 44 px tall. With two or more lines selected, no Copy link: a link
  points at one line.
- **Not offered on:** an empty line, a page or link card (link the page itself with `[[`), and the day's template
  headings (Top 3, Other, Notes are structure; link a line under them instead). Ordinary headings on pages can be
  linked; they're the natural target for "that section".
- **After copying:** notice "**Link to line copied**", no Undo (nothing changed). If the clipboard write fails:
  "**Couldn't copy**", and never "copied" (a11 plan rev 2 §5). The clipboard holds the app's link
  (for pasting in the app) and a plain URL (`…/day/2026-10-18?block=…` or `…/pages?page=…&block=…`) for other apps.

## 2. Pasting it

- **In the app:** pasting it anywhere in a line inserts a **line link**, inline, like a `[[` page link. On an empty line
  it's the only thing on the line. **In a task title** it pastes the line's words as plain text: task rows hold no
  page links (the A9a rule), so they hold no line links either (Roadbuster a11 plan, `e4b7d0ed`).
- **On the same page as its line:** allowed; it works as a jump within the page.
- **In another app:** the plain URL, which opens the line when he's on this computer.
- Undo removes it like any paste.

## 3. How it looks

```
做法参考 [▢ 韩国大酱汤] 里的配料                       ← page link (A9a, unchanged)
上次的想法 [↳ 原生家庭创伤导致的讨好型人格… · Oct 18]    ← line link
```

- Same chip as a page link: `--fill` background, 4 px radius, the line's own text size, never blue or underlined.
- **↳** (14 px, `--ink-3`) instead of the page icon, so it reads as "a passage", not "a page".
- **The line's current words**, first ~32 characters with an ellipsis, in `--ink`; tags inside show as plain text.
  They're live: when the line is edited, every link shows the new words (nothing is stored as text, as with titles).
- **" · {where}"** in `--ink-3`: the day as "Oct 18" or "Today" for a day page, the page title (ellipsized at ~16
  characters) for other pages. Same short form as the sidebar (B20).
- **Whole chip max width:** the text column; it never wraps inside itself. On a narrow 390 line it shrinks the
  excerpt first, the " · where" part last.
- A line that's itself a task shows its title; a done task's title isn't struck through in the chip (the chip is a
  pointer, not the task).
- Hover (desktop): the full line text in a native tooltip.

## 4. Opening it

- **Tap or click:** opens the page the line is on **now**, scrolls the line into view about a third from the top of the
  visible area, and tints it briefly. Nothing is focused, so the phone keyboard stays down. Tag links switch to this same
  jump (they centred the line before), so there is one behaviour; the 350 ms drift check keeps the same target.
- **390:** the line lands clear of the top bar and above the bottom bar's fade (B20), never under it.
- **On the same page:** scrolls and tints, no navigation.
- Back (browser or the app's back) returns to where he tapped it, as any page link.
- **The lookup fails** (offline, a server error): don't jump anywhere. Open the page named in the URL at the top, with the
  notice "**Couldn't check where that line is now · Retry**", and keep the URL as it is, so Retry or a reload tries again
  (Bumblebee 499095e0; the app's offline rule: say what couldn't happen, never guess). Never land on an old row silently.

## 5. When the line changes

| What happened to the line | The chip shows | Tap |
| --- | --- | --- |
| **edited** | its new words | opens it, as §4 |
| ~~**moved to another page** (cut and pasted)~~ | **v2.** In v1 a cut-and-pasted plain line reads as "not found" below; task lines follow their task (rows below) | |
| **copied** (Bring to today, copy and paste) | unchanged: the link stays on the original line | opens the original |
| **a task line whose task moved day** | its words · **the day it's planned for now**, not the history row left on the old day (Jazz `93497700`) | opens that day; the URL from other apps resolves the same way |
| **a task line whose task has no plan day** (Not today, paused) | its words · the most recent page that still shows its row (Bumblebee `565cad22`) | opens that page |
| **a task line whose task is done** | its words · the day it was completed on (Bumblebee) | opens that day |
| **deleted, or cut and pasted** (to another page or within the same page; v1) | "**Line not found · {last page}**" in `--ink-3`, ↳ icon kept. Not "removed": in v1 the line may still exist with a new id | opens that page at the top, notice "**Couldn't find that line**" |
| **its page is in the trash** | its words · {page} in `--ink-3` with the bin icon, like a trashed page link | opens the trashed page (banner + Restore, A4), scrolled to the line |
| **its page doesn't exist** | "**Page not found**" in `--ink-3` | nothing |

- **Which moves keep the line (v1):** edits, Enter, indent and **drag** within a page; a task moved to another day
  (row menu, hand-off), followed through its task. Bring to today is a copy. **Cut and paste never keeps it in v1**
  (fresh ids, as today), including reordering within a page: drag instead. Anything that loses the line reads "Line
  not found · {last page}", never a broken chip.
- The text around the chip never changes in any of these cases.

## 6. Linked from

- A line link counts as a link to **its page** (the page the line is on now). The page's Linked from lists the
  linking page once, newest first (B15 rule, unchanged), whether it links the page, a line on it, or both.
- When a linked **task** moves to another day, the entry moves with it: the old page loses it, the new page gains it
  (with the time the link was made, not the move). A plain line's link stays on its last page (v1).
- No per-line backlink count in the first version.

## 7. Checks (copy of his data, 1280 and 390)

1. ⌘/ on a bullet under 奥德赛 → Copy link to line → "Link to line copied". Same from a task's ⋯ (last item) and from
   the selection bar with one line selected (390).
2. Paste in today's Notes → chip "↳ 原生家庭创伤导致的讨好型… · Oct 18"; tap → Oct 18, the line a third from the top,
   tinted; at 390 clear of both bars; nothing focused.
3. Edit the line → the chip's words change on reload of today.
4. Move a linked task to tomorrow → the chip says "· Oct 22" (or its date) and opens it there.
5. Delete the line → "Line not found · Oct 18"; tap → Oct 18 at the top with "Couldn't find that line".
   Same for cutting the line and pasting it lower on Oct 18, or onto today (v1). Dragging it within Oct 18 keeps the
   link.
6. Trash the page holding a linked line → bin chip, opens the trashed page.
7. Oct 18's Linked from lists Today once (with a page link and a line link to it from Today, still once).
8. Not offered: empty line, card, Top 3 heading, two lines selected.
9. Paste into a plain text field outside the app → the URL; open it → the line, tinted.
10. **Geometry:** "line link" becomes a required inline type in `check-alignment` (chip height within the line box,
    its text baseline on the line's baseline, same as the page link chip, at 1280 and 390), and `align-fixtures`
    puts one on 2026-12-31.

## 8. Open

- ~~**Roadbuster:** moves, URL form~~ **Answered** by a11 plan 42a2c3f (§5 above; URL `/pages?page=…&block=…`).
- Size: one inline type plus three entry points; all states reuse page-link ones.
