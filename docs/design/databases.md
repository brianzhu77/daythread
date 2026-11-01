# Databases: design

- Author: Jazz (Design) · 2026-11-01 · status: **design for Lead review**. Not approved and not built. Base: main d0861c3f.
- Inputs:
  - Brian 4b92568d: "Notion-like databases, inline and full page. Research Notion first, then design ours."
  - Lead f298f099 (the research split) and the Lead's 19:16Z frame:
    - Roadbuster's mapping, without Notion's data-source layer;
    - the database page stores the id of its **home block**;
    - linked views are part of the model;
    - the phone follows our own sheets;
    - one `/` Database item;
    - the to-dos option is the only question for Brian.
  - Research:
    - `notion-database-model.md` (Bumblebee, c09a4810);
    - `database-fit.md` (Roadbuster, 520e36d3);
    - `notion-database-interactions.md` (Jazz, 06a3d6e9), including Craft's Collections on iPhone (§10b).
- **Data model:** Roadbuster owns it, in `docs/design/databases-model.md` (a2b6eaaf), with the Lead's notes 7b3b9664.
  This doc says what he sees and does, and names the model's rules only where the behaviour depends on them.
- **Rule (Brian 57deaed7):** the design covers every case. Usage only sets the release order (§14).
- Look: black, white and grey (Brian 116a40ab), existing tokens only, 44 px targets on the phone.

## 1. The idea in one paragraph

A database is **a page that holds a table of pages**. Each row is a page with its own body. Its properties (status,
date, rating…) sit at the top of that row page. A database can show **inside another page** (inline) or **as its own
page** (full page). Both are the same database, and switching only changes where it shows. Any other page can show it
again with its own filter. That's a **linked view**: same rows, different view. A linked view on a day page is where a
database meets Daythread's days.

## 2. Words

| Thing | Word on screen | Why |
| --- | --- | --- |
| The object | **Database** | Brian's word, and Notion's. |
| A line in it | **row** (in menus: "New", "Delete row") | Short. A row also *is* a page, and opening it says so. |
| A column | **property** | Notion's word, which Brian knows. Craft says "field". |
| A saved way of showing it | **view** ("Table", "Board", …) | Same in Notion and Craft. |
| Another page showing the same rows | **linked view** | Only where it matters: the source line (§9) and Trash. |

## 3. Making one

### 3.1 `/` Database

- **One `/` item: Database** (icon: a small grid). Aliases: `database`, `table`, `db`, `数据库`, `表格`. It sits after
  `Page` and `Link to page` in Suggested.
- **Choosing it opens a short picker** at the same place (a popover on desktop, the `/` list on the phone):
  ```
  New database                  ↵
  ─────────────────────────────
  Show an existing one
    Reading list      in Books
    To-dos            built in        (only once the To-dos source ships, §11)
  ```
  Enter takes **New database**. Typing filters the existing ones. Picking one inserts a **linked view** of it (§9).
  Until linked views ship, the picker is skipped and `/` Database creates a new one straight away.
- **A new database, inline:** the line becomes a database block with:
  - title placeholder **"Untitled database"**, with the caret in it;
  - one view, **Table**;
  - one property, **Name**;
  - no rows, and the line **+ New** under the header row.

  Enter in the title moves the caret to a new first row's Name cell. Esc leaves the block selected (§10).
- **`/` Database always makes an inline database.** There's no hidden condition (Lead ac1ed435).
- **A full-page database is made where pages are made.** The `+` on Pages (and the desktop sidebar's `+`) opens a
  two-line menu: **Page** (first, and Enter takes it) and **Database**. Database makes a database page at that level
  and opens it, with the caret in its title. This is one entry point, with no condition and no notice. It costs one
  extra tap on every new page, which is acceptable at his rate of about one new page a day (13 documents in about two
  weeks). It answers the case he's most likely to try first, a standalone "Reading list" (Bumblebee 7d888f86).
- **Where it's not offered:** inside a synced block, and inside a draft band.
- **In a template:** the database is made there, and the template is its home. Each new page made from the template
  gets a **linked view** of it, never a fresh database (Roadbuster's model). No explanatory line. This comes with
  linked views (§9.4).

### 3.2 Inline ↔ full page

- **Open as page** (`⤢` in the database's `⋯` menu, and a click on the title) opens the database page full page. The
  inline block stays where it was. Back returns to the host page at the same scroll.
- **Turn into page** (`⋯`): the inline table is replaced, in place, by a **page card**: our existing `pageLink` block,
  showing the title and "Database · 12 rows". It's the same as a subpage made with `/` Page. One Undo.
- **Turn into inline** (on that card's `⋯`): the card becomes the table again. One Undo.
- **Turn into page and Turn into inline switch between the two.** They don't create anything. A database made from
  Pages' `+` has no host page, so its `⋯` doesn't show Turn into inline. To show it inside a page, he inserts a linked
  view.

## 4. How a database looks

### 4.1 Inline, 1280 (inside the 700 px text column)

```
Reading list                                                  Table ⌄    ⋯
Status is Reading  ×    Added ↓  ×                                     ← only when the view filters or sorts
──────────────────────────────────────────────────────────────────────────
Name                         Status         Author            Added       +
──────────────────────────────────────────────────────────────────────────
Thinking in Systems          ◐ Reading      D. Meadows        Oct 12
The Making of a Manager      ○ To read      J. Zhuo           Oct 28
Untitled                                                                    ← placeholder colour
+ New
```

- **Header line:**
  - the **title** in `--text-section` (19/600), the same as a day-page section heading, so it reads as part of the
    page;
  - **`Table ⌄`**, the current view, in `--ink-2`;
  - **`⋯`** for everything else (§8).

  These are always shown, never only on hover, and the same at both widths. **No blue "New" button.** `+ New` under
  the last row is the one way to add a row, and it can't be missed.
- **Filter line:** shown only when the view filters or sorts. Each rule is a `--tag-bg` chip. Tapping a chip edits
  that rule, and `×` removes it. This is the answer to "where did my row go?", since a hidden filter is the most
  confusing state a database has.
- **Rows:**
  - `--text-row` (16/24), 36 px tall at 1280;
  - hairline `--line` between rows, no vertical lines, no zebra stripes;
  - the header row in `--text-meta`, `--ink-3`, with a small type icon before each name.
- **Too wide:** the table scrolls sideways **inside the block**, with a soft fade at the clipped edge. **Name stays
  pinned** on the left. Column widths can be dragged at 1280. Default widths: Name 240, text 180, date 110, number 90,
  checkbox 60, select 140.
- **Long tables:** inline shows **the first 25 rows**, then **"Show 25 more · Open as page"**. A full page shows 100
  at a time with the same line. This keeps a day page fast on the phone, where every row is rendered inside the
  editor.
- **Cell text** stays on one line with an ellipsis. The full value is on the row page. (Wrap per property: later, §14.)

### 4.2 Inline, 390

```
Reading list                       Table ⌄   ⋯
───────────────────────────────────────────────
Name                    Status        Author ›
───────────────────────────────────────────────
Thinking in Systems     ◐ Reading     D. Mea…
The Making of a Ma…     ○ To read     J. Zhuo
+ New
```

- **The same block and the same controls.** Rows are 44 px. Name is pinned at 150 px, and the other columns scroll
  sideways. The `›` in the header is a hint that more columns exist, and it fades once he scrolls.
- **Nothing is edited inside the table on the phone** (Craft does the same, §10b of the research):
  - **tap a Name** to open the row (§5);
  - **tap any other cell** to open **that property's sheet** (§6), so a status changes without leaving the page.

  The keyboard only comes up inside a sheet that has a text field. That keeps IME composition and focus out of the
  editor's contenteditable, which is Roadbuster's biggest risk.
- `+ New` makes a row and opens it (§5) with the caret in its title, so the keyboard comes up once, where he types.

### 4.3 Full page

- **The same block, wider:**
  - the page title is the database title, in `--text-large-title`, the same as any page;
  - `Table ⌄` and `⋯` sit under it, on the left at both widths;
  - then the filter line and the table.

  At 1280 the table may use the full content width (up to 1100 px), not just the 700 px text column, because that's
  why he opened it full page.
- **The breadcrumb** reads `Books › Reading list` (or just `Reading list` at the root), the same as the page header
  today.
- **No body above the table** (Roadbuster's Q1). A description can go in a later release. Notion doesn't have one
  either, and an empty body area invites confusion over where to type.

### 4.4 In lists elsewhere

- **Sidebar tree, Pages, Subpages, and the Move dialog** show the **database** like any page, with the grid icon.
  They **never show its rows** (Roadbuster's marker).
- **Search and `[[`:**
  - a row shows as **"Thinking in Systems · Reading list"** (the database name in `--ink-3`);
  - a database shows with its icon and "Database · 12 rows";
  - rows are found by title and by text values.
- **Linked from** on a row page works as it does for any page.

## 5. Opening a row

- **One rule at both widths: a row opens as a full page.** On desktop that means a click on Name, or **Open**, which
  shows on hover and when the Name cell is selected by keyboard. On the phone it's a tap on Name.
  - It reuses the page editor exactly, with no new surface.
  - Notion's phone and Craft's phone both do this.
  - Notion's desktop side peek is the one thing given up. It's parked (§14) until real use shows him editing many rows
    in a row.
- **Back** returns to the host page at the same scroll, and the row he opened is tinted with `--blue-soft` for 1 s, so
  he sees where he was. Browser Back, the header `‹`, and ⌘[ all do this.
- **The row page:**
  ```
  Books › Reading list › Thinking in Systems                          ⋯
  Thinking in Systems
  ◎ Status       ◐ Reading
  ▦ Author       D. Meadows
  ◷ Added        Oct 12
  ★ Rating       Empty                ← --placeholder
  + Add property
  ─────────────────────────────────────────
  (the row's body: an ordinary page editor, with tasks, links, and so on)
  ```
  - **The property list** is `--text-ui` rows, 36 px at 1280 and 44 px at 390. Each has the type icon and name in
    `--ink-2`, then the value.
  - **Empty values** read "Empty" in `--placeholder`. When **more than 4** are empty, they fold into one row, **"5 empty
    properties ›"**, so a sparse row doesn't open as a wall of "Empty".
  - **Tapping a value** opens the same editor as in the table: a popover on desktop, a sheet on the phone (§6).
  - **The body** is an ordinary page. Everything works there as it does in any page, including tasks, which carry over
    like any task.
- **The `⋯` menu on a row page:** Copy link, Duplicate row, Delete row. There's **no Move to…**: a row can't leave its
  database (§12).

## 6. Properties

### 6.1 Types: how each shows and how it's edited

Editor = a popover under the cell at 1280, or a bottom sheet at 390. Both have the same content and the same order.

| Type | In the cell | Editor | Empty / bad input |
| --- | --- | --- | --- |
| **Text** | one line, ellipsis | 1280: edits in the cell, multi-line with Shift-Enter. 390: a sheet with a text field. | empty |
| **Number** | right-aligned, the format chosen on the property (plain, 1,000, %, currency) | the same as text, with a numeric keyboard on the phone | **Non-numbers aren't accepted.** The field says "Numbers only" under it, and Esc puts back the old value. |
| **Select** | a grey `--tag-bg` chip | a list of options, plus a search field at the top. Typing a new name shows **Create "x"**. One tap picks an option and closes. | — |
| **Multi-select** | chips, then "+2" | the same list with checkmarks. It stays open, and Done closes it. | — |
| **Status** | a dot `○ ◐ ●` and the name | the same as Select, grouped **To do / In progress / Done**. The dot comes from the group, never from a colour. | always has a value (the first To-do option) |
| **Date** | `Oct 12`, or `Oct 12 → Oct 20` | **our existing date picker** (the `@` date picker). It gets an **End date** toggle and an **Include time** toggle. | Clear |
| **Checkbox** | **a plain square, not the task tick**: 16 px, `--radius-tight`, a 1.5 px `--check` border, and when ticked an `--ink` check mark with no blue fill. It ticks in place at both widths, and the tick doesn't move the caret or raise the keyboard (the B72 rule). | none | — |
| **URL / Email / Phone** | the text, as a link | like Text. A tap on the link opens it, and the pencil next to it edits. | The value is kept as typed, and a non-link stays plain text. Nothing is refused. |
| **Files** | the file name, or "2 files" | a list with Add, Remove, and Open | — |
| **Relation** | titles of linked rows as page refs (`▢ Title`, our `[[` look) | the `[[`-style pick list, limited to the target database's rows, with checkmarks. The top line is "New row in Books…". | — |
| **Rollup** | the computed value | none (read-only). The property menu sets relation → property → function. | "—" when nothing is linked |
| **Formula** | the computed value | none (read-only). The property menu has an expression field with a live preview of the current row. | an error shows as "Error" in `--red` in the cell, with the message in the property menu |
| **Created time / Edited time** | `Oct 12, 9:14` | none | — |
| **ID** | `12`, or `BK-12` with a prefix | none | — |

- **Not offered:** **Person, Created by, Edited by** (a workspace is one person, the same reason the Lead dropped
  Q5). **Button** and **Place** are in the "Later" row (§14).
- **Why the checkbox isn't the task tick:** in Daythread, the blue task tick means "a to-do that carries over and
  shows in Tasks". An "Owned" box on a Reading list must not look like a promise to carry over, especially once real
  to-dos sit in database tables (R2, §11), where they keep the real task tick (Bumblebee 3b04290d).
- **No colour** on select, multi-select or status options. The page stays black, white and grey. Status reads from
  its dot. If Brian later wants colour, it's a per-option setting that defaults to grey, and nothing else changes.

### 6.2 Adding and changing properties

- **Add:**
  - `+` at the end of the header row (1280);
  - **+ Add property** on a row page (both widths);
  - **Properties** in `⋯` (both widths).

  Each opens one small form: a name field (focused), then the list of types. Enter creates a Text property. Picking a
  type creates one of that type.
- **Edit:** at 1280, click a header. At both widths, tap a property name on a row page, or use `⋯ → Properties →` the
  property. The menu holds:
  - **Name**;
  - **Type** ›;
  - type-specific settings (options, number format, date format, relation target, formula);
  - **Hide in this view**;
  - **Duplicate**;
  - **Delete**.
- **Delete:** acts at once, with **"Rating deleted · Undo"**. There's no confirm dialog. The values come back with
  Undo.
- **Changing the type converts the values it can, then tells him how many it couldn't.** For example, **"Changed to
  Number · 3 values aren't numbers and show as empty · Undo"**. There's no question in advance. (Craft asks first;
  our pattern is act-then-Undo, as with deleting.) The rows keep their raw values (Roadbuster's model), so changing
  the type back brings them back too, even after Undo is gone.
- **Options** (select, status): add one with Create "x" in the editor, or in the property menu. Rename, reorder (drag
  `⋮⋮`) and delete them in the property menu. Deleting an option clears it from every row, with **"Option “Paused”
  removed from 4 rows · Undo"**.
- **Name** can't be deleted, hidden or retyped. It can be renamed and moved.

### 6.3 Cells and editors: build spec (R1)

Added 2026-11-01 for R1 (task #260). Jazz builds the editors and Roadbuster wires them into the cells (Roadbuster
03d86c21). Each type gets one editor component, `{ property, value, onCommit(raw | undefined), onCancel() }`, where
`value` is what `readValue` returns, `undefined` means clear, and `onCreateOption(name) → optionId` creates an option.
The per-cell check, Undo and the save states (§13) stay with Roadbuster. This section covers the 8 R1 types only.

#### 6.3.1 One shell for every editor

- **Which one:** the **popover** when the window is ≥ 900 px wide and the **sheet** below that. That's the same
  breakpoint as the editor's compact layout. The content and order are the same in both.
- **Popover (≥ 900):**
  - It's the `.app-menu` surface: `--paper`, a 1 px `--line` border, `--radius-block`, `--shadow-float`, and 6 px
    padding.
  - It opens under the cell, with its left edge on the cell's left edge. It flips above the cell when there's less
    than 280 px below. Its width is the cell's width, between 240 and 320 px (Text: up to 360).
  - Rows are 36 px. The hover and keyboard highlight is `--fill`, the same as the Move dialog's rows.
  - It closes on Esc, on a click outside, and after a single pick. Focus then goes back to the cell, with the cell
    cursor on it.
- **Sheet (< 900):**
  - It's our existing sheet, the same as the Move dialog's phone sheet: `Modal` at the bottom, the handle,
    `--radius-sheet`, at most 85vh tall, and the safe-area padding.
  - **Header:** the type icon and the property name on the left, in `--text-body` 600. The row's title sits under it
    in `--text-meta` `--ink-3` ("Status · Thinking in Systems"), because the sheet covers the table. **Done** is on the
    right, as `.app-link`.
  - Rows are 44 px.
  - It closes with Done or a tap on the scrim. **Both keep what he did.** (A swipe down would too, but our sheets
    don't swipe today, the Move dialog included. That's a change for every sheet, not just these.) A sheet never throws
    away an edit. To go back, he picks the old value again. A text field still being composed (IME) is committed
    first.
  - **The keyboard comes up only when he taps a text field,** with one exception: Text, Number and URL focus their
    field on open, because typing is the only thing those sheets do. Select, Multi-select, Status and Date open with
    the keyboard down, so changing a status is one tap with no keyboard. (Select with no options yet is the other
    exception, below.)
  - With the keyboard up, the sheet stays above it, as the Move dialog's search field does now. I'll check this
    natively on every type.
- **What isn't a sheet or popover:** Checkbox ticks in place (6.3.8). On the phone, Name opens the row (§5).
- **Keys inside any editor never reach the page editor** (§10). Enter during IME composition only commits the
  composition. It never saves or picks.
- **Value edits get no notice.** The cell shows the result, and ⌘Z undoes it at 1280 (§10). Creating an option
  gets no notice either.
- **The one exception: Text and URL on the phone** (Bumblebee 94ba9595, Lead f1e56ab4). The phone has no ⌘Z, and an
  old Select, Status, Date or Checkbox value is one tap away, but a long Text or URL value isn't. So **below 900 px,
  any Text or URL commit that changes the value** shows our usual Undo notice, **"Notes changed · Undo"**, with the
  property's name. Undo puts back the whole old value. There's no threshold and no second wording. At 900 px and up
  there's no notice, since ⌘Z covers it.

#### 6.3.2 The cell

- **Size:** 36 px rows at ≥ 900 and 44 px below, with 8 px side padding, `--text-row` (16/24), and one line with an
  ellipsis. A newline inside a Text value shows as a space.
- **An empty cell is blank** in the table. ("Empty" in `--placeholder` is only on the row page, §5.)
- **Hover (≥ 900, `@media (hover: hover)`):** `--hover-dim` on the cell.
- **Cell cursor (keys, ≥ 900):** a 2 px `--blue` outline inset by 1 px, with `--radius-tight`. Only one cell has it.
- **Press (phone):** `--fill` while the finger is down. The tap area is the whole cell and stays inside it (our
  hit-area lesson).
- **Name:** on hover or with the cursor on it, an **Open** chip shows at its right end: `--text-caption`, `--ink-2` on
  `--fill-soft`, `--radius-badge`, 22 px tall. A click on Name, or on Open, opens the row (§5). **Enter** with the
  cursor on Name renames it in the cell, the same as the in-cell Text editor below. Typing a character replaces it.
- **Being saved, failed, or changed elsewhere:** the cell follows §13 (a failed value stays shown, in `--warn`).
- **A database page in Trash** is read-only, like any page in Trash: cells don't open editors and checkboxes don't
  tick. Name still opens the row.

#### 6.3.3 Text

- **Cell:** the text, on one line.
- **≥ 900, edited in the cell:** Enter (or a typed character, or a double-click) turns the cell into a field. The field
  lies over the cell and the rows below it. It's at least as wide as the cell and at most 360 px, on `--paper` with
  `--shadow-float` and the 2 px `--blue` outline. It grows downward as lines are added.
  - **Enter** saves and keeps the cursor on the cell. **Shift-Enter** adds a line.
  - **Esc** saves as well. Losing text by pressing Esc is worse than one ⌘Z.
  - A blur saves. So does the page being hidden (a tab closed, the app sent away), so typing is never lost. That
    replaces the 1 s idle save in §10: saving while he's still typing would make one Undo step per pause.
  - **Tab / Shift-Tab** save and move the cursor along the row.
- **Phone sheet:** one field, focused on open, 3 lines tall and growing to 8. The return key reads **Done**
  (`enterkeyhint="done"`) and saves. A new line on the phone only comes from pasting; a value that already has lines
  keeps them.
- **Empty:** clearing the field and saving stores empty (`undefined`).
- **Too long** (over 10,000 characters, which the model refuses; Bumblebee 7e2a2c77): like Number, the field stays
  open with **"Too long · 10,000 characters max"** under it in `--text-meta` `--red`, so his text is still there to
  cut down or move into the row's body. Enter, Done and the scrim don't close it. Esc at 1280 puts back the old
  value. The same applies to URL.

#### 6.3.4 Number

- **Cell:** right-aligned with `font-variant-numeric: tabular-nums`, in the property's format (plain, 1,000, %, or
  currency).
- **Editor:** the same field as Text, on one line, showing the **plain number** (`1234.5`), not the formatted one. The
  phone sheet uses `inputmode="decimal"`.
- **iOS's decimal keypad has no minus sign.** So the phone sheet has a **±** button (44 px, `--fill-soft`) to the right
  of the field. It flips the sign.
- **Read as a number:** spaces and grouping commas are removed, one `.` is the decimal point, a trailing `%` is allowed
  when the format is percent, and the currency symbol is allowed when the format is currency. Full-width digits (１２)
  are read as digits.
- **Not a number:** "Numbers only" shows under the field in `--text-meta` `--red`. Enter doesn't save, and the field
  stays open. **Esc, Done, the scrim and a blur put back the old value.** A number can't be stored as typed, and it's
  short to type again.
- **Empty** saves as empty, not 0.

#### 6.3.5 Select

- **Cell:** one chip, `--tag-bg` and `--tag-ink`, `--text-small` (14), 22 px tall, 6 px side padding,
  `--radius-badge`, with an ellipsis inside the cell.
- **Editor, top to bottom:**
  1. **A search field.** It's focused on open at ≥ 900. On the phone it isn't, so the keyboard stays down, **except
     when the property has no options yet**, where typing is the only thing to do.
  2. **The options**, in their set order, each as its chip. The current one has the `.checked` ✓. The list scrolls
     inside after 8 rows.
  3. **Clear**, in `--ink-2`, only when there's a value.
- **Typing** filters the options (case-insensitive, by substring). When nothing matches exactly, the last row is
  **Create “Paused”**. A name that matches an existing option ignoring case picks that option and doesn't create a
  second one. Names are trimmed. An empty name can't be created.
- **Keys (≥ 900):** ↑↓ move the highlight, which starts on the first match, or on Create when nothing matches. Enter
  picks.
- **A pick closes the editor**, both popover and sheet. Create also picks the new option and closes.
- **No options and no typing:** the list area reads "No options yet" in `--ink-3`. The field's placeholder reads
  "Type to create an option".
- Renaming, reordering and deleting options isn't in the picker. It's in the property menu (§6.2).

#### 6.3.6 Multi-select

- **Cell:** the chips in the order he picked them, with a 4 px gap. When they don't fit, the last visible chip is
  followed by **+2** in `--ink-3`.
- **Editor:** the same as Select, with two differences.
  - **Picked options sit at the top as chips** inside the field area, each with a `×`. The list below shows a ✓ on
    each picked option, and a tap toggles it.
  - **It stays open.** It closes with Esc or a click outside at ≥ 900, and with Done, the scrim or a swipe on the
    phone.
- **Backspace** in an empty field removes the last chip (≥ 900).
- **Create “x”** adds and picks the option, clears the field, and stays open.
- No Clear row: removing every chip clears it.

#### 6.3.7 Status

- **Cell:** the dot and the name, with no chip: `○` To do, `◐` In progress, `●` Done, in `--ink-2`, then the name in
  `--ink`.
- **Editor:** the same as Select, with the options under three group headings (the `.menu-title` style): **To do · In
  progress · Done**. Each option has its dot.
- **No Clear row.** Status always has a value (the model's `readValue` default).
- **Create “x”** puts the new option at the end of **To do**. The property menu moves it to another group.
- A pick closes the editor.

#### 6.3.8 Checkbox

- **Cell:** the plain square from §6.1, centred in the column. A tap or click anywhere in the cell ticks it, and so
  does **Space** with the cell cursor on it.
- **No editor, no keyboard, no caret move**, and the scroll doesn't change (the B72 rule). With the keyboard already
  up in the page, a tick leaves it and the caret where they were (Jazz on #56).
- **Row page:** the same square in the value spot. A tap on the square or the value area ticks it.

#### 6.3.9 Date

- **Cell:** `Oct 12`, or `Oct 12, 2025` in another year, or `Oct 12 → Oct 20` for a range. With a time it's
  `Oct 12, 9:14`, in the `@` chips' time style (`Oct 12, 3 PM`). There are no relative words in the table, so a column scans
  the same way every day.
- **Editor, top to bottom:**
  1. **A field, "Type a date"**, read with the same reader as `@` (`readDate`): `tomorrow`, `fri`, `nov 20`, `明天`,
     `周五`, `3pm`. While it can be read, a line under it shows what it will save ("Fri, Nov 20, 15:00"). Enter
     saves. Something that can't be read shows "Not a date" in `--text-meta` `--ink-3` and saves nothing. The field
     is focused on open at ≥ 900 and not on the phone.
  2. **Quick days:** Today, Tomorrow, then two more days, with the same labels as the empty `@` list
     (`relativeDay`). A tap saves and closes.
  3. **Pick on calendar…** opens our own month calendar inside the editor, the same one as the day title's picker.
     (Built that way instead of the system picker, which can't be opened reliably from a sheet.)
  4. **End date** and **Include time**, as switches. End date adds a second field, "End", with its own Pick on
     calendar…. Include time adds a time to each date (native `type="time"`).
  5. **Clear**, in `--ink-2`, only when there's a value.
- A date typed with a time turns Include time on by itself.
- **An end before the start:** the two are swapped quietly when saved.
- A pick from the quick days or the calendar saves and closes, unless End date is on. Then it stays open so he can
  set the end.
- Dates are local dates, and a time is the local wall-clock time, the same as `@` date chips. Roadbuster to confirm
  that the model stores it the same way.

#### 6.3.10 URL

- **Cell:** the text without `https://` or `www.` (`example.com/path`), in `--blue-text`, with an ellipsis. A value
  that isn't a link (no dot, or spaces) shows plain, in `--ink`.
- **≥ 900:** a click on the link opens it in a new tab. A **pencil** (✎, `--ink-3`) shows at the right end on hover or
  with the cursor on the cell, and a click on it, or Enter, edits in the cell like Text.
- **Phone sheet:** a tap on the cell **opens the sheet, never the link.** That keeps a slip of the finger from leaving
  the app. The sheet has the field (focused, `type="url"`, no autocapitalise or autocorrect) and under it
  **Open link ↗**, only when the value is a link. This refines §6.1 for 390.
- **The value is kept exactly as typed.** Opening adds `https://` when there's no scheme.

#### 6.3.11 While an editor is open

- **The row is deleted elsewhere:** the editor closes, and the notice says "This row was deleted · Restore", the same
  as our page-in-Trash state.
- **The property is deleted elsewhere:** the editor closes with "Rating was deleted".
- **An option is removed elsewhere:** it leaves the list at once. If it was the value, the value goes too.
- **The same value changes elsewhere:** the editor keeps what he's doing. His commit then follows §13 ("…changed elsewhere ·
  yours was 4 · Use mine").
- **Offline:** every editor works. A commit that fails follows §13: his value stays shown in `--warn`, with "1 change
  not saved · Retry".
- **The window crosses 900 px** (a rotation or a resize): the editor closes, keeping what was typed, and the cursor
  stays on the cell.

#### 6.3.12 Copy and Duplicate in R1 (before linked views)

Linked views come in R2, so in R1 (Bumblebee 120fdcd6):

- **Copy, then paste**, of a database block pastes **a page card to that database**: our existing card, with the grid
  icon. It's a real link, and it never makes a second database.
- **Cut, then paste** moves the block, as in §9.1.
- **Duplicate isn't in a database block's menu** in R1. It comes back in R2 as "make a linked view".

#### 6.3.13 Accessibility

- The table is a `grid`: cells are `gridcell`s, and the header cells are `columnheader`s. A cell's label reads
  "Status, Reading, Thinking in Systems".
- A popover is a `dialog` holding a `listbox` (Select, Multi-select, Status) or a form (Text, Number, Date, URL). A
  sheet traps focus, as the Move dialog does.
- A checkbox cell is a `checkbox` with `aria-checked`.

## 7. Views

### 7.1 Switching and adding

- **`Table ⌄`** (both widths, the same pattern as Craft) opens a small list:
  - every view, with the current one ticked, and a `⋯` on each (Rename, Duplicate, Delete);
  - **+ Add view** at the bottom: pick a type, and it's named after the type ("Board"), with the name selected so he
    can rename it.

  The last view can't be deleted. Its Delete is absent, not disabled.
- **Each view keeps its own:** type, filter, sort, group, visible properties and their order, and column widths.
  These belong to the view, so a linked view's settings belong to its block (§9). Changing them is an edit, and it
  saves.
- **Which view a block is showing is not an edit.** It's remembered on this device only, per block, and never takes
  the Undo slot or saves the page (Lead 7b3b9664). A block shows its first view on a device that hasn't picked one.

### 7.2 Each type

| View | 1280 | 390 | Adding | Dragging |
| --- | --- | --- | --- | --- |
| **Table** | §4.1 | §4.2 | `+ New` under the rows (or under each group) | rows by `⋮⋮` on hover, only when the view isn't sorted. Columns by their header. |
| **Board** | columns of cards, 260 px each, grouped by a Select, Status or Checkbox property (asked when the view is made) | one column at a time, 300 px, swiped sideways with snap. A column header reads "◐ Reading · 3". | `+ New` at the foot of each column, which sets that column's value | a card to another column changes its value, at both widths (long-press on the phone) |
| **List** | one line per row: title, then up to 3 properties in `--ink-3` on the right | title, with properties under it in `--text-meta` | `+ New` | like a table |
| **Calendar** | **our Calendar screen's month grid**, with row titles on their date (up to 3 per day, then "+2") | our phone calendar: the month with dots, and the chosen day's rows listed under it | `+` on a day (1280 hover, or the day list at 390) sets the date | a row to another day changes the date (1280 only) |
| **Gallery** | cards, 3 across: the first image in the body (or a Files property) and the title | 2 across | `+ New` card | no |
| **Timeline** | bars from a start date to an end date on a week/month scale | a list grouped by week (bars don't fit on a phone) | `+` on the scale | a bar to move or resize it (1280 only) |

Every view type opens a row the same way (§5), and every view shows the filter line (§4.1).

### 7.3 Filter, sort, group

**All three open from `⋯`.** The menu leads with three tiles, **Filter · Sort · Group**, the same as Craft's. Each
opens a small sheet (390) or popover (1280).

**Filter.** Each rule reads *property → condition → value*.

- Conditions depend on the type:
  - text: contains, is, is empty;
  - number: =, ≠, >, <, is empty;
  - select: is any of, is none of;
  - date: is, before, after, within (relative: today, this week, next 7 days, past 7 days), is empty;
  - checkbox: is checked, isn't;
  - relation: contains, is empty.
- **Combining rules:** one line at the top switches between **all rules match** (the default) and **any rule
  matches**. R1 ships "all" only, and the switch comes in R3 (§14). Nested groups aren't offered. One person's databases rarely need them, and a nested filter is the hardest
  thing to read back from a chip line.
- **"Only for me" vs "for everyone" doesn't exist.** A workspace is one person (Lead: Q5 drops).

**Sort.** Several sorts, dragged into order. When a view is sorted, rows can't be dragged, and the `⋮⋮` handle
doesn't show.

**Group.**

- Group by any property except Text. Groups are collapsible headers in a table or list, and columns in a board.
- **Hide empty groups** is a switch.
- Each group can be hidden, and hidden groups are listed at the end as "Hidden: Done (12)".

### 7.4 A new row in a filtered or grouped view

- **New rows get the values that keep them visible.** A row added in a view filtered to "Status is Reading" starts
  with Status = Reading. A row added under the "Done" group starts with Done.
- **When no single value fits** (for example "contains", or "after Oct 1"), the row is created and the notice says
  **"Added · hidden by this view's filter · Show"**. Show opens the row.

### 7.5 Properties shown in a view

`⋯ → Properties` lists every property, each with a drag handle and a switch, the same as Craft's "Display Fields". Name
is always on. In a board or gallery, these are the properties shown on each card.

## 8. The `⋯` menu (database block or full page)

```
[ Filter ]  [ Sort ]  [ Group ]
Properties                    ›
Layout                        ›     the view's type and its options (board: group by; gallery: card image; …)
───────────────────────────────
Open as page                  ⤢     inline only
Turn into page                      inline home block only (§3.2)
Copy link
───────────────────────────────
Delete database                     home block or full page, --red
Remove this view                    linked view only (§9)
```

- Desktop: a popover. Phone: a sheet, with 44 px rows.
- **Later (§14):** Export CSV, Import CSV, Templates.

## 9. Linked views

### 9.1 Making one

- **From `/` Database**, by picking an existing database (§3.1). The new block shows the source's **first view**,
  copied, and its settings are its own from then on.
- **By copying and pasting** a database block, or Duplicate: that makes a **linked view**. (In R1, before linked views,
  see §6.3.12.)
- **Cut and paste moves the database.** Cutting the home block leaves the database as a full-page database, with the
  notice **"Reading list is now its own page · paste to put it back"**. Pasting it makes that block the home again
  (Roadbuster's detach/adopt). A cut that's never pasted loses nothing. The database is in Pages, under the page it was
  cut from.
- **Dragging the block** within its page, or ⌥⇧↑↓, keeps it the home. Roadbuster tests that the home id survives every
  move (Lead 7b3b9664 §2).

### 9.2 How it looks

- **The same block, plus one line under the title:**
  ```
  Reading this week                                      Table ⌄   ⋯
  ↳ from Reading list · in Books                                       ← --text-meta, --ink-3; tap opens the source
  ```
- **The title** is the view block's own label. It defaults to the source's name, and renaming it doesn't rename the
  source.
- **Editing rows, values and properties** through a linked view edits the source. Rows and properties are shared.
- **Views, filters, sorts, groups, and visible properties** belong to the linked view only.

### 9.3 Deleting

| He deletes | What happens | Notice |
| --- | --- | --- |
| a **linked view** block | Only that view goes, and the database is untouched. | "View removed · Reading list is still in Books · Undo" |
| the **home** block | The database and its rows go to Trash, as one entry. | "Reading list and its 42 rows moved to Trash · Undo" |
| the **host page** of the home block | As today, the page goes to Trash with its subtree, which includes the database. | the existing notice |

**A linked view whose database is in Trash** shows its title and one line: **"Reading list is in Trash · Restore"**.
Restore brings back the database with its rows. Nothing else shows, and nothing can be edited.

### 9.4 On day pages

- **A filter value only day pages have:** for a date property, **"this page's day"**. A linked view on Nov 3's page
  filtered by "Added is this page's day" shows Nov 3's rows. In the **Day template** it gives every new day its own
  slice. This is the strongest reason for linked views in Daythread.
- **A linked view in the Day template** is copied into each new day as a linked view, with the same filter. It never
  creates a new database.

## 10. Inside the editor (inline block)

- **Reaching the block:**
  - ↓ from the line above, or ↑ from the line below, **selects the whole block** (a 2 px `--blue` outline, the same as
    a selected page card);
  - ↓ or ↑ again moves on to the next line, so it's one stop and not a trap;
  - with the block selected, **Enter** puts the cell cursor on the first cell, and **Backspace** deletes the block (§9.3).
- **Inside the table** (1280):
  - arrows move between cells, and Tab / Shift-Tab move along a row;
  - Enter edits the cell or opens its popover, and Esc ends editing;
  - **Esc again** goes back to the whole block selected;
  - typing a character on a selected text cell starts replacing its value, and Delete clears a cell (with Undo).
- **Keys typed inside the table never reach the page editor.** That includes Enter, Backspace, `/`, `[[`, `@`, Tab and
  IME composition.
- **Undo:**
  - ⌘Z right after a cell, property or view change undoes that change (the workspace's single slot, Roadbuster §4);
  - ⌘Z in page text stays the editor's own;
  - **The rule he sees: ⌘Z undoes the last thing he did where his focus is.** Roadbuster to confirm the routing.
- **Text cells save** on Enter, on blur, or after 1 s without typing. A cell edit is never sent per key.
- **The block moves** by its `⋮⋮` like any block. It can't go into a synced block or a template (§3.1).
- **Paste:** pasting text into a cell sets that cell. Pasting several lines or a table (TSV) into the table is later
  (§14). Until then, only the first line goes in, and the notice says "Pasted the first line only".

## 11. To-dos in a database (the one question for Brian)

The Lead recommends **option 1**, so this is option 1's design, with the differences for 2 and 3 after it.

- **To-dos is a built-in source.** It's listed in `/` Database → "Show an existing one". It shows every task as a row,
  with fixed properties:
  - **Name** (the title);
  - **Status** (Open / Done / Paused);
  - **Planned** (a day);
  - **Start**;
  - **Deadline**;
  - **Page** (where the task lives, as a page ref).
- **Views work as on any database:** filters, sorts and groups, plus board and calendar, which a calendar of
  deadlines needs.
- **Edits go through the task commands he already uses:**
  - the checkbox ticks exactly as on a day page, including its notice;
  - a date is set with the same picker;
  - **a to-do can't get extra properties.** Neither `+` nor `+ Add property` is shown, and there's no explanatory
    line.
- **Opening a to-do row goes to its line on its page**, with the line highlighted the same way a line link does today.
  A to-do has no body of its own, so there's no row page.
- **+ New** in a To-dos view makes a task on **today's page, planned for today, where carried and planned to-dos already go** (Roadbuster
  e1e7bffd: with the other to-dos under the outermost heading above the first to-do, which is Morning Planning on his
  template; under the first heading if there are no to-dos yet; at the top if there's no heading). The
  row appears at once, and the notice says **"Added · Open"**, where Open goes to its line.
- **Option 2** (custom properties on to-dos): the same, but `+` is shown, and extra properties appear on the to-do's row
  in the table. They're edited in the table or popover only, since there's still no row page.
- **Option 3** (to-dos become rows): opening a to-do opens a row page, and its body exists. On day pages, the task line
  becomes a view of that row. Every to-do screen changes, so this needs its own design.

## 12. Rows: moving, duplicating, deleting

- **Reorder:** drag in an unsorted view (§7.2).
- **Out of the database:** refused (Roadbuster's Q2). The sidebar shows no drop line for a dragged row, and a row page
  has no Move to…. To move a row to another database: later (§14).
- **Duplicate row:** in the row page's `⋯`, or the row's `⋯` on hover at 1280 (long-press at 390). It copies the values
  and the body, and the title gets " (copy)".
- **Delete row:** from the same menus, or Delete on a selected row at 1280. It acts at once, with **"Row deleted ·
  Undo"**. In Trash, a row reads "Thinking in Systems · from Reading list".
- **Restoring a row whose database is in Trash** also restores the database. Trash says **"Restores Reading list too"**
  under its Restore button.
- **Several rows** (1280): a checkbox on hover at the left of each row, and Shift-click for a range. A bar then reads **"3
  rows · Edit property ▾ · Delete"**, the same bar as "N blocks selected". On the phone: later.

## 13. States

| State | What he sees |
| --- | --- |
| **New, no rows** | the header row, then `+ New`. Nothing else. |
| **No rows match the filter** | "No rows match this view · Clear filter" in `--ink-3`, where the rows would be |
| **A filter on a deleted property** | its chip shows the name struck through, "(deleted)". It's ignored until he removes it with `×`. |
| **A sort or group on a deleted property** | dropped quietly. The view falls back to manual order or no groups. |
| **Loading** | none of its own. The whole workspace loads at once, so the block appears with the page (Roadbuster §2). |
| **Offline, reading** | works from the offline copy, the same as pages |
| **Offline, editing a value** | His value **stays shown** in the cell, in `--warn`, and the strip says **"1 change not saved · Retry"**. Retry sends it again. Undo puts back the old value. **Never a silent revert.** It's the same rule as a failed tick, and kept drafts for cells come later (Roadbuster §4). |
| **Offline, a row body** | the editor's kept drafts, as on any page |
| **The same cell changed on another device, or a kept cell value sent after the app was closed** (Roadbuster 6aa746aa) | The other value loads, and **one notice, everywhere** (Lead 0b05067c) names the row: **"Notes in Thinking in Systems changed elsewhere · yours was “A primer on systems thi…” · Use mine"**. A text value is quoted to its first 40 characters on one line, and Use mine sends the whole value. With no conflict, a kept value is sent with no notice. If the row was deleted in between, the kept value is dropped quietly. |
| **A different cell or row changed elsewhere** | Both edits stay. No notice (Roadbuster §4: the per-cell check). |
| **The row he has open is deleted elsewhere** | our existing "This page is in Trash · Restore" state |
| **The database page is open and deleted elsewhere** | the same |
| **A relation's target database is in Trash** | Relation cells show the linked titles in `--ink-3` with "(in Trash)". The picker is empty with "Books is in Trash · Restore". |
| **A formula error** | "Error" in `--red` in the cell, with the message in the property menu |
| **A very long cell** | ellipsis in the table, and the full value on the row page |
| **An empty title** | "Untitled" in `--placeholder`, with search finding it as "Untitled · Reading list" |
| **Many columns on the phone** | Name pinned, sideways scroll with a fade, and the `›` hint (§4.2) |
| **More than 25 rows inline, or 100 on a full page** | "Show 25 more · Open as page" (§4.1) |
| **A table in a narrow column** (a row page nested inside a row page) | the same block. Nothing nests deeper than the page column it sits in. |

## 14. Release order (usage sets the order, not the scope)

The estimates are Roadbuster's (`database-fit.md` §7) unless marked as mine.

| Release | Contents | Why this order |
| --- | --- | --- |
| **R1** | **Database itself:** `/` Database (new only), Pages' `+` → Database, inline and full page, Turn into page/inline, cut and paste, **Table** view, properties **Text, Number, Select, Multi-select, Status, Date, Checkbox, URL**, a row opening as a page, filter/sort (§7.3), properties shown and reordered, everything in §10, §12 and §13 except relation and formula. Roadbuster's "send only what changed" PR goes first, once Brian says yes (Lead 7b3b9664). | about 5.5–6 days (Roadbuster). It's the smallest version that's a real Notion-like database at both widths. |
| **R2** | **Linked views** (`/` picker, copy/paste, "this page's day", templates) plus **To-dos as a source** (§11, option 1) plus **Board** and **Group** | This is where databases meet days and to-dos. Linked views are about 1 day and To-dos about 1 day (Roadbuster). Board with Group is about 1 day (Roadbuster's "later" list). |
| **R3** | **Calendar, List, Gallery**; the filter's **"any rule matches"** switch; **Relation, Rollup**; Created/Edited time, ID, Email, Phone, Files (**needs file uploads, which don't exist anywhere yet: new
  infrastructure**, Roadbuster 13301ca1); row **templates** (`+ New ⌄`); **wrap** per property; several rows selected on the phone | Ordered by his use after R2 |
| **R4** | **Timeline, Formula**, repeating row templates, CSV export/import, pasting TSV, moving a row to another database, **side peek** at 1280 (only if he's seen opening many rows one after another) | the largest and least certain |
| **Later, not yet ordered** | **Forms, Automations, Buttons, Place**, and **Chart** | These are in scope. They wait for a design pass of their own, and his use orders them, with nothing cut for lack of evidence (Brian 57deaed7, Bumblebee 3b04290d). |
| **Not planned** | Person, Created by, Edited by, permissions, "only for me" filters, several data sources in one database | Each needs more than one person in a workspace, or the Lead's frame dropped it (several data sources). |

## 15. How I'll check it (each release, before it goes live)

- **On a copy of his real data, at 390 and 1280**, with the built app:
  - every state in §13 that the release includes;
  - the alignment gate at 0 fail / 0 missing, plus the database block's own columns: the title on the text column,
    and `+ New` on the Name column.
- **On a native Simulator, in the Home Screen app:**
  - every phone sheet;
  - the keyboard comes up only in sheets with a text field (§4.2);
  - a checkbox tick doesn't raise the keyboard (the B72 rule);
  - sideways scroll doesn't drag the page.
  - for each R1 editor (§6.3): which open with the keyboard down, Done/scrim/swipe keep the edit, Number's ± and
    "Numbers only", Pinyin in Select's field and Date's field, and the sheet staying above the keyboard.
- **Keys at 1280:**
  - reaching and leaving the block (§10);
  - no key leaks into the page editor, including IME composition with Pinyin;
  - ⌘Z goes where §10 says.

## 16. Open, for Lead and Roadbuster (not for Brian)

Roadbuster answered 1–3 in 13301ca1:
- ⌘Z routing is buildable. With a single Undo slot, ⌘Z in a cell after he has typed in the page says "Can't undo ·
  edited since", which is today's rule.
- "One value" for prefill: select/status *is*, checkbox *is*, multi-select/relation *contains*, text *is*, number *=*,
  date *is* (fixed or relative), and the group's value.
- The caps stay as a start, and he'll measure render at 390 in R1's tests.

The original questions:

1. ⌘Z routing between cell edits and the editor (§10): is "the last thing where the focus is" buildable?
2. Prefilling values for a new row in a filtered view (§7.4): which filter conditions count as "one value"?
3. The row caps of 25 inline and 100 on a full page (§4.1): are they right for phone render time, or should the caps
   be lower?
4. Roadbuster's five open points (model §10) are answered here: the default schema (§3.1), which views and types
   come first (§14), linked views in R2 (§14), no body on a full page (§4.3), and no dragging a row out (§12).
