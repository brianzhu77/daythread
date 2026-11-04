# Side and center peek: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **center peek built and live** (#112, #113, 2026-11-04); side peek in progress. Checklist R4-11 says what's open. Task #286, checklist R4-11.
- **Evidence:** [Notion's page on views][h] gives the "Open pages in" setting and its defaults. It says nothing about keys, the URL, what stays usable in a center peek, or the phone, so those parts below are my proposals. I read our code on main and ran nothing.
- **Brian's use:** no databases at the last read (Nov 3, rev 793). Use sets the order, not whether this is in (Brian 57deaed7).

## 1. What Notion's page gives

Each view has its own setting, under Layout, "Open pages in":

| Choice | What it does |
| --- | --- |
| Side peek | Opens on the right, and the view stays usable on the left |
| Center peek | Opens in a focused modal |
| Full page | Opens as a full page |

Notion's defaults are side peek for Table, Board, List and Timeline, and center peek for Gallery and Calendar. **Ours stays full page for every view** (Lead 4959a74b), so no existing view changes.

## 2. The real risk: two editors in one tab

Today a row opens by leaving the view: `useOpenRow` (`database-block.tsx:528`) navigates to `/pages?page={row}`, and each screen renders one editor (`ContinuousPage` in `day-screen.tsx:70`, and `pages-screen.tsx:66` and `:247`, the last for a template). **A peek is the first time a tab holds two live editors,** the row's over the page that holds the view. From reading the code, that breaks these assumptions:

| Assumption | Where | What a peek needs |
| --- | --- | --- |
| The window scrolls | 6 `window.scroll*` calls in `page-editor.tsx`, such as drag's auto-scroll (`:1791`) and keeping the caret in sight (`:1963`-`:2000`) | The editor takes its scroller as an input |
| One title on the document | `document.querySelector('.page-title-field')` (`:2479`) and `.is-picked` (`:2466`), among 17 `document.querySelector` or `window.innerHeight` uses to check | Look inside this editor only, or the caret lands on the page behind |
| One editor per page | `registerEditorFlush` is keyed by page id | The same page can't be open twice (§4) |
| Undo belongs to the page in focus | `:2429` and `database-block.tsx:623` | ⌘Z acts on where the focus is, with no second Undo fired behind |

**The phone is out of this:** it stays full page, so the keyboard and visible-area code (B50) doesn't have to work in a panel. That's the hardest part of the editor to move, and the main reason I wouldn't extend a peek to 390.

**The save path shouldn't change.** Closing a peek is leaving a page: the editor unmounts and sends its leaving save, a failed one stays as a kept draft, and `flushEditor` covers commands from outside. Reusing this, rather than adding a peek-specific save, is the design's main bet. **Roadbuster, please check it first, as it decides the cost.**

## 3. How it behaves at 1280

The peek holds what `pages-screen.tsx:58`-`:68` draws for a row now: the head with its `⋯`, title, Linked from, `RowProperties`, body and Subpages. That block becomes one component with two homes. A row template still opens on its own screen, as a full page.

| Action | Result |
| --- | --- |
| Open a row, or tap `Open` | Follows the view's setting. Every way of opening goes through `useOpenRow`, so it's one change |
| `+ New` | As today: at 1280 the title opens to be typed in the view. A peek opens only when asked |
| ↗ in the peek's head | Full page, with the caret where it was if that's cheap |
| ↑ ↓ in the peek's head | The previous or next row in this view's current order, across groups. Grey at either end. **Not the bare arrow keys,** which move the caret |
| Esc | One layer per press, innermost first: a pinyin composition, a menu, the `/` list, a paste menu, a selection (`:360`, `:2377`, `:2462`), then the peek. So a caret in the body with nothing else open closes it. In a cell's editor behind a side peek, Esc leaves the cell first (Jazz c20b5a25) |
| **Side:** tap another row | That row replaces it, after saving, with the view's scroll unmoved |
| **Side:** tap empty space in the view | **Stays open** (Jazz c20b5a25). A press there can start a box drag or clear a pick, and a mis-tap would lose the caret and scroll in a long body. ×, Esc and Back close it. Editing a cell leaves it open too. **Known difference, on weak evidence:** [one user's post][tana] lists clicking away as closing Notion's side peek, and Notion's own page doesn't say. A one-line change if Brian expects it |
| **Center:** tap outside | Closes it. The view behind doesn't respond |

**Keeping the place:** the view never unmounted, so scroll, filters and folded groups stay, and the row just left isn't flashed with `useReturnedRow`.

**The URL (my proposal):** `?peek={rowId}` on top of the page's URL. Opening adds one history entry, and moving to another row replaces it, so Back closes the peek instead of walking through every row. A reload reopens it. A line link inside it still copies the full-page link, `/pages?page={row}&block={line}`, which opens as a full page.

## 4. Edges

- **To-dos views:** no setting. A to-do has no page, so it keeps opening on its line (§11).
- **The page behind is that row:** when a row's body holds a view of its own database and that row is tapped, nothing opens. The page is already in front of Brian, and two editors on one page would collide on `flushers`.
- **Peek inside a peek:** a view in the peek's body opens its rows in the same peek. ↑ ↓ then follow that inner view, and there's no stack. Back closes the peek.
- **A cell edited behind a side peek, on the row that's open:** the existing flush rule applies, so the typing saves first. Nothing is lost, and no "Page changed elsewhere" shows. **This needs a script,** and it's the case most likely to go wrong.
- **The open row leaves the view** because of a filter or an edit: the peek stays open on it. ↑ ↓ go on from where it was.
- **The open row is deleted** from the view or another tab: as for a full page that's gone today. From the view, one Undo brings the row back, and the peek doesn't reopen.
- **A synced block on both pages (B21):** the row's body and the page behind are then two places open in one tab, which is the path the Lead's #96 review found losing an edit (bugs 2 and 3, `1f45d7f2`). **So a peek must not ship before that fix,** and B21's script gets this case.
- **Narrow windows (Jazz c20b5a25):** a side peek needs 1100 px or more: the sidebar's 260, a view of at least 420, and a peek of at least 420. From 900 to 1099 a side setting opens as a center peek, so Brian stays on the view. Below `popoverMinWidth` (900 px, `useWide`) it opens as a full page, as the phone does, and so does a `?peek` link. **A window resized across a floor with a peek open** loses no words and keeps the same row open; the caret should stay if that's cheap.
- **Menus and sheets:** the editor's menus use fixed portals, so they must sit above the peek. A center peek's focus trap mustn't shut them out.
- **Old tabs and rollback:** an older build ignores the view's new field and keeps it when saving (R4-15). It opens as a full page.

## 5. The look (for Jazz)

Black, white and grey (116a40ab), with `--line` on the seam and no shadow unless the center modal needs one. Side peek takes about half the window, and a drag to resize can wait until use asks for it, though Notion has one (from memory, not its page, so please check). Rows inside keep their columns, so the alignment gate needs **a peek as a required place at 1280, in both forms** (R4-16).

## 6. Build order (Lead c3eb70ca: after B21's fixes, in this order)

1. **The editor's scroller and document-wide lookups,** with no visible change, all gates passing. It's the risky part and ships safely alone.
2. **Center peek,** because the view behind doesn't respond, so a cell can't change under the typing.
3. **Side peek,** adding row swaps and §4's cell edit.

**If step 1 costs far more than expected,** the fallback is center peek first and side peek reconsidered with the Lead. It doesn't drop out quietly.

## 7. Open

- **Settled with Jazz (c20b5a25):** the `?peek` URL, Esc's order, the floors, and a side peek staying open on empty space, all above.
- **Roadbuster:** §2's bet, that the leaving save covers closing a peek as it is.
- **Not known, needs Notion itself:** what Notion does on keys and on the phone. I haven't used it, and its pages don't say.

[h]: https://www.notion.com/help/views-filters-and-sorts
[tana]: https://ideas.tana.inc/posts/460-peek-side-or-center

## 8. As built, center (Jazz, task #286)

- **Setting:** Layout → "Open pages in", Full page or Center peek. Side comes with step 3. To-dos don't offer it.
- **↑ ↓** walk the view's rows in their sorted order, not across groups' drawn order, and don't show after a reload, since the list comes from the view he opened it in.
- **Esc,** one per layer: a composition, a menu or the `/` list, words selected or a line picked, then the peek.
- **Scroll:** the page behind doesn't scroll while it's up. The panel is the editor's scroller, through `EditorScrollerContext`.
- **The gate** requires a peek at 1280, on `/pages?page=fixture-peek-db&peek=fixture-peek-row`.

## 9. As built, side (Jazz, task #286)

- **Setting:** Layout → "Open pages in" adds Side peek. The URL is `?peek={row}&side=1`, so a reload reopens it at the side.
- **Width:** half the window, between 420 px and whatever leaves the view 420 (`--side-peek-width`). The view reflows into the rest.
- **↑ ↓** now follow the rows as drawn, across groups and folds, in both forms. Rows past "Show more" aren't drawn, so the arrows stop at the last one that is.
- **The open row** is marked in the view.
- **`⋯` in the head, both forms:** the row's own menu. Duplicate opens the copy in the peek, Delete closes it and stays on the view, and Move to… shows over it.
- **Scroll:** the view can scroll beside a side peek, and closing leaves it there, by ×, Esc or Back. A peek's entry shares the page's place in the router's scroll record.
- **Esc** in a field behind a side peek leaves the field. A pick in the view is the view's own and doesn't hold up closing the peek.

