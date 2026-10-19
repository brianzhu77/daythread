# Pages step B layout (N-9)

Owner: Jazz (Design). Status: proposal for Roadbuster's UI on `feat/pages-tree`. Scope is the Lead's step B
(msg `b56155fb`): Subpages list, desktop sidebar tree, Move to…, breadcrumb, Linked from. Spec sources:
`docs/specs-v0.4/pages-delta.md` N-2, N-5, N-9. Rules fixed by the Lead (msg `81ce1b0a`) are marked **[Lead]**.

Mock: `prototypes/pages-tree/index.html` (`?only=d1|d2|d3|d4|p1|p2|p3|p4`). Static, not wired to data;
tokens copied from `src/styles.css`.

Not in this round: drag in the tree and manual sibling order (B14), delete with subpages (A4), URL pages (A2),
`[[` (A9).

## 1. Desktop sidebar tree (D1, D3, D4)

Order: nav (Today · Tasks · Calendar · Pages · Tags · Review), then **Days**, then **Pages**, then "＋ New page".

- **Tree row:** a 22px disclosure column, then 16px of indent per level, then (pages only) the doc icon and the
  title. Rows without children keep the empty disclosure column, so titles at one level line up. Height 30px,
  14px text, `--ink-2`; the open page is the selected style already used by `.side-row[aria-current]`.
- **Disclosure** is always visible on rows that have children (no hover-only chevron). Clicking the chevron
  expands or collapses; clicking the title opens the page. Expanded state is view state, kept in localStorage.
- **Opening a page expands its ancestors** so the selected row is visible, and scrolls the sidebar to it if
  needed. This includes arriving by breadcrumb, Linked from, a card, or after Move (D3).
- **Days group:** Today first, then past days with content, newest first, for the current month. Earlier months
  are collapsed rows ("September", then "2025 · December" once the year differs). Today is listed here because
  it can have subpages; when Today is open, only the nav row is shown as selected (no second highlight).
  Day rows have no icon (as now) and get a chevron only when they have subpages.
- **Pages group:** top-level document pages in stored order; children in stored order, new and moved-in pages at
  the end **[Lead]**.
- **Row actions on hover or keyboard focus:** `+` (new subpage, same as `/page` but without a card: opens the
  new page with the title focused) and `⋯` (Move to…). Day rows get `+` only. Both are also reachable without
  hover: `/page` in the body and `⋯` on the page itself.
- **Long titles** truncate with an ellipsis on one line; full title in `title`. Indent stops growing after
  depth 6 (96px) so deep rows keep room for text.

## 2. Page header: breadcrumb and ⋯ (D1, P2, P3)

- The breadcrumb **replaces the "‹ Parent" back link** on every non-daily page. Daily pages keep their day header
  and have no breadcrumb.
- Content: ancestors from the root down to the parent; the page itself is not repeated (its title is right
  below). A chain rooted in a top-level page starts with **Pages**; a chain rooted in a day starts with that day
  ("Today", "Sun, Oct 18"). Example: `Pages › Trip ideas`, `Today › Call notes`.
- Each crumb is a link, 14px `--ink-2`, 44px tall tap area, hover `--fill`. The **last crumb (the parent) lands
  on this page's card** if the parent has one (current `?block=` behaviour); the others open at the top.
- **Overflow:** if the crumbs don't fit on one line, keep the first and the last and fold the middle into "…";
  "…" opens a menu of the hidden ancestors, nearest first (P3). A single crumb wider than the row truncates.
- **⋯** sits at the right end of the same row, 44×44. Menu for a document page: **Move to…** (Delete arrives
  with A4). Daily pages: no Move, so no ⋯ in this round.

## 3. Linked from (D1, P2, P3)

- One line directly under the title: link icon + "Linked from" in `--ink-3`, then one small chip per page,
  newest first. Chips: 13px, `--fill` background, 28px tall (whole chip is the tap area, the row gives 44px
  with its spacing on the phone). Days show as their date ("Fri, Oct 16"), today as "Today".
- **The breadcrumb parent never appears in Linked from**, whether or not it has other entries **[Lead]**. The
  stored references are unchanged; this is display only. After a move, an old parent whose card is still there
  shows up here (D1, D3).
- **No entries → no line** (no empty "Linked from").
- **More than 3** → first 3 + "N more", which expands the line in place.
- A referencing page in the trash shows "Thu, Oct 15 (removed)" in `--ink-3`, not tappable (N-5).
- Chip opens that page at the top (N-5, no exact-line promise).

## 4. Subpages list (D1, D4, P2)

- Closes every page that has children, daily pages included: a 1px `--line` divider, the label
  "Subpages" (13px, 600, `--ink-2`) with the count in `--ink-3`, then one row per child.
- Row = the page card's look (doc icon `--ink-3`, title, quiet ›), 40px tall on desktop and 44px on the phone,
  hover `--fill`. One line, ellipsis.
- No children → no section. No "add subpage" row here; `/page` and the sidebar `+` create children.
- A child that also has a card in the body appears in both places. That is intended (N-2).
- Place it after the editor, inside the document column; the editor's 140px bottom padding should move below the
  Subpages list so the list isn't pushed far down.

## 5. Move to… (D2, D3, P4)

- Desktop: a 480px dialog near the top. Phone: a bottom sheet. Title `Move “{title}”`, Cancel on the right,
  search field focused.
- **Empty search:** "Top level · Shows in Pages", "Today", then a **Recent** group (recently opened pages and
  days). Typing searches page titles and day labels; each row shows its path underneath in `--ink-3`
  ("Pages › Work · 2026 planning", or the day for a day's subpage). Matched letters bold.
- **Not offered:** the page itself and its descendants are left out, with a muted line
  "This page and its N subpages aren't listed." The current parent stays in the list, greyed, with a
  "Current" tag, so he can see where it is now.
- No results: "No page or day called “{q}”".
- **Applying:** tap or Enter moves at once (N-2), closes the dialog, and shows the notice
  "Moved to {target} · Undo". The page stays open; breadcrumb and tree update to the new place (D3).
- **Failures:** if the target was deleted or moved under this page meanwhile, keep the dialog open, show the
  row's reason inline ("That page is gone" / "Can't move into its own subpage") and don't move. Save failure
  uses the existing save-failed banner.
- Moving to a day: allowed (days can have subpages). The page appears in that day's Subpages and under the day
  in the sidebar.

## 6. Phone (P1–P4)

- **Pages screen:** see §8 (top level plus "In your days"). Rows with subpages show a child count in `--ink-3`
  before the ›. No tree on the phone.
- **Way down:** the page's Subpages list. **Way up:** the breadcrumb (the parent crumb is Back).
- **Move:** ⋯ → Move to… as a sheet (P4). No drag.

## 7. For Ratchet

Checks worth adding to the step B acceptance (design view):
1. Open a page three levels deep from Linked from: sidebar expands to it and the row is selected.
2. Breadcrumb at 390 with a long chain and long Chinese titles: one line, "…" menu lists the hidden ancestors.
3. The parent never shows in Linked from; after a move the old parent (with its card) does.
4. Subpages appears on a daily page with a child, and disappears when the last child moves away.
5. Move dialog never lists the page or its descendants; current parent shows as Current and can't be picked.
6. Undo after Move restores breadcrumb, tree and both Subpages lists.

## 8. Pages screen and sidebar when pages live in days (rev 2, after the 6d3560c rollback)

Most pages are made with `/page` on a day page, so most of Brian's pages have a day as parent. "Top level only"
showed him "No pages yet" while he had two pages. Fixed for desktop and phone alike:

- **Pages screen = two groups.**
  1. Top-level pages, as now (card list, child counts). No header. Left out entirely if there are none.
  2. **In your days**: header in the existing list-header style (20px, 600). Under it, one block per day that has
     subpages, newest date first: a small label with the day ("Today", "Sun, Oct 18"; 13px, 600, `--ink-2`,
     same as other small labels), then a card list of that day's **direct** subpages with child counts.
     Tapping the day label opens the day page; tapping a row opens the page.
  - Deeper pages are reached through their parent's Subpages, as everywhere else.
  - Future days with subpages are included, sorted with the rest by date (newest first, so they come first).
- **Empty state** ("No pages yet. Tap + to start one.") only when there is **no document page at all**.
- **+ on the Pages screen** still makes a top-level page.
- **Sidebar PAGES group:** if there are no top-level pages but some pages sit in days, show one muted row,
  "{n} pages in your days" (singular "1 page in your days"), 14px `--ink-2`, linking to the Pages screen. Then
  "＋ New page" as now. When there are top-level pages, no extra row (the Days tree already shows the rest).
- **Acceptance (design):** on a copy of Brian's real data (2 pages under Sun, Oct 18, none top level): Pages
  shows "In your days › Sun, Oct 18 › 韩国大酱汤 / 佛卡夏披萨", no empty line; sidebar shows "2 pages in your
  days". Check at 1280 and 390.
