# Search: one field over everything written

Status: built (branch `claude/great-knuth-rrmz66`), for Brian's review. Specs 01 names the need ("按标题或正文搜索") and the
Craft study maps it to Quick Open ("⌘K on Mac, search button on phone; pages and tasks", feature map §2.1). This file
says how it looks and behaves, in the words of system-v2 (grey, with a little blue) and the Move to… dialog it reuses.

## 1. What was looked at

How the apps Brian's notes compare against do it, from their own help pages and the earlier Craft study:

| App | Entry | Empty field | Results | Opening |
| --- | --- | --- | --- | --- |
| Notion | ⌘K / Ctrl K from anywhere (not inside a block) | recently viewed pages | one list, title first, where the page lives under it, matched words marked; ↑↓ Enter | lands on the page |
| Craft | Quick Open (⌘O), a search field at the top of Home on the phone | starred and recently opened | titles rank first, then phrase matches; recency boosts; a preview under the title, matched words highlighted | lands on the matching block |
| Apple Notes | the field at the top of the list | — | grouped, a snippet with the match in bold under the title | lands on the note |
| Obsidian | Quick switcher (titles) and a separate search pane (text) | recent notes | flat text matches with context lines | lands on the line |

What they share, and what this takes: one field, results as you type, titles before lines, the match marked in the
text, where each hit lives under it, ↑↓ and Enter, recent things when nothing is typed, and the same window from every
screen. What this leaves out: sorting controls, grid views, filters by date or type, a separate search pane for text
(Obsidian's split is the thing people ask to merge).

## 2. Where it is

- **Laptop:** the first row of the sidebar, above Today: the magnifier, "Search", and the shortcut as a quiet `⌘K`
  (`Ctrl K` elsewhere) at the row's right edge. ⌘K opens it from any screen unless a field or the editor has the keys
  (BlockNote uses ⌘K for links).
- **Phone:** a round glass button beside the tab capsule, the capsule's height, where Craft keeps `+` (craft-v1 §3.1).
  One tap from any screen; it goes with the tab bar while a keyboard is up.
- **The window:** the Move to… dialog (pages-tree-layout §5): a 560px dialog 96px from the top on a laptop, a sheet
  from the bottom on the phone with the handle and Cancel. The field is focused on open; Esc, the scrim or Cancel close
  it. Nothing about the page behind changes.

## 3. What it searches

A plain-text look over the loaded workspace, in the browser: nothing is stored, indexed on the server or sent anywhere,
and it works offline on the last-loaded copy. Trashed pages are left out, like every other list. The index is read
from the pages the way tags and links are (`src/domain/search.ts`), once per workspace change; each keystroke only
compares.

| Kind | Matched on | Shown as |
| --- | --- | --- |
| Page | its title (a bookmark page: its URL too) | icon · title · "Pages › Parent" or the day it was made in |
| Day | its date words: "Sun, Oct 18", "October 18, 2026", "2026-10-18", and "today" / "yesterday" | calendar icon · the day's label |
| Tag | its name, with or without `#` | `#` tag · "N blocks" |
| Line | its words, every typed word somewhere on the line, in any order | under the page it was written on (a day is a page: "Today", "Wed, Oct 21"; a page: its title and path): the line, two lines at most, cut around the first match, its section quietly under it |

Case, width and accents are folded ("cafe" finds "Café", full-width letters find their ASCII twins). A to-do row is
searched by its task's current title, as the editor shows it; headings are context (the section under a line), never
hits of their own; a `[[` link's title is live and not part of a line's words (editor-document `inlineText`).

Order: Pages (a title that starts with the words first, 8 at most), Tags (5 at most), then Lines grouped by page
(Brian, Oct 27: "grouped by pages, remember day page is a page"), newest day first, document order within a page, 50
at most with "N more lines match · keep typing to narrow it down" under them. A page's heading is not a row: the lines
open it, at the line.

## 4. States

1. **Empty field:** "Today" (its page is made when opened, as always), then **Recent**: the pages and days opened
   lately (`daythread.recentPages`, the list Move to… keeps), up to 8. A hint under them: "Type to search everything
   you've written · ↑↓ to move · Enter to open · Esc to close" (the keys only on a laptop).
2. **Typing:** the groups above, the typed words **bold** in the text, nothing coloured (system-v2: grey; the only blue
   is the field's focus ring). The first row is active (the sidebar's selected grey); ↑↓ move it, the pointer moves it,
   Enter or a tap opens it.
3. **Nothing matches:** "Nothing matches “{words}”" and one line on what search looks at and that each word has to
   be on the line.
4. **Opening a line:** the page opens at that line with the block jump tags use (a third from the top, tinted
   briefly); a line on a day goes to `/day/{date}?block=`, on a page to `/pages?page=&block=&from=search`, so a row
   that has since moved follows its task (A11 §4).
5. **Loading:** "Loading…" in the list while the workspace is on its way; the field still takes typing.

## 5. Checks

`tests/search.test.ts` (the index and the matching rules) and `tests/evidence/search/ui-check.mjs` (the browser over the
v1 fixture at 390 and 1280, light and dark: the shortcut, the sidebar row, the phone button beside the capsule with a
44px target inside the 16px edge, the sheet, results with the match bold, ↑↓ Enter, Esc and Cancel, a line opening
where it was written with the tint, no horizontal overflow at 390).

## 6. Decided

- **The phone keeps the round button beside the capsule** (Brian, Oct 27: the call on UX was left here). Search is an
  action from any screen, not a destination: it has no "current" state to show in a tab, it closes back to where he was,
  and the five destinations keep their tabs at ~55px. It also matches the capsule's own grammar (Craft's `+` slot).
- **Lines are grouped by page**, a day page being a page (Brian, Oct 27). One heading per page, its icon and label, the
  path after it for a nested page; the row under it keeps only its section.
