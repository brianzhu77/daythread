# Notion databases: how they are used (interaction research)

Status: research input for the database design (Brian's request, #daythread msg 4b92568d). Not a design.
Author: Jazz · 2026-11-01 · branch `research/database-interactions`.
Companion docs: `notion-database-model.md` (Bumblebee, what a database is), `database-fit.md` (Roadbuster, how it fits our storage).

## Evidence and its limits

Every claim carries a tag:

- **[H]** Notion's own help or release notes (linked in Sources).
- **[S]** Seen by me on a live public Notion page, in Chromium at 1280.
- **[M]** My recollection of Notion's apps. **Not verified.** Confirm before the design relies on it.

What I could not observe, and why:

- **Editing flows live.** I have no Notion account. Signing up is an outside action I did not take, so all editing steps come from Notion's help.
- **A public page at 390.** `notion.notion.site/code-with-notion-board` loaded at 1280 but never finished loading at 390, in either headless WebKit or Chromium.
- **Opening a row on the public page.** Notion answered with a Cloudflare "Verify you are human" check. I stopped there and did not try to get past it.
- **Notion's iPhone app.** The Simulator has no App Store, so section 10 is mostly [M]. **Section 10b fills that gap** with real iPhone screens of Craft's Collections, taken from Brian's own reference set. If Notion's iPhone behaviour still matters, three screenshots from Brian would settle it: a table, an open row, and a property being edited.

Screenshots are in `notion-database-interactions/`:

- `help-switch-views.png` [H]: a full-page database with view tabs, the toolbar, the `New ▾` button and the `+ New page` row.
- `help-views-layout-menu.png` [H]: the view settings panel with the Layout picker and the `Open pages in: Side peek` setting.
- `live-public-board-1280.png` [S]: a public board with three view tabs, status groups with counts, and toolbar icons only (no `New` for a visitor).

## 1. One database, shown in two places

- **The same object either way.** An inline database is a block inside a page. A full-page database *is* a page. Both have the same views, rows and properties. [H]
- **Creating inline:** type `/Table view` or `/Board view` (one command per view type) on a page and press Enter. `/database` also exists and offers templates and "Build with AI". [H]
- **Creating full page:** make a new page, then under "Get started with" pick `•••` → `Table` (or `Board`, and so on). [H]
- **Inline → full page:** the `⤢` icon at the top of an inline database opens it full page. To *convert* it, drag the block into the sidebar as a top-level page. [H]
- **Full page → inline:** drag it into another page in the sidebar, open that page, then `⋮⋮` → `Turn into inline`. [H]
- **Sidebar:** a full-page database is a page in the tree. An inline one shows as a subpage of the page it sits on. Views are nested under the database, marked `•`. [H]
- **Inline controls appear only on hover.** `⋮⋮` moves, duplicates, deletes or copies a link to the block. [H] *Hover doesn't exist on a phone, so this pattern doesn't carry over to one.*

## 2. The database header

Shown in `help-switch-views.png`, left to right [H][S]:

- the database title and icon (on a full page this is the page title);
- view tabs, each with an icon and a name;
- the toolbar: filter, sort, automations ⚡, search 🔍, and settings `•••` (or a sliders icon);
- a blue `New` button with a `▾` beside it for templates.

Details:

- When there are many tabs, the extras collapse into `N more…`. [H]
- On narrow screens, the tabs become one dropdown: click the current view's name, then `New view`. [H]
- Search appears once the database has at least 3 pages. It covers titles and properties. [H]
- **Visitors** (`live-public-board-1280.png`) see the tabs, filter, sort and search, but no `New`. [S]

## 3. Views

- **Add:** `+` next to the view tabs, then pick a type: Table, Board, Timeline, Calendar, List, Gallery, Chart (also Form and Dashboard). Name it. A new database starts as a Table. [H]
- **Switch:** click a tab. Tabs can be dragged to reorder. `Display as` sets icon only, text only, or both, and only for you. [H]
- **The view menu** (click the view's name): rename, duplicate, delete, copy link to view. [H]
- **Settings panel** (`•••`, in `help-views-layout-menu.png`): Layout, Property visibility, Filter, Sort, Group, Sub-group, Copy link to view. Each view keeps its own settings. [H]
- **Layout panel:** a grid of view types, plus per-type toggles. For a table these are `Show vertical lines`, `Wrap all columns`, `Open pages in`, and `Show page icon`. [H]

## 4. Rows: add, open, peek

**Add a row:** [H]

- `New` at the top right, from any view. `▾` picks a template.
- `+ New page` under the last row of a Table, List or Board column.
- In a Calendar, hover a day and click `+`. In a Gallery, use the empty `+ New` card.

**Open a row:** [H]

- **Table:** hover the Name cell and click `OPEN`. Clicking the name text edits the name instead.
- **List:** click the title.
- **Board, Calendar, Gallery:** click anywhere on the card.

**Where it opens** (Layout → `Open pages in`): [H]

- **Side peek:** a panel on the right, with the database still usable on the left. Default for Table, Board, List and Timeline.
- **Center peek:** a modal. Default for Gallery and Calendar.
- **Full page.**
- The setting belongs to the view and applies to everyone using it (release note 2022-07-20).
- From a peek, `⤡` at the top left switches to full page.

## 5. Cells and properties

**Header menu:** click a column header to rename it, change its type, filter or sort by it, insert left or right, wrap text, add a Calculate footer, freeze up to it, hide, duplicate or delete. Name is the one column that can't be deleted, though it can be moved. [H]

**Add a property:** use `+` after the last column, or `Add property` in an empty database. Name it, then choose a type. [H]

**Editing values,** per Notion's help [H]:

| Type | How it's edited |
| --- | --- |
| Text, Number, URL, Email, Phone | Type in the cell. |
| Select, Multi-select | Type to search or create a tag and press Enter. A new tag gets a random colour. `•••` on a tag edits or deletes it, and `⋮⋮` reorders tags. |
| Date | A picker with `Remind`, `End date`, `Include time`, `Date format & timezone`, and `Clear`. |
| Person | Type a name and press Enter. `X` removes the person. |
| Files & media | Upload, paste a link or drag a file in. `•••` offers Delete, Download, Full screen and View original. |
| Created / edited time and by | Filled in automatically. Can't be edited. |
| Relation, Rollup | "Requires multiple steps". The help page doesn't show them. |

**Rows and columns:** [H]

- Drag a row by `⋮⋮` and a column by its header. Drag a column's edge to resize it.
- To bulk edit, hover a row and tick its checkbox (the header box selects all). A menu then edits that property on every selected row.

## 6. A row opened as a page

- **Top of the page:** the title, with pinned properties beside it (up to 15). [H]
- **Below it:** the property group, which lists every other property. Each can be shown or hidden, and they can be split into named sections. [H]
- **After that:** the page's own content. This is an ordinary document, and it can hold other databases. [H]
- **Optional:** a details panel on the right, or a `Tabbed` structure with a Content tab plus tabs showing other databases. [H]
- **One layout for every row.** "Customize layout" is set per database. It can be built only on desktop or web. Phones can display the layout, and per the help, open "Customize layout" from `···`, but the full builder isn't available there. [H]

## 7. Filter, sort, group

- **Simple filter:** pick a property, then a condition. The filter applies **only to you** unless you choose `Save for everyone`. Sort works the same way. [H]
- **Advanced filter:** AND/OR, nested up to 3 levels. [H]
- **Group and Sub-group:** each group can be hidden (👁), there's `Hide empty groups`, and groups can be ordered by hand. [H]
- **Board:** dragging a card to another column changes its grouped value. Moving a card into a hidden column is the documented way to "archive" it. [H]

## 8. Linked views (one database shown elsewhere)

- **Create:** type `/linked`, search for a database, then copy one of its views or make a new one. [H]
- **Shared rows, separate views:** a linked view has the source's rows, and edits go back to the source. Its views, filters and sorts belong only to that copy. Typical use: a filtered view of a Tasks database inside meeting notes. [H]

## 9. States Notion's help describes, and the ones it doesn't

- **Described:** an empty new database (a table with `Add property` and `New page`), search hidden under 3 pages, overflowing tabs (`N more…`), hidden groups, fields that can't be edited, and visitors without `New`. [H][S]
- **Not described:** loading, offline, a failed save, two devices editing the same cell, a deleted source behind a linked view, or very long tables (no "Load more" in the help I read). *We design these ourselves. Notion's help gives no pattern to copy.*

## 10. On a phone (Notion's iPhone app)

**Documented** [H]:

- In the Home tab, a database page can be expanded to show its pages, and toggled between its views.
- The page `···` menu has `Customize layout` (view only on a phone) and `Lock views`, which stops others changing properties and views.
- Notion moved its mobile screens to native components, one piece at a time, from 2022.

**From memory, unverified** [M]:

- Tapping a row opens it **full screen**. A phone has no side peek.
- Its properties are listed at the top of that page. Tapping one opens a native picker sheet (a select list, a date picker, a person list).
- A table keeps its columns and **scrolls sideways** inside the page.
- The view tabs turn into one view name with a dropdown, and filter, sort and settings sit behind icons or `•••`.
- An inline database in a page renders the same way, with its own sideways scroll, and `New` stays available.
- Editing a cell straight in the table is awkward on a phone. Most editing happens on the opened row's page.

## 10b. Craft's Collections on iPhone (observed in Brian's reference set)

Brian's v1 look follows Craft. Its database, called a Collection, is in his reference screenshots
(`refs/Craft ios Dec 2025/`, #109 to #167; contact sheets `refs/craft-contact-sheets/sheet-04` to `sheet-06`). These are
**real iPhone screens**, so they fill most of the gap in section 10. The tag below is **[C]**. This is not Notion, but it's
the phone pattern closest to the app Brian already uses.

- **Creating one:** the insert sheet has **Collection** under "Rich blocks" (#109, #115). It lands **inline** in the
  page, as a "Collection" title, a `Table ⌄` view picker, `⋮`, and a blue `Add`. Below that is a table with a `#`
  column, `Aa Title`, one more property column, three empty numbered rows, and a `+` (#116). [C]
- **The table on a phone:** rows are numbered. It shows two to three columns, and the rest scroll sideways. Group
  headers can be collapsed, and each group has its own `+` (#154, #155). [C]
- **Opening a row:** tapping a row opens it as a **full page**. The title comes first, then a list of fields (icon,
  name, value, with "Empty" in grey), then `+ Add Field`, then the body (#119, #120, #123). There's no peek. [C]
- **Editing a value:** tapping a field opens a **bottom sheet**. "Set Category" offers the options as one tap each,
  or a list of checkboxes for multi-select (#121, #143). [C]
- **Editing a field:** a bottom sheet titled "Edit Field" has the name, a `Type` dropdown, "Possible Values" with `+ Add
  Value`, and `Cancel` / `Apply` (#126 to #131). Changing the type asks first: "Field type changing … will convert
  the current values if possible" (#129). A new option gets a name and one of nine colour dots (#133 to #135). [C]
- **View controls:** `⋮` opens a sheet with three tiles, **Filter · Sort · Group**, then Show/Hide Fields, Edit View
  Name, Duplicate view, Delete view, Download as CSV, and Configure Collection (#137, #145). Filter, Sort and Group
  are each a small sheet built as *field → condition → value*, with `+ Add Filter` or `+ Add another sort` (#138 to
  #152). "Display Fields" is a list of fields, each with a drag handle and a switch (#158, #159). [C]
- **Views:** `Table ⌄` opens a small menu listing the views, plus `Add View` (#136). A new view is named in a sheet
  that sits over the keyboard (#164, #165). [C]
- **What Craft does *not* show:** hover controls, side peek, editing a value inside the table, and drag on the table
  itself. On the phone, every edit happens in a sheet or on the row's page.

## 11. What this means for our design (questions, not decisions)

These point at what Daythread already has, for the design pass to settle.

1. **Creating one.** Our `/` menu already has `Task`, `Page` and `Link to page` (`page-editor.tsx`). Notion uses one `/` command per view type, plus `/database` and `/linked`. *Question:* do we offer one `/Database` item (inline, starting as a table), plus "open full page" from it, instead of a command per view?
2. **Opening a row.** Notion's phone opens rows full page, and its desktop uses side peek. We already have phone bottom sheets (`search-dialog.tsx`, `page-tree.tsx`, `placement: bottom`), and `/` Page already opens a subpage. *Question:* peek on desktop, full page on phone, with one rule?
3. **Controls that only show on hover** (`⋮⋮`, `OPEN`, `+`) don't exist on a phone. Every control we show only on hover needs a tap path, and its tap area must stay inside its own row (our hit-area lesson from Oct 22).
4. **Editing properties on a phone:** a sheet per property type, matching our existing bottom sheets, not editing inside a cramped table cell.
5. **Filters "only for you" vs "for everyone":** Daythread has one user, so this distinction probably disappears. Bumblebee's model doc decides.
6. **Linked views** are how Notion puts "the same rows, filtered" into a day page. That is the likely bridge to day pages and carried to-dos, depending on Roadbuster's to-do options.
7. **The states in section 9 that Notion leaves unspecified** (offline, a failed save, a conflict, a long table) are ours to design, in line with our save-conflict and offline rules.

## Sources

- Notion Help, Create a database: https://www.notion.com/help/create-a-database
- Notion Help, Intro to databases: https://www.notion.com/help/intro-to-databases
- Notion Help, Database views, filters, sorts & groups: https://www.notion.com/help/views-filters-and-sorts
- Notion Help, Database properties: https://www.notion.com/help/database-properties
- Notion Help, Table view: https://www.notion.com/help/tables
- Notion Help, Board view: https://www.notion.com/help/boards
- Notion Help, Database page layouts: https://www.notion.com/help/layouts
- Notion Help, Linked databases: https://www.notion.com/help/guides/using-linked-databases
- Notion Help, Workspaces on mobile: https://www.notion.com/help/workspaces-on-mobile
- Notion release note, 2022-07-20 (side peek default, native mobile screens): https://www.notion.com/releases/2022-07-20
- Live public board (visitor view): https://notion.notion.site/code-with-notion-board
