# Synced block: states

- Author: Jazz (Design) · 2026-10-21 · status: **design states for review**. Base main df05165 (B21 on the checklist).
- Inputs:
  - Brian `7b89f7c9`: he copies between pages, sometimes plainly and sometimes as a synced block, and accepts
    Notion's model: turn blocks into a synced block first, then copy and paste it onto another page;
  - Lead `dfcb04d4` (to Brian: same content in both places, an edit in one shows in the other, each copy can be
    unsynced; plain copy stays as today) and the go for this doc (tasks inside: propose a rule, "no tasks, first
    version" is acceptable);
  - Bumblebee: v0.3 §6.3 "copied text never re-syncs" stays true, with one exception: a synced block he makes himself.
    Tracked, not counted (17 of 20) until the plan shows its size.
- Design sources reused: the selection bar (`page-editor.tsx`, "N blocks selected · Delete"), the editor's notice
  strip, `[[` links and Linked from (`page-links-states.md` §1, §5), trash (`pages-trash-layout.md`), the geometry
  rule (Lead `4b3ce971`).
- **Out of scope:** plain copy (unchanged; Roadbuster is checking it), syncing a whole page, syncing across days by
  date, anything automatic. A synced block only exists because he made one.

## 1. The model in one paragraph

A synced block is **one piece of content shown on several pages**. Every place it shows is equal: he can edit it in
any of them, and the edit shows in all of them. There is **no "original"**. That removes the hardest Notion state
(what happens to the copies when the original is deleted) and matches how Brian described it: "both places show the
same content". The content exists as long as at least one page still shows it.

## 2. Making one

- **Entry: the selection bar he already has.** Select whole lines (click the handle, Shift-click to extend, or a
  text selection across lines, as today). The bar gains one button:
  ```
  3 blocks selected   [ Sync ]  [ Delete ]
  ```
  Same bar at 1280 and at 390 (44 px buttons), so there's nothing new to find on the phone. No new menu, no slash
  item, no shortcut in the first version.
- **Tap Sync:** the selected lines become one synced block in place. Nothing moves and no text changes. Notice:
  **"Synced block · Copy it to another page · Undo"**, where "Copy" copies it right away (the phone has no ⌘C on a
  block). Undo puts back the plain lines exactly.
- **What can be synced (first version):** paragraphs, bullets (any nesting), numbered lines, headings on ordinary
  pages, and lines containing `[[` links or tags. **Not:**
  - **task rows.** A task belongs to one day and one place; the same task showing on two days would contradict the
    plan sections, carry-over and the Tasks screen. This is the "no tasks, first version" rule;
  - **page and link cards.** A card makes its page a child of the page holding it; one card on two pages would give
    the page two parents;
  - **a day page's template headings** (Top 3, Other, Notes). They're the day's structure, not his content.
  If the selection holds any of these, Sync still shows, and a tap changes nothing and says why:
  **"Tasks, cards and day headings can't be synced yet. Select only text lines."** (A disabled button can't explain
  itself on the phone.)

## 3. How it looks

```
      ┌─────────────────────────────────────────────  ↻ Synced · 2 pages ⌄ ┐   ← label: hover or caret inside
      │ • 周末备菜：大酱汤底，泡菜，豆腐                                        │
      │ • 买 [▢ 韩国大酱汤] 的配料                                              │
      └────────────────────────────────────────────────────────────────────────┘
```

- **At rest:** a 1 px `--line` outline, 8 px radius, drawn in the margin around the lines. The lines inside keep
  **exactly** the columns they'd have outside (bullets, nesting, text start), so the page's alignment doesn't change.
  No colour, no fill: the page stays black, white and grey (Brian `116a40ab`).
- **Hover, or the caret inside:** the outline darkens to `--ink-3`, and a small label sits on the top edge at the
  right: **"↻ Synced · {n} pages ⌄"** in 12 px `--ink-2`. At 390 the label shows while the caret is inside (no hover).
- **"Only here":** when it's on one page, the label reads "↻ Synced · only here". It stays a synced block, so he can
  still copy it elsewhere later.
- **Tap the label:** a small menu, the app's `RowMenu` style:
  - **On** — each other page that shows it, as its title or day label ("Sun, Oct 18"); tap to open that page at the
    block;
  - **Copy** — copies the synced block (same as selecting it and ⌘C);
  - **Unsync here** (§6).

## 4. Putting it on another page

- **Copy, then paste** (Brian's words): select the whole synced block and ⌘C, or use Copy in its label menu or in the
  notice. Paste on an empty line on another page, or replacing whole lines → that page now shows the same block. No
  offer, no question; it simply arrives synced, as in Notion. The label on both pages now reads "2 pages".
- **Copying text inside it** (part of a line, or some lines but not the whole block) is a **plain copy**, as today.
  Only the whole block copies as synced.
- **Pasting it where it can't go becomes plain lines** with today's paste rules, and no notice:
  - on the same page it's already on (a second copy on one page adds nothing);
  - inside another synced block (no nesting);
  - into a task row (as today, the text only);
  - into another app (the content as plain and rich text, as any copy).
- **Undo** after the paste removes it from this page, like any paste.

## 5. Editing

- **An edit in any place is the edit.** Typing, formatting, adding or deleting lines inside the block saves as normal
  and shows on every page that shows it.
- **When another page is open at the same time** (two tabs, or phone and desktop): it shows the new content the next
  time that page refreshes its data, the same way edits from another tab already arrive. If both places are edited
  at once, the existing save-conflict handling applies; **Roadbuster to confirm** what that is today and whether a
  synced block needs anything more. Design asks only that nothing he typed is silently lost.
- **⌘Z** undoes his own edits on the page where he made them, as today.
- **Inside a synced block, task-making is off:** `/` → Task, `[] ` and the checklist-paste offer don't apply there; a
  pasted task row arrives as a plain line. The slash menu just doesn't list Task inside it.
- **Empty:** if he deletes every line inside, one empty line stays inside the outline, with the placeholder "Empty
  synced block". Removing the block itself is §6.

## 6. Unsync and delete (no original, so one rule for every place)

| He does | This page | Other pages | Notice |
| --- | --- | --- | --- |
| **Unsync here** (label menu) | the lines stay, as ordinary lines with today's content | still synced with each other | "Unsynced here · still on {n} pages · Undo" (or "Unsynced" when it was only here) |
| **Select the block → Delete** | the block leaves this page | keep it, unchanged | "Removed from this page · still on {n} pages · Undo"; when it was the last place: "Deleted · Undo" |
| **Moves the page to trash** | goes to trash with the page; restore brings it back still synced | keep it; their count drops by one while it's in trash | the trash notice, as today |
| **Trashes the last page that shows it** | as above | none left | as today; there's no empty-trash, so the content stays with the trashed page and restore brings it back |

- Deleting or unsyncing on one page **never edits another page** (the same rule as page delete, A4).
- Undo on any of these notices puts the block back exactly as it was, still synced.

## 7. What it counts as elsewhere

- **Linked from:** syncing doesn't link pages to each other. The "On" list in the label menu is how he moves between
  them. A `[[` link *inside* a synced block counts once for **each** page that shows it, because it's on each of
  those pages. Its time is when that page got the block.
- **Tags (Bumblebee `8e998433`): a tag in a synced block counts once.** A tag classifies content, and this is one
  piece of content. The Tags count goes up by 1, and a tag page lists the block once, with "↻ {n} pages", under the
  **earliest day** among the pages showing it (if no day page shows it, under the page that has shown it longest).
  Tapping it opens that place; the label's menu reaches the others. If that page stops showing it, it moves to the
  next one. Day-based reading (review, Draft my day) still sees it on every day that shows it: that's day context,
  not classification.
- **Search, lines-from-day readers:** read it as the lines of each page that shows it.
- **Rollback (format down):** every place becomes ordinary lines with the content as it is at that moment. Nothing he
  wrote is lost; only the syncing stops. The rollback check proves this on a copy of his data.

## 8. Waiting and failure

- **Loading:** the block's lines render with the page; there's no separate spinner.
- **Couldn't load** (its content missing or unreadable): in its place, one line in `--ink-3`: "Couldn't load this
  synced block · Retry". The rest of the page works normally. It must never show as empty, because an empty block
  invites deleting it.
- **Save failed:** the editor's existing save-failed banner, nothing new.

## 9. Checks (copy of his data, 1280 and 390)

1. Select 2 bullets on a doc page → Sync → outline appears; bullets and text don't move (`check-alignment`).
   Undo → plain bullets, identical.
2. Copy (label menu) → paste on an empty line on today's Notes → both labels read "2 pages"; "On" lists the other
   page and opens it at the block.
3. Edit on today → reload the doc page → the edit is there. Same the other way.
4. Selection holding a task row, a card or Top 3 → Sync → the "can't be synced yet" notice and no change.
5. Inside a synced block: `/` has no Task; pasting a task row gives a plain line; no new task in SQLite.
6. Unsync here on today → today's lines are plain, the doc page reads "only here"; Undo restores "2 pages".
7. Delete the block on the doc page → "Removed from this page · still on 1 page · Undo"; today still shows it.
8. Trash the doc page → today's label drops a page; restore → back to "2 pages".
9. Paste on the same page, into another synced block and into a task row → plain lines; copy into a plain text
   field outside the app → plain text.
10. A `[[` link inside → the linked page's Linked from lists both pages.
11. Rollback on a copy: both places become ordinary lines with the latest content.
12. **Geometry:** "synced block" becomes a required row type in `check-alignment` (rows inside keep the columns they
    have outside; the outline stays in the margin; the label doesn't overlap text at 1280 or 390), and
    `align-fixtures` puts one on 2026-12-31.

## 10. Open questions

- **Roadbuster:** simultaneous edits in two places (§5); whether a page "refreshes its data" often enough that he
  won't see stale content when switching tabs.
- ~~**Bumblebee:** tags~~ **Decided:** a tag counts once (§7, Bumblebee `8e998433`).
- ~~**Lead:** discovery~~ **Decided (Lead `10e9e0f0`):** Brian is told once, in the release report ("select lines →
  Sync in the selection bar → copy the block to another page"), and nowhere in the app: no tip, no onboarding.
