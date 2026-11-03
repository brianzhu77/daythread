# Dashboard: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **design for Lead and Jazz to review**. Not approved and not built.
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

## 3. Making and arranging

- **Made from** Pages' `+` → Database with a Dashboard layout, or `+ Add view` → Dashboard on an existing database, as Notion. `/` stays one Database item, with `dashboard` as an alias. It opens with one widget.
- **Edit and read modes, as Notion.** Edit from the header. In edit mode: `+` on a row or at the bottom picks a database and view, widgets drag between rows, handles change widths and row heights, and a widget's menu has Duplicate and Remove.
- **Limits, as Notion:** 4 widgets to a row, 12 in all. `+` goes away at 12, with no line explaining it.
- **In read mode:** rows open, values edit and ticks work, as in any linked view. Each widget's chips still work.
- **Widget's filter chip in read mode:** Notion keeps these on this device unless saved for everybody. With one person, I'd save them as any linked view's filter saves. Simpler, and no "Save" button.

**At 390:** every widget is full width, one above another, in order; widths are ignored and heights follow content, up to a cap with Show more. Edit mode offers Move up, Move down and Remove in the menu, with no dragging. **Notion's page doesn't describe this, so it's my proposal.**

## 4. Filters across widgets

- **From the dashboard's header:** filter chips, with "Filter multiple sources" in Notion's words; I'd just call it the same Filter sheet. It lists properties by **name and type** across its widgets.
- **A filter applies to widgets having that property,** as Notion. The others stay as they are, with a quiet "Not filtered" beside their name, so he can tell. That line is state, not instruction.
- **It adds to a widget's own filter** with "and". The widget's rule isn't changed.
- **Saved with the dashboard,** and restored when he returns.
- **"This page's day"** is available when a dashboard sits on a day page.
- **`+ New` inside a widget** follows §7.4 with both filters.

## 5. Cost

This is the most expensive thing a page could hold, so it has limits of its own:

- Widgets off-screen load when scrolled to.
- **On a day page or in his Day template,** R2-7's bar applies, and 12 widgets won't meet it. **My proposal:** a dashboard is only a full page, as Notion's main case, and a day page shows it as a page link. A day page can already hold several linked views. If he wants one inline, that's a later ask.
- A row cap per widget as in any view.

## 6. For Roadbuster and Jazz

- **Storage:** a dashboard view holds rows of widgets, each with a width, height and linked-view settings. `layout: dashboard`. An older tab shouldn't lose them, though it can't draw them; it should say so rather than show an unrelated table. Please say what the floor needs.
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
- A global filter leaves widgets without that property alone, and they show it.
- A widget's source deleted or in Trash doesn't break the others.
- An older tab keeps the dashboard, with a rollback run.
