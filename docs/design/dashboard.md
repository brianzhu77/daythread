# Dashboard: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **approved to build with the changes below (Lead f9bab535, from Jazz's read and Ratchet's `docs/reviews/feed-dashboard-forms-ratchet.md`, 5a4b7af8, both from reading only).** Not built. It waits for Feed and for Chart to finish.
- Asked by the Lead (3f046122, b9af4ec7). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [dashboards](https://www.notion.com/help/dashboards), which I read. It's on Business and Enterprise plans there, so I haven't used it, and the page doesn't cover the phone. His use: no databases at the last read (Nov 2).

## 1. The idea

A dashboard is **several views on one screen, from one or several databases,** with filters that apply across them: "This month" over Runs, Books and To-dos.

## 2. The main choice

In Notion a widget shows an existing view, and editing it can change that view elsewhere. **I'd make each widget a linked view** (R2), which has its own filter, layout and name, stored in the widget. So:

- Editing a widget never changes another page.
- It reuses `LaidOutView` and all five layouts, plus Chart and Feed when they're out.
- Deleting a widget takes no rows, and says "View removed", as R2-3.
- A source in Trash shows the linked view's one line with Restore.
- To-dos can be a widget.
- **Storage (Ratchet):** a widget has its own stable id and its own copy of the settings, with no live link to the source view. Duplicate makes a new id. A move and a filter edit in two tabs can't overwrite each other, and Undo refuses a stale widget change rather than restoring an old dashboard.

## 3. Making and arranging

- **Made from** Pages' `+` → Database with a Dashboard layout, or `+ Add view` → Dashboard on an existing database, as Notion. `/` stays one Database item, with `dashboard` as an alias. It opens with one widget.
- **Read mode (Jazz):** no outlines, with a widget's name as its heading and about 24 px between them. Its own width, from the sidebar's edge to the window's, not the reading column.
- **Edit and read modes, as Notion.** Edit from the header, which becomes Done, and Esc leaves too. Not kept across a reload. In edit mode: `+` on a row or at the bottom picks a database and view, widgets drag between rows, handles change widths and row heights, and a widget's menu has Duplicate and Remove.
- **In edit mode (Jazz):** a 1 px outline on each widget, with its handle and `⋯`, and **content goes inert**, so a drag can't start an edit. A line shows where a widget lands, with none on a full row. Widths snap to 1/4, 1/3, 1/2, 2/3 and 3/4, heights to 40 px from 160 to 800. **Each change saves as it happens with one Undo, there's no Cancel, and Done only ends the mode.**
- **A narrow window (Jazz):** a row wraps, in order, when a widget would go under about 280 px, as at 1000 wide or with the Comments pane open. That isn't stored.
- **Limits, as Notion:** 4 widgets to a row, 12 in all. At 12, "12 widgets at most" sits where `+` was, as filter rules do, as that's state rather than instruction (Jazz).
- **In read mode:** rows open, values edit and ticks work, as in any linked view. Each widget's chips still work.
- **Widget's filter chip in read mode:** Notion keeps these on this device unless saved for everybody. With one person, I'd save them as any linked view's filter saves. Simpler, and no "Save" button.

**At 390:** every widget is full width, one above another, left to right and then down; widths are ignored and heights follow content, up to about 360 px with Show more and no scrolling inside a widget (Jazz). Off-screen widgets hold their space until they load. Edit mode offers Move up, Move down, Duplicate and Remove in the menu, with no dragging, and after a move it scrolls to the widget and tints it. **Notion's page doesn't describe this, so it's my proposal.**

## 4. Filters across widgets

- **From the dashboard's header:** filter chips, with "Filter multiple sources" in Notion's words; I'd just call it the same Filter sheet. It lists properties by **name and type** across its widgets.
- **What a rule means across widgets (decided, Lead f9bab535, on Ratchet's question):** a rule applies where a property of the same name and type exists. **Options match by their names,** as two Status properties can both say Done with different ids. An option a widget doesn't have makes that rule unreadable there, and it counts neither way. A Relation pointing at a different database is unreadable in the same way (Ratchet's point, Lead 495829a7). **Beside a widget's name, as state and not instruction (Lead 495829a7):** "Not filtered" where no rule applies, and "Partly filtered" where some do, which opens the sheet to show which. Once saved, a rule stays on the property it was bound to, so a rename or delete can't move it to another.
- **It adds to a widget's own filter** with "and", as whole groups: an "any" group is never flattened, and the combination is never saved back into the widget (Ratchet).
- **Saved with the dashboard,** and restored when he returns.
- **"This page's day"** is available when a dashboard sits on a day page.
- **`+ New` inside a widget** follows §7.4 with both filters, and a dashboard's rule never overwrites a widget's contradictory one (Ratchet).

## 5. Cost

This is the most expensive thing a page could hold, so it has limits of its own:

- Widgets off-screen load when scrolled to.
- **On a day page or in his Day template,** R2-7's bar applies, and 12 widgets won't meet it. **Decided (Lead 4a1712e6), a budget limit, not a cut:** a dashboard is only a full page, as Notion's main case, and a day page shows it as a page link. A day page can already hold several linked views. If he wants one inline, that's a later ask.
- A row cap per widget as in any view.

## 6. For Roadbuster and Jazz

- **Storage:** a dashboard view holds rows of widgets, each with a width, height and linked-view settings. `layout: dashboard`. **An older build draws a table and keeps the fields (decided, Lead f9bab535), as the floor 9417eea2 can't do more,** so nothing says it's unsupported there. The rollback run includes widths, heights, widget filters and an older tab's unrelated edit (Ratchet).
- **Global filters across databases:** how to match a property by name and type at low cost.
- **Keys at 1280:** a widget is selected as a block is, and keys don't leak (R1-26).
- **Jazz:** drag handles and how edit mode looks at both widths.

## 7. Left out of this pass

Notion's Agent generating a first draft. We have a model for day drafts, but this isn't designed. It would be a new model cost, so it would come to the Lead first.

## 8. Release order, within Dashboard

Depends on Chart for its most useful widget. First: rows of widgets, edit mode, at both widths. Then: filters across widgets. All in scope.

## 9. Checks before release

- 12 widgets at 1280, and at 390 with 4× slowdown: measure and state it.
- A row edited in one widget updates others showing it.
- Removing a widget, or the whole dashboard, leaves every row, says so, and has Undo.
- A global filter leaves widgets without that property alone, and they show it. Two Status properties with different ids filter by name, and an option one lacks counts neither way there. "Not filtered" only where nothing applies, and "Partly filtered" where some rules do, opening the sheet.
- A widget's source deleted or in Trash doesn't break the others.
- A move in one tab and a filter edit in another both survive.
- An older tab keeps the dashboard, with a rollback run.
