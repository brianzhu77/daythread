# B44 · Paste menu for a link: plain link or bookmark page — states

- Author: Jazz (Design) · 2026-10-24 · status: **design states for review**. Task #180. Roadbuster builds it after B43.
- Inputs:
  - Brian's note on Oct 23, under "#daythread improvements on link as page": "tooltip 提示是否建立书签页，还是只是一个
    URL。我记得notion有这个交互，可以借鉴。不然层层嵌套太多了，有的时候不一定要深入展" ("a prompt asking whether to make a
    bookmark page or keep just a URL, like Notion; otherwise there's too much nesting, and I don't always want to go
    deeper");
  - Lead 6b9aba30: Notion's paste menu. The default (Enter or Esc) keeps a plain link, and "Bookmark page" makes the
    link page.
- **What changes from A2** (`link-pages-states.md`): pasting a URL onto an empty line **no longer makes a page by
  itself**. It pastes a plain link and offers the page. Everything A2 says about the card, the page, Undo, repeats and
  the trash stays as it is, and applies once he picks "Bookmark page". A2 §1 said "There's no menu asking what to
  make, because Undo is the escape". Brian has now asked for the menu, so this replaces that sentence.

## 1. When the menu shows

The menu shows **exactly when A2 would have made a page** (A2 §1), and nowhere else:

| Paste | Result |
| --- | --- |
| One URL on an empty text, bullet or numbered line, on a day or a document page | Plain link + **menu** |
| Several URLs, one per line, onto an empty line | Plain links, one per line + **menu** for all of them |
| A link copied from a web page (one `<a href>`, A2 §1) onto an empty line | Its text as a link to its `href` + **menu** |
| A URL into a line that already has text, a task row, a heading, a quote, a code line or a title | Normal paste, as today. **No menu** |
| The app's own line URL or line link (A11) | Line link, as today. **No menu** |
| Text that isn't only links, blocks copied in the app, `mailto:` and other schemes | Normal paste. **No menu** |
| Typing a URL | Stays a link. **No menu** |

Why not in a sentence: a bookmark is a card on its own line, and turning half a sentence into a card would break his
words (A2 §1). Cutting the URL onto its own line and pasting again gets the menu.

## 2. What he sees

The pasted text goes in **first**, as an ordinary paste, so it is already done if he ignores the menu. The menu sits
just under the pasted link, in the style of the `/` and `[[` lists:

```
https://www.xiachufang.com/recipe/10324|            ← plain link, cursor at its end
┌──────────────────────────────────────────┐
│ 🔗  Keep as link                     ↵   │  ← highlighted
│ 🌐  Bookmark page                        │
│     New page in Fri, Oct 23              │
└──────────────────────────────────────────┘
```

- **Rows:** icon, label (15 px, `--ink`), and for "Bookmark page" a quiet second line (13 px, `--ink-3`) saying what
  it will do. Each row is at least 44 px tall. The "↵" hint on the highlighted row shows on desktop only.
- **"Keep as link"** is first and highlighted when the menu opens, so Enter keeps the link.
- **The second line under "Bookmark page"**, using A2's rules for one URL:

  | The URL is… | Second line |
  | --- | --- |
  | new | "New page in {this page}": "Fri, Oct 23", "Today", or the document's title |
  | already a live page (A2 §5 key) | "Saved before · {day it was made}" |
  | a page in the trash | "Restores it from the trash" |

  For several URLs the label is "Bookmark 3 pages", and the second line counts: "3 new pages in Fri, Oct 23", or
  "2 new · 1 saved before".
- **Width:** about 280 px on desktop, left edge at the start of the line. At 390 it spans the editor's text width.
- **Placement:** below the line. If there isn't room above the phone keyboard or the bottom of the window, it goes
  above the line instead. It never covers the pasted link.
- **The editor keeps focus.** The keyboard stays up on the phone, and the caret stays at the end of the paste. The
  menu is driven from the editor, like the `[[` list, so typing carries on normally.

## 3. Choosing, and every way it closes

| He does | Result |
| --- | --- |
| Enter, or Esc | **Keeps the plain link.** The menu closes and nothing else happens |
| Clicks or taps "Keep as link" | Same |
| ↑ / ↓ | Moves the highlight. Enter picks the highlighted row |
| Clicks or taps "Bookmark page", or Enter on it | Makes the bookmark (§4) |
| Types any character, including space or Backspace | **Keeps the link.** The menu closes, and the key does what it would anyway |
| Clicks or taps anywhere else, moves the caret, or selects text | Keeps the link |
| Leaves the page, switches tab, or the app goes to the background | Keeps the link |
| Scrolls so that the line leaves the screen | Keeps the link |
| Pastes again | The first menu closes as "keep". The new paste gets its own menu if §1 applies |
| ⌘Z with the menu open | Undoes the paste, the same as without a menu. The menu closes |

There's **no timeout**. The menu stays until he does one of the above, so he can read it. It never asks again for that
link: once closed, the link is an ordinary link. To bookmark it later, he can paste it again onto an empty line.

## 4. "Bookmark page"

It does **exactly A2's paste, applied to the line that's already there:**

- The plain link line, or each line for several URLs, becomes its **link card**. The page is made, reused or restored
  as A2 §4–§5 say, under the page he pasted into (A2 §3).
- **The same notices:** "Made a page · Undo", "Saved before · Mon, Oct 19 · Undo", "Restored from trash · {title} ·
  Undo", "Made 2 pages · 1 saved before · Undo".
- **Undo turns the cards back into the plain link** he had a moment ago, with A2's rules for what it deletes or
  keeps. ⌘Z right after choosing does the same as Undo (A2 §4).
- The caret goes to the empty line after the last card, as A2 does today.
- **Offline or on a failed save:** the card shows "Not created · Retry" (A2 §2). Nothing new.
- **With B43:** the new page's title and quoted description come from B43's fetch. The menu itself fetches nothing
  and never waits for the network, so it opens at once.

## 4a. A kept plain link is still remembered

Decided by the Lead in 17ab8da6, after Bumblebee 4e7b0ff1, Jazz d2a1d5bf and Bumblebee 9d91c13a. A kept plain link still records a **material with no page**, so the morning draft, Review and Weave keep seeing his links. Only the page is opt-in. Nothing about it shows on the line.

- **Only for pastes that showed the menu** (§1): a link alone on its own line. A URL in a sentence stays plain text, as today.
- **The paste's Undo or ⌘Z removes it**, the same as A2's rule for the page.
- **"Bookmark page" attaches the page to that same material.** He never ends up with two entries for one link.
- **Deleting the plain link's line removes its material**, unless a page or another line still holds it. This is B33's rule for something born on the line. A deliberate Good Stuffs save keeps today's rule: its material stays when its line goes.
- **Not in this round:** B43's title fetch runs only for bookmark pages. A kept link's material keeps its URL as its title.

## 5. Phone (390)

- **Pasting** from the long-press menu, or the keyboard's paste key, inserts the link and shows the menu above the
  keyboard, as in §2.
- **Tapping** a row picks it. Tapping the text or carrying on typing keeps the link.
- The toolbar above the keyboard stays where it is. The menu sits above the toolbar when it's shown above the line.

## 6. Accessibility

- The menu is a `listbox` with two `option`s, tied to the editor with `aria-activedescendant`, like the `[[` list.
- When it opens, a polite live region says "Paste options: Keep as link, or Bookmark page".
- Focus never moves into the menu, so a screen reader user typing on just carries on.

## 7. What this doesn't change

- Existing link pages and the cards he already has.
- Where a bookmark page lives: still under the page he pasted into (A2 §3, Lead's decision). Brian's "too much
  nesting" is answered by pages no longer being made unasked, which is what he named.
- The capture bar, the `[[` list, line links (A11), and pasting into a sentence.

## 8. Checks (his row copy, 1280 Chromium and 390 WebKit with touch)

1. Paste a URL on an empty line of today: the plain link goes in, and the menu shows under it with "Keep as link"
   highlighted and "New page in Fri, Oct 23" under "Bookmark page". No page is made yet.
2. Press Enter: the menu closes, the link stays, no page exists, and nothing is in Pages. Repeat with Esc, with a
   click outside, and with typing a space.
3. Paste again and pick "Bookmark page": a card, "Made a page · Undo", and the page is a child of today. Undo: the
   plain link is back and the page is gone.
4. Paste a URL that's already a page: "Saved before · {day}" under the label. Pick it: the card goes to that page and
   no second page is made.
5. Trash that page and paste its URL: "Restores it from the trash". Pick it: "Restored from trash".
6. Paste three URL lines: three plain links, one menu reading "Bookmark 3 pages". Pick it: three cards, one notice.
7. Paste a URL into a sentence, into a task row and into the title: no menu, as today.
8. Paste a copied web-page link (one `<a>`): its text as a link, and the menu. "Bookmark page" makes a page titled
   with that text (A2 §3).
9. At 390 with the keyboard up: the menu stays above the keyboard and doesn't cover the pasted link. Its rows are at
   least 44 px tall, and the keyboard stays up throughout.
10. ⌘Z with the menu open: the paste is gone and so is the menu.
11. Offline, pick "Bookmark page": the card shows "Not created · Retry", and Retry after reconnecting makes the page
    once.
12. No page errors, and nothing typed is lost while the menu is open.

## 9. Open questions for the plan

- **One step for ⌘Z:** "Bookmark page" replaces the plain link with a card. The paste and the bookmark should stay
  two steps (⌘Z after choosing gives back the plain link, and a second ⌘Z removes the paste). If BlockNote can't keep
  them apart, say so in the plan.
- **Should a bookmark page live at the top level of Pages** rather than under the day? His note may mean that, but
  the menu answers the part he named ("I don't always want to go deeper"). Worth asking him after a week of use, not
  now.
