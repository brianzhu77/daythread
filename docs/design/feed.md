# Feed: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **design for Lead and Jazz to review**. Not approved and not built.
- Asked by the Lead (3f046122, b9af4ec7). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [feeds](https://www.notion.com/help/feeds), which is thin. It gives a stack of cards, chosen properties, comments and view counts, and says nothing on how much of a page shows, editing, sorting or the phone. **Most of this doc is my proposal.** His use: no databases at the last read (Nov 2).

## 1. The idea

A feed is a layout where **you read the rows themselves**, one above another, like a blog. A table shows a row's properties; a feed shows its words. "Reading notes", "Weekly reviews".

## 2. What he sees

- **Made from** `+ Add view` → Feed, or `⋯` → Layout. One column, at the page's reading width at 1280 and full width at 390.
- **Each card:** the title, the chosen properties beneath it (Property visibility, as other layouts), then the row's body.
- **Long bodies:** the first 12 lines or so, then "Show more", which expands in place. Jazz to set the length.
- **`+ New`** at the top, since newest usually comes first. It opens the title to type at 1280, and the row's page on the phone, as in a list.
- **Order:** the view's sort. A new Feed starts sorted by Created time, newest first, once R3-9 exists (it does before this ships). Filter and Group work as in a list.
- **A tap on the title** opens the row, and Back tints it. Selecting text in a body works, so he can copy from it.

## 3. Read-only bodies

A card's body isn't editable here, because a stack of live editors would be slow and each has its own save, conflict and Undo. It's drawn from the stored document, and shows:

| In the body | In a card |
| --- | --- |
| Text, lists, headings, quotes | As on the page |
| A to-do | Its box and words. A tick works, using the same command as anywhere (B77's rule: no caret or keyboard) |
| A `[[` link or `@date` chip | As on the page, and a tap follows it |
| An image | Loaded when near the screen. A failed one leaves no frame, as Gallery |
| A database or linked view | Its name as a link, not its rows, so a feed can't nest views or get expensive |
| An empty body | Title and properties only, and a shorter card |

**To-dos can't show as a Feed,** since a to-do has no body (§11). It isn't offered there.

## 4. What I'd leave out, for the Lead to confirm

- **View counts.** With one person, they'd only count himself.
- **Comments.** The app has no comments at all, on pages or rows, and `databases.md` §14 doesn't list them. Notion has them everywhere, so this is a wider gap than Feed: **either list Comments in §14 as its own later item, or list it under Not planned with the reason "needs more than one person".** Notes to himself can already go in the body. I lean to Not planned, but it's your call, so it isn't a quiet cut.

## 5. For Roadbuster and Jazz

- **Drawing a body without an editor:** is there a light way, for example the export's converter, or something like it? 25 cards must not mean 25 editors.
- **Cost:** rows' bodies must reach the client. If they're only sent when a row opens, a feed needs them in a batch. Cap and "Show 25 more" as elsewhere, and R2-7's bar when one is on a day page.
- **Stale cards:** a body edited in another tab updates here, with no reload.
- **Storage:** `layout: feed`, nothing else. An older tab draws a table and keeps the field. To be run at release.

## 6. Checks before release

- A 25-card feed stays smooth at 390 with 4× slowdown; measure and state it.
- A tick in a card matches the row's page and Tasks, with Undo.
- A card's text matches its page, including chips and Chinese.
- Tapping a card's text at 390 raises no keyboard, and scrolling never opens a row.
- An older tab keeps `layout`, with a rollback run.
