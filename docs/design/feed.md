# Feed: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **approved to build with the changes below (Lead f9bab535, from Jazz's read and Ratchet's `docs/reviews/feed-dashboard-forms-ratchet.md`, 5a4b7af8, both from reading only).** Not built. The Lead builds it after G4-7.
- Asked by the Lead (3f046122, b9af4ec7). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [feeds](https://www.notion.com/help/feeds), which is thin. It gives a stack of cards, chosen properties, comments and view counts, and says nothing on how much of a page shows, editing, sorting or the phone. **Most of this doc is my proposal.** His use: no databases at the last read (Nov 2).

## 1. The idea

A feed is a layout where **you read the rows themselves**, one above another, like a blog. A table shows a row's properties; a feed shows its words. "Reading notes", "Weekly reviews".

## 2. What he sees

- **Made from** `+ Add view` → Feed, or `⋯` → Layout. One column, at the page's reading width at 1280 and full width at 390.
- **Each card:** the title, the chosen properties beneath it as one line that may wrap (Property visibility, as other layouts), then the row's body at the page's own text size. **No box:** a hairline and about 32 px before the next card, at both widths (Jazz). A new Feed shows Created time by default.
- **Long bodies, capped by height (Jazz):** about 288 px at 1280 and 384 px at 390, then a short fade in the page's colour and "Show more", which expands in place. If under about 3 lines would be hidden, it shows them all. An image is capped at 240 px tall in the preview. "Show less" at the end keeps the card's title on screen, and a card stays expanded for the session, through a trip to the row and an ordinary update. The cut never halves a checkbox or a link, or hides keyboard focus (Ratchet).
- **While bodies load:** the title and properties draw at once, with the body's space held, so nothing moves under the reader, including when an image resolves late. If a body fails: "Couldn't load · Retry" in the card, which is different from a row with no body.
- **`+ New`** at the top, since newest usually comes first. **It opens the row (Jazz):** in a peek at 1280 with the caret in the title, and on its page on a phone, as a card's body can't be written in. If the sort puts the new row out of sight, it's still found on return, with Back's tint.
- **Order:** the view's sort. A new Feed starts sorted by Created time, newest first, once R3-9 exists (it does before this ships). Filter and Group work as in a list.
- **A tap on the title** opens the row, and Back tints it. Selecting text in a body works, so it can be copied. So a click on the words does nothing, which is the likeliest confusion: accepted for the first release, and to be watched (Jazz).

## 3. Read-only bodies

A card's body isn't editable here, because a stack of live editors would be slow and each has its own save, conflict and Undo. **It's an explicit list, not the editor turned off or the export's HTML (Ratchet):** anything not listed links to the row and does nothing else. It's drawn from the stored document, and shows:

| In the body | In a card |
| --- | --- |
| Text, lists, headings, quotes | As on the page |
| A to-do | Its box and words. **A tick is the only change a card can make.** It uses the task command on the task's id, and **never saves the card's clipped document** (Ratchet, Lead). It doesn't also open the row or focus anything (B77's rule). Every place showing that task updates, one Undo reverses it, and a failure says so and leaves the card true to what's stored |
| A `[[` link or `@date` chip | As on the page, and a tap follows it |
| An image | Loaded when near the screen. A failed one leaves no frame, as Gallery |
| A database or linked view | Its name as a link, not its rows, so a feed can't nest views or get expensive |
| A button | Links to the row, and doesn't run (Ratchet) |
| A synced block | Reads the current record, with no second writer (Ratchet) |
| Anything else | A link to the row |
| An empty body | Title and properties only, and a shorter card |

**To-dos can't show as a Feed,** since a to-do has no body (§11). It isn't offered there.

## 4. What I'd leave out, for the Lead to confirm

- **View counts.** With one person, they'd only count himself.

**Not left out any more: Comments are live (Jazz, Ratchet).** A row's count sits on its properties line and opens the pane. A card has no margin marks or underlines, as it's a preview.

## 5. For Roadbuster and Jazz

- **Drawing a body without an editor:** is there a light way, for example the export's converter, or something like it? 25 cards must not mean 25 editors.
- **Cost:** rows' bodies must reach the client. If they're only sent when a row opens, a feed needs them in a batch. Cap and "Show 25 more" as elsewhere, and R2-7's bar when one is on a day page.
- **Stale cards:** a body edited in another tab updates here, with no reload.
- **Storage:** `layout: feed`, nothing else. An older tab draws a table and keeps the field. To be run at release.

## 6. Checks before release

- A 25-card feed stays smooth at 390 with 4× slowdown; measure and state it.
- A tick in a card matches the row's page and Tasks, with Undo. Also: in synced content, a task shown twice, a failure, another tab, and a row entering or leaving a filter after the tick (Ratchet). Its document is byte for byte unchanged by a tick.
- A card's text matches its page, including chips and Chinese.
- Tapping a card's text at 390 raises no keyboard, and scrolling never opens a row.
- An older tab keeps `layout`, with a rollback run.
