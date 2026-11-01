# Notion database: the model

Research for Brian's request (Raft #daythread 4b92568d, 2026-11-01): "support something like Notion databases, both inline and full page; research Notion first, then design ours."

- Owner: Bumblebee (product). Companion files: Jazz on interactions, Roadbuster on fit with Daythread's storage.
- Scope: Notion's **general model**, deliberately not filtered by what fits Daythread today (Lead f298f099). Scope is decided in the design; usage only orders releases.
- Sources: Notion Help Center and Notion API reference, read 2026-11-01. Every claim below links to the page it came from. Where a source was silent, the text says so instead of guessing.

## 1. Summary in five lines

1. **A database is a container; the rows are ordinary pages.** Each row is a full page with a body, plus property values that follow the schema.
2. **Inline and full page are the same object, shown two ways.** One flag (`is_inline`) decides whether it renders inside its parent page or as its own page. Switching changes placement, not data.
3. **Three layers:** database (container, permissions, placement) → data source (schema + rows) → view (layout + filter + sort + group + visible properties). One database can hold several data sources; each view shows exactly one.
4. **A "linked view" is a view on someone else's data source.** It adds views, not a schema. Editing rows or properties through it edits the original; its views, filters, sorts and groups stay local.
5. **Behaviour comes from property types,** especially relation (links between rows), rollup (aggregate over linked rows), formula (computed), status (grouped workflow), plus templates and automations.

## 2. The objects

### 2.1 Database

A container that "contains one or more data sources" ([API: Database](https://developers.notion.com/reference/database)).

| Field | Meaning |
| --- | --- |
| `parent` | Where it lives, e.g. a page. |
| `is_inline` | `true` = rendered inside its parent page; `false` = shown as a child page (full page). |
| `data_sources[]` | The tables it holds (id + name). The schema is **not** on the database. |
| `title`, `description`, `icon`, `cover` | Presentation. |
| `in_trash`, `public_url` | State and publishing. |
| `database_type` | e.g. `tasks` for Notion's special Task database, `null` for a regular one. |

**Permissions live on the database, not the data source:** "Individual data sources don't have permissions settings" ([API: Database](https://developers.notion.com/reference/database)). A linked data source keeps the access level of its original database ([Help: Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases)).

### 2.2 Data source (the table)

"Data sources are the individual tables of data that live under a Notion database" ([API: Data source](https://developers.notion.com/reference/data-source)).

- Holds `properties`, the **schema**. "Page property values must conform to the property objects laid out in the parent data source object."
- Every database has at least one. A new database's data source is just the pages you create in it. You can add a second data source to the same database, or link an existing one from elsewhere ([Help](https://www.notion.com/help/data-sources-and-linked-databases)). The help example is contacts, companies and deals in one database ([Help: Intro](https://www.notion.com/help/intro-to-databases)).
- Schema limits: up to 500 properties, about 50 KB through the API ([API: Data source](https://developers.notion.com/reference/data-source)) and 1.5 MB for all property definitions in the app ([Help: Performance](https://www.notion.com/help/optimize-database-load-times-and-performance)).

This layer was split out of "database" in API version 2025-09-03. Before that, database = one table. The split exists so that one database block can hold or link several tables.

### 2.3 Row = page

"Databases in Notion are collections of pages … Each item is a full Notion page" ([Help: Intro](https://www.notion.com/help/intro-to-databases)).

- A row's `parent` is the data source. Its `properties` follow that data source's schema. An ordinary page (parent = page or workspace) has only `title` ([API: Page](https://developers.notion.com/reference/page)).
- **Properties and body are separate.** "Page content is available as blocks" and is read and written through the block endpoints, not `properties` ([API: Page](https://developers.notion.com/reference/page)).
- Dragging other content (bullets, to-dos) into a database turns each into a page ([Help: Intro](https://www.notion.com/help/intro-to-databases)).
- A row opens as **side peek, centre peek or full page**. Table, Board, List and Timeline default to side peek; Gallery and Calendar to centre peek ([Help: Views](https://www.notion.com/help/views-filters-and-sorts)).
- "Customize page layout" sets one layout for **all** pages in the database, which is a database-wide setting ([Help: Customize](https://www.notion.com/help/customize-your-database)). Its details (pinned properties, property panel) weren't on the pages I could reach.

### 2.4 View

"A view is scoped to a single data source within a database" ([API guide: Working with views](https://developers.notion.com/guides/data-apis/working-with-views)).

| Field | Meaning |
| --- | --- |
| `parent` | The database it belongs to (tab bar). |
| `data_source_id` | The one table it shows (`null` for a dashboard). |
| `type` | See §4. |
| `filter`, `sorts` | Same format as a query. |
| `configuration` | Per-type layout: group, sub-group, visible properties, date property, cover, etc. |
| `dashboard_view_id` | Set on widget views inside a dashboard. |

Source: [API: View](https://developers.notion.com/reference/view).

- A database must keep **at least one view**. A new database gets one Table view, "Default view" ([API guide](https://developers.notion.com/guides/data-apis/working-with-views)).
- Views appear as **tabs**, ordered (`start`, `end`, `after_view`).
- "Each database view has its own settings": layout, property visibility, filter, sort, group, sub-group ([Help: Views](https://www.notion.com/help/views-filters-and-sorts)).
- **Personal vs shared view edits:** filters and sorts you change are personal by default until "Save for everyone" ([Help: Views](https://www.notion.com/help/views-filters-and-sorts)). This only matters with more than one user.

### 2.5 Linked view ("linked database")

- A view on a page that "points to an existing data source … Unlike `POST /v1/databases`, it creates no new schema" ([API guide](https://developers.notion.com/guides/data-apis/working-with-views)).
- **Shared with the original:** the data source's title, properties and pages. **Local to the linked view:** "the views, filters, sorts, and groups you create and delete" ([Help: Data sources](https://www.notion.com/help/data-sources-and-linked-databases)).
- When you move a data source, views that don't move with it become linked views (same page).
- Forms can only be added to the original database (same page).
- Notion recommends linked views over many inline databases on one busy page, for performance ([Help: Performance](https://www.notion.com/help/optimize-database-load-times-and-performance)).

## 3. Inline vs full page

**Same object, shown two ways.** The API has one database type with `is_inline: true|false` ([API: Database](https://developers.notion.com/reference/database)). In a parent page's block tree, both appear as a `child_database` block holding only a title. Rows are not inline blocks of the parent ([API: Block](https://developers.notion.com/reference/block)).

| | Inline | Full page |
| --- | --- | --- |
| Where it sits | Inside another page, among its blocks | Its own page, listed in the sidebar |
| Controls | Appear on hover | Always shown |
| Create | `/database` on a page | New page → "Table" under "Get started with", or `/database` |
| Go to the other | ⤡ expands an inline database to full page (to view it) | — |

Sources: [Help: Intro](https://www.notion.com/help/intro-to-databases).

**Switching for real** (not just viewing expanded), per the same page:

- Full page → inline: drag the database into another page so it becomes a subpage, open that page, ⋮⋮ → **Turn into inline**.
- Inline → full page: ⋮⋮ and drag it into the sidebar as a top-level page.

Notes:
- "Full page" only adds title, icon, cover and description around the same views. The data, schema and views don't change when switching.
- A full-page database can be **locked** so others can enter data but not change views or properties ([Help: Customize](https://www.notion.com/help/customize-your-database)).
- **Performance:** "The more simultaneously viewed databases, the more stress on your setup." Notion advises one database per page first, then linked views to show them together ([Help: Performance](https://www.notion.com/help/optimize-database-load-times-and-performance)).

## 4. View types

| Type | What it shows | Key setting |
| --- | --- | --- |
| Table | Rows, one column per property (default) | Visible properties, freeze column, column calculations |
| Board | Cards grouped by a property (Kanban) | Group by select / status / person … |
| List | Minimal list of titles plus chosen properties | — |
| Calendar | Rows placed by a `Date` property | Date property |
| Timeline | Bars by date range, with dependencies | Date range, dependency arrows |
| Gallery | Cards with an image from Files or the page content | Card preview source |
| Chart | Bar, line or donut over rows | Axis/group property |
| Feed | Stacked cards like a blog, with comments and view counts | Visible properties |
| Map | Rows as pins | `map_by` a Place property |
| Form | Questions mapped to properties; each answer adds a row | Question ↔ property sync |
| Dashboard | Up to 12 widget views (4 per row), from one or several databases | Global filters (Business/Enterprise only) |

Sources: [Help: Views](https://www.notion.com/help/views-filters-and-sorts), [API: View](https://developers.notion.com/reference/view), [Help: Feeds](https://www.notion.com/help/feeds), [Help: Forms](https://www.notion.com/help/forms), [Help: Dashboards](https://www.notion.com/help/dashboards).

The core set has existed for years: table, board, list, calendar, timeline, gallery. Chart, feed, map, form and dashboard are recent additions, and some are plan-gated.

## 5. Property types

All from [API: Property object](https://developers.notion.com/reference/property-object) and [Help: Properties](https://www.notion.com/help/database-properties).

| Group | Types | Notes |
| --- | --- | --- |
| Identity | **Title** (exactly one per data source, id `title`), **ID** (`unique_id`, optional prefix like `TASK-12`, number set by Notion) | |
| Text-like | Text (rich text), URL, Email, Phone | |
| Choice | **Select** (one), **Multi-select** (many), **Status** (one; options in groups To-do / In progress / Complete) | Options have a stable id, a unique name (case-insensitive, no commas) and one of 10 colours. Sorting by select follows the option order you set. |
| Value | Number (format = display only, ~45 currencies, percent, commas), Checkbox, **Date** (date, date+time, or range) | |
| People & files | Person (users/groups), Files & media, Place (location) | |
| Linking | **Relation**, **Rollup** | §6 |
| Computed | **Formula** | §7 |
| Automatic (read-only) | Created time, Created by, Last edited time, Last edited by | |
| Actions | **Button** (runs actions on click) | Configured in-app only |
| Wiki only | Verification | |

Limits: up to 500 properties per database; 2.5 MB of property data per row, not counting files, formulas, rollups or body ([Help: Performance](https://www.notion.com/help/optimize-database-load-times-and-performance)).

## 6. Relations and rollups

From [Help: Relations & rollups](https://www.notion.com/help/relations-and-rollups) and [API: Property object](https://developers.notion.com/reference/property-object).

**Relation:** a property whose value is a list of pages in a target data source.
- **One-way by default.** "Show on [database]" makes it two-way: a mirrored property in the target, kept in sync both ways.
- **Self-relation:** a database can relate to itself. With one property it is effectively both directions. Sub-items and dependencies are built on this (below).
- **Limit:** "1 page" or "No limit".
- Shows chosen properties of the linked pages inline in the cell.
- CSV export gives URLs, which can't be re-imported as links. Duplicating a database turns two-way relations into one-way.

**Rollup:** aggregates one property across the related pages.
- Pick the relation, the target property, and a function. The API lists 24: show original / unique, count (all, values, unique, empty, not empty), percent empty / not empty, sum, average, median, min, max, range, earliest / latest date, date range, checked / unchecked, percent checked / unchecked, count / percent per group.
- No rollup of a rollup ("could create unintended loops"). Only numeric rollups can be sorted.

**Built on self-relations** ([Help: Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies)):
- **Sub-items:** parent/child rows in one database, shown nested (toggle) or flat. Filter parents only, both, or sub-items only. **Deleting a parent deletes its sub-items.**
- **Dependencies:** "blocked by / blocking" chains drawn as arrows in Timeline, with optional automatic date shifting.

## 7. Formulas

From [Help: Formulas](https://www.notion.com/help/formulas) and [API: Property object](https://developers.notion.com/reference/property-object).

- An expression over the row's own properties (`prop("Name")`), built-ins (`now()`) and functions. Values are read-only.
- Can **walk relations** with dot access, e.g. `Tasks.length()` or `Parent item.first()`. List functions include `length`, `first` and `every`.
- Output types seen: text, number, boolean, date, list. `style()` adds bold, colour and background.
- Function groups: date (`dateAdd`, `now`), logic (`if`, `and`, ternary), lists, text.
- The editor shows a live preview when opened from a row.
- The help page I read doesn't document the full function list (e.g. `let`, `map`, `filter`). The surface is large and keeps growing.

## 8. Filter, sort, group

From [Help: Views](https://www.notion.com/help/views-filters-and-sorts) and [API: Filter](https://developers.notion.com/reference/filter-data-source-entries).

- **Filter:** per-property conditions typed by the property, e.g. text `contains`, number `greater_than`, date `on_or_before`, relation `contains <page>`, select `equals`, status `group_equals` (beta). `is_empty` / `is_not_empty` are broadly available.
  - **Relative dates:** `today`, `yesterday`, `one_week_ago`, `this_week`, `past_week`, `next_month`, …
  - **Timestamps:** created / last edited.
  - **Formula** results are filtered by their type. **Rollup** lists are filtered with `any / every / none`.
  - **Advanced filters:** AND/OR groups nested up to three layers in the app ("two levels deep" via API).
- **Sort:** several sorts, applied in drag order, ascending or descending.
- **Group / sub-group:** group by a property, plus a second layer within each group. Groups can be hidden, sorted, and empty ones hidden.
- **Property visibility:** per view.
- **Column calculations:** per column at the bottom of a table, e.g. count, sum, percent checked. The Help "aggregate rollups" text refers to this.

## 9. Templates, automations, buttons

**Row templates** ([Help: Templates](https://www.notion.com/help/database-templates)):
- A template is a page inside the database that presets property values **and** body content ("any type of content, including images, embeds, and sub-pages"). It's chosen when you create a row.
- **Repeating templates** create a new row from a template daily, weekly, monthly or yearly, at a set time.
- Caution from Notion: don't prefill relations unless every new row should link to the same page.
- The page I read doesn't cover a default template per view or applying a template to an existing row.

**Automations** ([Help: Automations](https://www.notion.com/help/database-automations)):
- Triggers: page added, property edited, or every {frequency}.
- Actions: edit property, add or edit pages in another database, notify, Slack, webhook, Gmail, define variables.
- Paid plans only (except Slack notifications). Automations can't trigger other automations.

**Button property:** one click runs actions, which can trigger automations (same page).

## 10. Size and performance (as Notion states it)

From [Help: Performance](https://www.notion.com/help/optimize-database-load-times-and-performance) and [API guide: Query large data sources](https://developers.notion.com/guides/data-apis/query-large-data-sources).

- Up to 250,000 rows per database. One API query returns at most 10,000 results.
- Slow when: many rows, many visible properties, sorts or filters on title, text, formula or rollup, chained formulas over rollups, many inline databases on one page.
- Two-way relation display stops past 10,000 references from one database.

## 11. What this means for our design (questions, not scope)

This research doesn't pick scope. These are the decisions the design has to make, each tied to a part of the model:

1. **Container vs table:** Do we keep Notion's database → data source split, or one database = one table? The split only pays off for "several tables in one database" and linked views.
2. **Inline ↔ full page:** If we follow Notion's `is_inline` model, switching is a placement change with no data migration. Is that how we want it to behave?
3. **Row = page:** Every row has a body and opens as a page. Notion offers side peek, centre peek and full page; which do we want on laptop and on phone? (Jazz)
4. **Which views first:** The core six are table, board, list, calendar, timeline and gallery. The rest are newer and plan-gated.
5. **Which property types first:** Title, text, number, select, multi-select, status, date, checkbox, URL and relation carry most uses. Rollup and formula are the expensive ones.
6. **Linked views:** Showing the same rows on several pages (e.g. a filtered view on a day page) is the feature that ties a database to daily pages. In Notion it's a separate object (view-only, no schema).
7. **To-dos:** Today they're their own record that carries over. Notion's Task database is a regular database with a special type (`database_type: tasks`) plus status, sub-items and dependencies. Roadbuster is costing the options.
8. **Templates and repeating templates:** Daythread's Day template plus the 07:00Z page creation is already a "repeating template". Whether day pages relate to a database at all is a design question.

## Sources

- API: [Database](https://developers.notion.com/reference/database) · [Data source](https://developers.notion.com/reference/data-source) · [Page](https://developers.notion.com/reference/page) · [Block](https://developers.notion.com/reference/block) · [Property object](https://developers.notion.com/reference/property-object) · [View](https://developers.notion.com/reference/view) · [Working with views](https://developers.notion.com/guides/data-apis/working-with-views) · [Filter](https://developers.notion.com/reference/filter-data-source-entries) · [Query large data sources](https://developers.notion.com/guides/data-apis/query-large-data-sources)
- Help: [Intro to databases](https://www.notion.com/help/intro-to-databases) · [Properties](https://www.notion.com/help/database-properties) · [Views, filters & sorts](https://www.notion.com/help/views-filters-and-sorts) · [Relations & rollups](https://www.notion.com/help/relations-and-rollups) · [Formulas](https://www.notion.com/help/formulas) · [Templates](https://www.notion.com/help/database-templates) · [Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases) · [Customize your database](https://www.notion.com/help/customize-your-database) · [Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies) · [Automations](https://www.notion.com/help/database-automations) · [Forms](https://www.notion.com/help/forms) · [Feeds](https://www.notion.com/help/feeds) · [Dashboards](https://www.notion.com/help/dashboards) · [Performance](https://www.notion.com/help/optimize-database-load-times-and-performance)
