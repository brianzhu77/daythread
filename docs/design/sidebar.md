# The sidebar, Nov 8

Status: **built Nov 8** on `design/sidebar`. Brian (2026-11-08): "the current side bar looks cheap"; align it with
the reference he sent (a screenshot of another app's sidebar), with leave to change what it does. Three decisions he made when asked:

| Question | Brian's answer |
| --- | --- |
| Where the account lives | The lockup stays on top; one pinned row at the bottom (the address, with a chevron) opens a menu with everything the old footer links did. |
| What the middle holds | Pages only. Days leave the sidebar: Today, the Calendar and the date picker reach any day. |
| What is pinned at the bottom | The Trash, while it holds something, above the account row. Nothing else. |

## Why it looked cheap

Row text in the secondary grey instead of ink; tiny uppercase group labels; three text sizes within a few rows (15,
14, 13); icons a size larger than the reference's; a shortcut drawn as a boxed key; a footer of 13 px grey links (the address,
the time zone, "Week starts", Templates, Export, Sign out, Delete account) that read as fine print.

## What changed

- **One row geometry** for every row: 30 px tall, 8 px side padding, a 16 px icon in `--gray-11`, 10 px to the words
  in `--gray-12` at `--text-ui`. Hover `--gray-2`, the current row `--gray-3` with weight 500 and its icon in ink.
  Rows 1 px apart. The sidebar's own padding is 12 px.
- **The lockup** sits in that geometry: the mark in the icon column, the wordmark where labels start, one 32 px row
  with 12 px below.
- **Group labels** are `--text-meta`, weight 500, sentence case, `--gray-11`, 22 px above and 4 px below. The
  Pages `+` is a 22 px ghost square at the label's right (4 px corners).
- **Search's shortcut** is a quiet word at the row's end (`--text-meta`, `--gray-11`), not a boxed key, as the `/`
  menu's rule says.
- **The Pages tree** shares the row geometry. The page's icon sits in the icon column and swaps to the chevron while
  the row is hovered or focused (Notion's way); on a touch screen a page with children shows the chevron always. A
  child indents 16 px. The drop line starts 8 px in. "No pages yet" sits where the first title would, in `--gray-11`.
- **Days are gone** from the sidebar (`SidebarTree` no longer takes a footer and no longer lists days or months). A
  page made inside a day is reached from that day, as on the phone, which never had the Days list.
- **The footer** (`.side-foot`) is sticky at the bottom of the sidebar's scroll with `margin-top: auto`, so it is at
  the bottom when the tree is short and stays in view when it is long. The Trash row shows its count at the right.
- **The account row** (`src/components/sidebar-account.tsx`) is the address, or "Account" with sign-in off, with a
  14 px chevron. It opens an `.app-menu` upward: Templates · Export (and its failure notes) · reminders (the same
  states as the phone row) · Time zone and Week starts as rows with the value at the right and a native select laid
  over them (the phone row's trick) · Sign out · Delete account…, which opens the password form under the row. Esc,
  an outside tap, ↑↓, Home and End work as in the row menus; a focused select keeps its arrows.
- The phone keeps its account row at the end of Pages. Its logic moved into `useAccount()` (`account-row.tsx`) and
  `useReminders()` (`reminders.tsx`), which both rows now share.

## Checks

- `npm run typecheck`, `npm test` (956 pass, 12 skipped).
- Looked at 1280 in light and dark on a disposable workspace (`DAYTHREAD_SQLITE_PATH` in a scratch folder): nav,
  the tree with a nested page, hover and current states, the menu open, the pinned footer.
- Not run: the geometry gate (`check-alignment`). Nothing in the day page's rows changed; only `.sidebar` rules and
  the tree did.
