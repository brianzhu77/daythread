# Templates: states (B70)

- Author: Jazz (Design) · 2026-10-31 · status: **design states for the B70 build**, base main 38d2285.
- Inputs: Brian `9df6febf`, re-scope `27f8c724` ("don't over engineer it… a template table, and assign the default
  template for specific entries… think about Notion"); Lead `4f1dfc60` (replaces the one-page design of `9cbc759`);
  Ratchet `d2ee6b8c`; Bumblebee `cd47f7da`; Lead phasing `dd303f72`; Roadbuster storage `22aea1c7`.
- **Phasing (Lead):** part 1, by 11:00Z: the list, templates, the "Day pages" target. Part 2, after part 1 is with
  Ratchet: "Pages in…" and "Pages inside any day". In part 1 the Default for menu shows only None and Day pages.
- **Evidence:** read from main's code only. Nothing here has been run.

## 1. Templates list

| Where | What |
| --- | --- |
| **Entry** | Account row (sidebar foot at 1280, foot of Pages at 390): a text link **Templates**, after the time zone and before Export. |
| **Screen** | Like Pages: title row "Templates" with the round **+** ("New template"). One row per template: its title, and a quiet second line naming its default: "Default for day pages", "Default for pages in Recipes", or nothing. |
| **No day template saved** (every new account) | One quiet line above the list: "Day pages start with TODO, Events, Good Stuffs and Notes. · Edit". **Edit** makes a template titled "Day" with those four headings, sets it as the default for day pages, and opens it. The line then goes away, since the row is in the list. |
| **Never listed elsewhere** | Templates aren't in Pages, recent pages, the `[[` picker, the sidebar tree, search, Move to…, Tags, Calendar or Linked from. |

## 2. A template page

```
Recipe                                         ← title, editable like a document's
Default for: Pages in Recipes ▾                ← one row, meta size
New pages start from this template. To-dos are copied empty.   ← grey meta line
## Ingredients
•
```

- **Default for** menu: **None** · **Day pages** · **Pages inside any day** · **Pages in…** (opens the Move to…
  picker to choose the page; day pages and documents are offered, templates aren't). The list's second line for the
  third item reads "Default for pages inside days".
  - If another template already holds that target, the item says so: "Day pages · now Day". Picking it moves the
    default, with the notice **"Now the default for day pages · Undo"**. The old template's line becomes empty.
  - Picking **None**: "No longer a default · Undo".
- **⋯ menu:** Delete only, **in part 1** (+ makes templates, so without Delete a mistaken one can never go). A straight
  delete, no Trash. Notice **"Deleted 'Recipe' · Undo"**. Its target goes back to today's behaviour (the
  built-in four headings for days, a blank page for subpages).
- **Editor:** as on a document page, except **no `/` Page item and no "Turn into page"**, because a subpage inside a
  template would be copied every time. Page cards and link cards can sit on it but aren't copied (allowlist).
- **To-do rows here are only rows.** Nothing on a template creates or changes a task, including a real to-do pasted in.

## 3. What a new page gets

| Template content | On the new page |
| --- | --- |
| Headings, bullets, numbered lines, quotes, text, nesting | Copied as written, fresh ids. |
| To-do rows | **Empty, unticked** to-do rows, fresh task ids. Nesting kept. |
| Page cards, link cards | Not copied. |
| Template title | **Not copied.** A day keeps its date; a subpage gets the usual untitled title with the caret in it. |

**When a default applies**
- **Day pages:** every day page created after the save (`ensure-day`). Days that already exist stay as they are.
- **Pages in X:** a new empty page made directly inside X (the `/` Page item, the + on X's Subpages). **Not** "Turn into
  page" (it already has words) and not a page moved into X.
- **Pages inside any day:** the same, for a new empty page made directly inside a day page. A page in X when X is
  inside a day uses X's default, not this one (the nearer target wins).
- Copied text on a day page counts as written (accepted, Lead). Carried to-dos go to the first section with a to-do row.

**Part 2 waits for Brian** (Lead `625bf727`): his reply can still change the subpage targets before code exists.

## 4. Edge states

| State | Behaviour |
| --- | --- |
| Target page X trashed | The line reads "Default for pages in Recipes · in Trash". Restoring X makes it work again. Deleted for good: None. |
| Template deleted, then Undo | Comes back with its default, unless another template took that target meanwhile; then it comes back as None. |
| Saving, failed save, offline | Same as any document page. A page created while a template edit is unsaved uses the last saved version. |
| Empty template | The new page starts blank, as with no default. |
| 390 | The "Default for" row wraps under the title; its menu opens as a sheet, like other row menus. |
| Dark mode | Existing tokens only. |

## 5. Out of scope

Picking a non-default template when creating a page (Notion's template picker); repeating to-dos; a template per
weekday; sharing templates between accounts.

## 6. Checks for review (adds to Ratchet's list)

1. A new account's Templates shows the built-in line; **Edit** creates "Day", default for day pages, and the next day
   page uses it.
2. Setting a second template as default for day pages moves the default; Undo gives it back to the first.
3. A new page made inside X from the `/` menu starts from X's default; "Turn into page" and Move to… into X don't.
4. A template with a to-do titled "Water plants": the new page has an empty to-do; no task is created by the template
   save or the copy.
5. Templates never appear in Pages, search, `[[`, Move to… results, Tags or the sidebar.
6. 390 and 1280, light and dark: the list, the "Default for" row and the grey line sit on the text column.
