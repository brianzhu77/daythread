# Tap feedback: press inventory (main 99d606fc)

Companion to `tap-feedback.md`. Measured 2026-11-22 by Jazz with `press.mjs` (Chromium; 390 touch held 180 ms then
cancelled, 1280 mouse held 180 ms then moved away; compares the computed look of the control, its children, its
pseudo-elements and its parent before and during the press). At 1280 "before" is the hover look, so "no change" means
the press looks exactly like hover.

Data: a local copy of Brian's Nov 21 15:00Z snapshot with a 4-suggestion draft on Nov 22. Screens: Today, Tasks,
Calendar, Pages, Tags, Review, a document page (2026 Nov China Trip), a link page, Nov 20, plus the Day actions menu,
the Page actions menu and the date picker. Not covered: databases (none in his data), Search and Account (the openers
didn't open in the script), sheets on the phone, the editor's own menus. The repo gate (#375) should seed those.

**Total: at 390, 141 of 186 controls show nothing while pressed; at 1280, 200 of 242 look the same as hover.** The
ones that change are almost all HeroUI parts (calendar cells, day arrows, secondary button).

Result per control family (every family not listed in the spec's §1.2 table gets a look from the closest family):

| Control (tag.class) | 390 no change | 1280 no change | Examples | Screens |
|---|---|---|---|---|
| `a.side-row` | 0/0 | 48/48 | Today, Tasks, Calendar | /, /tasks, /calendar, /pages |
| `button.card-row` | 20/20 | 23/23 | 双十一购物清单, 2026 Nov China Trip, Mogul (@SmartNotHard1) o | /pages |
| `button` | 20/20 | 22/22 | Dismiss, Apply TRV for Lu and Kat, Skip TRV for Lu and Kath | /, /day/2026-11-20, / (menu/picker), /pages (menu/picker) |
| `a.tab` | 41/41 | 0/0 | Today, Tasks, Calendar | /, /tasks, /calendar, /pages |
| `input` | 12/12 | 12/12 | New task, Complete 牙刷, Complete 颈枕 | /, /pages |
| `a.card-row` | 11/11 | 12/12 | #rewind25 blocks · Fri, , #plaid5 blocks · Fri, No, #plaid_for_all2 blocks · | /tags |
| `button.side-row` | 0/0 | 16/16 | Search⌘K, Account | /, /tasks, /calendar, /pages |
| `a.tree-title` | 0/0 | 16/16 | 双十一购物清单, 2026 Nov China Trip | /, /tasks, /calendar, /pages |
| `a.pill` | 6/6 | 6/6 | Today, Upcoming, Open | /tasks, /calendar |
| `HeroUI button` | 0/13 | 11/15 | Today, Sun, Nov 22. Choo, Nov 23 · Tomorrow · Mond, Nov 24 · Tuesday | /, /calendar, /day/2026-11-20 |
| `a.brand` | 0/0 | 9/9 | Daythread | /, /tasks, /calendar, /pages |
| `button.tab-search` | 8/8 | 0/0 | Search | /, /tasks, /calendar, /pages |
| `button.page-more` | 4/4 | 4/4 | Day actions, Page actions | /, /pages, /day/2026-11-20 |
| `button.side-label-add` | 0/0 | 8/8 | New page | /, /tasks, /calendar, /pages |
| `HeroUI calendar-cell` | 5/35 | 0/35 | Tuesday, December 1, 202, Wednesday, December 2, 2, Thursday, December 3, 20 | / (menu/picker) |
| `a.crumb` | 2/2 | 2/2 | Pages, Thu, Oct 22 | /pages |
| `button.danger` | 2/2 | 2/2 | Delete | / (menu/picker), /pages (menu/picker) |
| `HeroUI tooltip-trigger` | 1/1 | 1/1 | Next day | / |
| `button.draft-primary` | 1/1 | 1/1 | Apply all | / |
| `a` | 1/1 | 1/1 | Nov 22 · Today · Sunday | /calendar |
| `a.note-card` | 1/1 | 1/1 | TodayConcrete, actionabl | /calendar |
| `button.round-add` | 1/1 | 1/1 | New page | /pages |
| `button.editor-plan-action` | 1/1 | 1/1 | Plan for today | /pages |
| `a.link-url-open` | 1/1 | 1/1 | Open ↗ | /pages |
| `button.draft-more-toggle` | 1/1 | 1/1 | 3 more open ▸ | /day/2026-11-20 |
| `a.pages-trash-row` | 1/1 | 0/0 | Bookmarks · 20 | /pages |
| `select.account-zone` | 1/1 | 0/0 | Week starts on | /pages |
| `button.search-row` | 0/0 | 1/1 | Today | / (menu/picker) |
| `HeroUI calendar-nav-button` | 0/2 | 0/2 |  | / (menu/picker) |
| `select` | 0/0 | 0/1 |  | /pages (menu/picker) |

TOTAL {"390":[141,186],"1280":[200,242]}
