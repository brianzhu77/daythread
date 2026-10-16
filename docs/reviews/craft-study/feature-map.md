# Craft iOS study · feature map for Daythread v1

- Owner: Bumblebee (features and flows) · Reviewer: Ratchet · Visual counterpart: Jazz,
  `docs/design/craft-v1.md` · 2026-10-16
- Source: `refs/Craft ios Dec 2025/` (524 Mobbin screenshots, not in the repo). Screenshot numbers
  below are the file suffixes, e.g. **#364** = `Craft ios Dec 2025 364.png`.
- Brief: Brian, msg `cf3b03a8`: "我们第一版可以照抄。功能build起来再建立自己的风格". Scope per the Lead's
  list to Brian (thread `#daythread:cf3b03a8`): copy Home, phone tab bar, Calendar with daily notes,
  Tasks, the document page and block menus, text/block look, light/dark. Leave out collections,
  publish/share, document styles, collaboration, multiple spaces, onboarding/login.
- Status: **study draft for review, not a spec.** Nothing here is built. Behaviour rules come from
  the accepted specs (v0.3, the Good Stuffs addendum, v0.4 `pages-delta.md` `77a2fa6f`); this file
  ranks below them and above `docs/design/craft-v1.md`. C1, C4 and C5 await Brian; his answers go
  into v0.4.1, not into this file.

Verdicts: **Copy** = same structure and behaviour · **Adapt** = Craft's layout, Daythread's rules ·
**Skip** = not in v1 · **Later** = worth doing after v1 is in use.

## 1. What Craft is, in one paragraph

Four tabs plus a floating **+** (#18, #351, #364): **Home** (library: search, recent doc cards,
All Docs, Starred, Folders, Tags), **Tasks** (Inbox / Today / Upcoming / All, plus pinned docs and
docs with tasks), **Calendar** (a scrolling list of days, each with its daily note card, that day's
tasks and optional events), and **Space** (settings). **+** opens a quick-create sheet that makes
a doc or a task (#19–#23, #349, #360). Documents are block pages with a format sheet (#13–#16,
#44–#59), an insert menu (#83–#84, #109), page/card blocks for nesting (#85–#99), and a per-block
action sheet (#250, #255). The core loop Daythread cares about is **Calendar → daily note → tasks
for that day**; most other screens are document tooling.

## 2. Screen-by-screen map

### 2.1 Navigation

| Craft | Screens | Verdict | Daythread v1 | Rule it touches |
| --- | --- | --- | --- | --- |
| Bottom tab bar: Home · Tasks · Calendar · Space, floating + | #18, #351, #364 | **Adapt** | Tabs **Today · Tasks · Calendar · Pages** (Craft's order, with Today in Home's place; agrees with Jazz's craft-v1 §3.1), floating **+** = capture. Settings moves to Pages ⋯. | 00 U03: the first screen is today's page, not a library (§3 C1). |
| Home (search, recent cards, All Docs, Starred, Folders, Tags, Customize Home) | #18, #366–#368, #398–#405 | **Adapt** | Becomes the **Pages** tab: search, recent page cards, page tree (top-level pages + children). Starred: Later. Tags, Customize Home, Shared with Me: Skip. | v0.4 N-2, N-9 |
| Folders (create with icon/colour, waterfall/grid/list) | #376–#391 | **Skip** | Top-level pages act as folders (v0.4 N-2). No separate folder object. | v0.4 N-1 (§3 C7) |
| Quick Open | #365 | **Copy** | ⌘K on Mac, search button on phone; pages and tasks. Same as 01 "Search". | 01 nav |
| Search results with sort/display | #369–#375 | **Adapt** | Results list (title, path, snippet). Sort and grid display: Skip. | — |
| Desktop sidebar | (iOS only in refs) | **Adapt** | Jazz's sidebar: Today, Calendar, Tasks, page tree. | v0.4 N-9 |

### 2.2 Calendar and the daily note — the core loop

| Craft | Screens | Verdict | Daythread v1 | Rule it touches |
| --- | --- | --- | --- | --- |
| Calendar tab: days listed down the screen, "Nov 21 · Today · Friday", daily note card, tasks for that day, filter chips Daily Notes / Tasks / Events | #364, #425–#431, #466 | **Copy** layout | **Calendar** tab. Each day shows its daily page card (first lines) and the tasks **planned** for that day from included placements, one row per task, in plan order, including tasks that are planned but not in the note (marked so). Past days show that day's placements as they were, including ones later moved or excluded (shown as moved / not today), not just currently included ones and not the task's current planned date. Scrolling or filtering the Calendar never creates a page or a placement; opening a day's page follows 04 P12 (find, create or offer restore for that date). Events chip shows Daythread's own Events lines. | 00 D02, D06; 01 Upcoming (§3 C2) |
| ⋯ menu: New Task, Create Daily Note, Jump to Day, view toggles | #430 | **Adapt** | Jump to Day + view toggles. "Create Daily Note" isn't needed: a daily page exists for any date you open (04 P12). | 04 P12 |
| Calendar settings: connect device calendar | #427–#428 | **Skip** | Events stay Brian's own lines (01). No calendar access in v1. | — |
| Daily note page: "Tomorrow, Fri, Nov 28", date chip, a collapsible **This Day** block listing tasks for that day | #432 | **Adapt** | The daily page keeps Brian's sections (Top 3 · Other · Events · Good Stuffs · Notes). **This Day's look** (collapsible block, checkbox rows with a small source chip) is used for the Top 3 and Other plan sections. | 00 D01, D05; 04 A19, A34 (§3 C3) |
| Task row chips: "Inbox", flag "Today", date "Nov 28", alarm icon | #364, #414, #432 | **Adapt** | Chips show Daythread facts: deadline ("due Fri"; red only once the deadline has passed), "from Tue" for carried items, "Not today". A task that was planned for an earlier day and not done is never red. No alarm chip. | 00 I4, D05, D07 |

### 2.3 Tasks

| Craft | Screens | Verdict | Daythread v1 | Rule it touches |
| --- | --- | --- | --- | --- |
| Tasks tab with segments Inbox · Today · Upcoming · All Tasks | #351, #410–#418, #461 | **Adapt** | Segments **Today · Upcoming · Open · Not today**. Today = today's included placements, the same set and order as the day page's plan **including** its "Planned · not in note" rows. Upcoming = 01 "By date". Open = the open pool incl. never-dated ("Still open"); an explicitly created but never-planned task lands here and never enters the morning hand-off. Not today = paused tasks, still showing their real deadline and attention date. | 00 D05, D06; 01 Upcoming (§3 C2) |
| Inbox = tasks without a date | #412–#413 | **Adapt** | Folded into **Open** (never-dated tasks are labelled "unscheduled", 00 D06). No separate Inbox. | 00 D06 |
| "Well done, all your tasks are organized" empty state | #412 | **Skip** | No completion praise or "all clear" message (Good Stuffs addendum G-3; not a list to clear). | Addendum G-3 |
| Pinned Docs, Docs With Tasks | #351, #415, #419–#422 | **Later** | Not needed for the daily loop. | — |
| Task detail with date/time picker, Remind Me, Repeat | #352–#359 | **Adapt** | Date picker for planned day and deadline (01). Time, Remind me and Repeat: Skip. | 01 task actions |
| Reminders list with time-based "Overdue since Today, 1:00 PM" in red | #409 (Notifications → Reminders) | **Skip** | No reminders in v1. Whatever Craft does with dated tasks, Daythread never shows a missed planned day as red: unfinished planned tasks go to the morning hand-off. Red only for a passed real deadline. | 00 D07, I4 (§3 C2) |

### 2.4 Quick create (+)

| Craft | Screens | Verdict | Daythread v1 | Rule it touches |
| --- | --- | --- | --- | --- |
| + / "What's on your mind?" sheet over the keyboard, type chips Doc / Task / Collection, folder picker, date flag, Create | #19–#23, #349, #360–#363 | **Adapt** | The sheet becomes Daythread's **capture**: one field, type chips **Auto · Task · Page**, date chip shown for Task. Auto keeps today's capture contract (01 §4.3, 03): a clearly new group is saved directly; changes to existing items or mixed groups wait for one confirmation, and editing out the changes doesn't remove that gate; multi-line input previews first. Task and Page skip the AI. The Task date chip sets the planned day only, never the deadline. Page and bare-URL link pages depend on the v0.4 page API; until it exists the Page chip is hidden. | 00 D12; 03 (§3 C5) |
| "Task Created · Open Inbox to view" / "Added to Today · Tap to open" toast | #349, #363 | **Copy** | Capture receipt with Open and Undo (target behaviour; check what the current capture code renders). | 01 receipts |

### 2.5 Document page and blocks

| Craft | Screens | Verdict | Daythread v1 | Rule it touches |
| --- | --- | --- | --- | --- |
| Page: big title, body, ✓ Done button while editing, back / share / ⋯ when reading | #24–#27, #44 | **Copy** | Same. Share: Skip. | — |
| Format sheet: Heading / Body / Page / More, list buttons, Focus, Block, colour | #13–#16, #45–#59 | **Adapt** | Text styles **Title · Heading · Body · Caption**, bullet / numbered / checklist / toggle, indent. Fonts, alignment, block colour, Focus: Later. | Editor trial (task #24) |
| Insert menu ("+"): text styles, lists, separators, Page, Card, image, file, rich blocks | #83–#84, #109, #115 | **Adapt** | Insert: text styles, lists, a plain separator line, **Page** (subpage), **Link** (URL → link page). Images, files, tables, code, formula, sketch, whiteboard, collection: Skip. | v0.4 N-2, N-3 |
| Page block and Card block (nested page shown as a row or a card, card styles) | #85–#99 | **Adapt** | Page card = v0.4 page card (title + preview line). One card style. Card art, emoji and backdrop options: Skip. | v0.4 N-2 |
| Insert Smart Link → link preview card with fetched title/image | #198–#201 | **Adapt** | Link card with title (URL text until Brian renames), domain, Open. **No fetching** in v1. | v0.4 N-3; 03 X25 (§3 C8) |
| Toggle block | #57–#60 | **Copy** | Collapsible block. | — |
| Checklist / task list block | #84, #343 | **Adapt** | Current rule (= Craft): a checkbox row (`[]`, `/task`) is a task everywhere; in plan sections it is also that day's placement. Proposal C4 (a) would make it a plain checklist line on ordinary pages. | 00 D02; 01 §4.2 (§3 C4) |
| Block selection: swipe to select, Style / Actions / Assistant / Delete bar | #33, #69, #247 | **Adapt** | Style / Actions / Delete. No Assistant. Delete follows D05 (whole plan row = Not today; bulk = text only). | 00 D05; 04 A19, A34 |
| Block action sheet: Copy, Cut, Duplicate, Share & Export, **Move to Daily Note**, More | #255 | **Adapt** | Labels by kind, no generic "Move": prose line → **Bring to today**; task row → **Plan today** (Keep); page card → **Bring to today** adds a reference to the same page. Copy / Duplicate of a task row make references to the **same** task; a new independent task needs **Duplicate task**. Plus Cut, Make task, Open. | 00 D05, D07; 02 §109; v0.4 N-4 (§3 C6) |
| Remind me (20 min, 1 h, 3 h, tomorrow, next week, custom, save for later) | #250–#253 | **Skip** | Only the evening review reminder exists in v1. | 00 scope |
| Page ⋯: Page Style, Text Size, Spelling, Find in Page, Table of Contents, AI Assistant, View, Star, Move to…, Delete | #281 | **Adapt** | Find in Page, **Move to…** (v0.4 N-2), Delete (v0.4 N-7), Page info. Others: Skip or Later. | v0.4 N-2, N-7 |
| Move document to (folder list) | #282–#283 | **Adapt** | Move to… lists pages (tree search), never into a page's own descendants. | v0.4 N-2 |
| Page info: created, updated, location | #341 | **Copy** | Plus "Linked from" (v0.4 N-5) on the page itself. | v0.4 N-5 |
| Templates gallery, Use Template | #36–#43 | **Skip** | Daythread has one default daily template whose sections Brian can rename, add, remove and write anywhere in (00 D01, 04 P09); no template gallery. | — |
| Recently Deleted (30 days) | #399 | **Adapt** | Trash view for pages (v0.4 N-7). No automatic permanent delete in v1. | v0.4 N-7 |

### 2.6 Leave out (Lead's list, confirmed against the screenshots)

Collections/tables/filters/sort/group/views (#116–#191), whiteboard and sketch (#203–#238),
code and formula blocks (#184–#186, #226–#232), files, scanning and images (#239–#245),
export/print/PDF/Markdown (#256–#269), comments and reactions (#270–#279), document styles,
covers, backdrops, fonts, separator styles and washi tape (one plain separator is kept) (#61–#82, #284–#311), share/publish/domains/QR
(#312–#330, #449–#451, #486–#497), multiple spaces (#443–#448, #485), AI assistant and local
models (#29–#35, #499–#502), integrations (#498), notifications and daily email (#406–#409,
#503–#504), subscriptions (#436–#441, #482–#484), onboarding and login (#0–#17, #513–#521),
settings beyond light/dark (#433–#435, #452–#481, #505–#512). Widgets (#522–#523): **Later**.

## 3. Where copying Craft would change an accepted rule

Each item states Craft's behaviour, the Daythread rule, and the recommendation. C1, C4 and C5
are choices for Brian (via the Lead); the rest keep the accepted rule and only borrow the layout.

- **C1 · First tab.** Craft opens on a library (Home). 00 U03 makes today's page the entry point.
  **Recommend:** Today first; Craft's Home becomes the Pages tab. *Brian's choice* if he wants a
  library first.
- **C2 · What "Today" and "Upcoming" mean.** In Craft tasks show by their date (#364, #432);
  the screenshots don't establish what happens to a missed date (#409 is the reminders list). In Daythread "planned for today" is a placement (00 D02),
  unfinished planned tasks go to the morning hand-off (D07), and set-aside tasks are paused (D05).
  **Keep our rules:** Calendar and Tasks → Today read included placements (one row per task per day,
  plan order), the same set as the day page's plan including "Planned · not in note"; never built
  from page text. Past days use that day's placements as they were, including moved and excluded ones. No overdue styling for planned days;
  red only for a passed deadline (I4). Not today gets its own segment. Never-planned tasks are in
  Open and never in the hand-off.
- **C3 · "This Day" vs plan sections.** Craft's daily note lists that day's tasks as a live query
  block. Daythread's plan rows are placement blocks Brian edits on the page, with D05 delete rules
  (A19 single row = Not today; A34 bulk = text only). **Keep our rules;** borrow only the look.
- **C4 · Checkboxes outside the plan — new proposal.** *(Corrected after Ratchet's review.)*
  **Current rule:** typing `[]` or `/task` in any section creates a task row directly (01 §4.2),
  which looks the same as Craft's checkbox block (#84, #343; we haven't verified every Craft flow);
  only a task row in a daily page's plan sections is also that day's placement.
  **Proposal (a):** on ordinary (non-daily) pages a checkbox is a plain checklist line with a
  per-line **Make task**; real tasks come from plan sections, capture and that action. **(b):** keep
  the current rule. Recommendation (a), for a reason that is new with v0.4: nested project pages
  and lists will hold many checkboxes, and they shouldn't all enter "Still open". (They would not
  enter the morning hand-off either way: only planned tasks carry over.) A closer call than (a) vs (b)
  first sounded. Either way, an existing task referenced on another page stays the same task. *Brian's choice* (Lead's message to Brian in this thread).
- **C5 · Capture type chips.** Craft makes the user pick Doc or Task. Daythread's capture lets the
  AI read the input: plainly new tasks are created directly with an editable receipt, and only
  changes to existing items or mixed captures wait for one confirmation (00 D04, D12, 03). **Recommend:** chips **Auto · Task · Page**,
  Auto as default. Task and Page skip the AI, which is faster and costs nothing. *Brian's choice*
  whether Auto or Task is the default.
- **C6 · Move to Daily Note.** #255 shows the label; static screenshots don't show what happens to
  the source. Daythread keeps its rules and uses honest labels: **Bring to today** copies a prose
  line once with a "from <day>" link and leaves the source; **Plan today** (Keep) places the
  **same** task on today, clears the pause, keeps deadline and attention date; a page card's Bring
  reuses the page ID, adds a reference, never changes its parent or follow-up state. A retried
  request never makes a second copy; a deliberate second Bring does. (00 D05, D07; 02 §109; v0.4.)
- **C7 · Folders.** Craft has folders plus subpages. v0.4 has pages only. **Keep v0.4;** top-level
  pages look like Craft's folder rows.
- **C8 · Smart Link fetch.** Craft fetches title and image. Brian said fill by hand for now
  (`3596b765`); 03 X25 says no fetching. **Keep**; copy the card look only.

## 4. Suggested build order (for the Lead and Wheeljack to cost)

1. Phone tab bar + floating + (Today · Tasks · Calendar · Pages) and desktop sidebar.
2. Calendar tab reading existing pages and placements (no new data).
3. Tasks tab with Today / Upcoming / Open / Not today (queries over existing data).
4. Capture as the + sheet with Auto · Task (Page chip waits for step 5).
5. Pages tab + v0.4 nested pages and link pages.
6. Block editor features (depends on the BlockNote trial, task #24).

Steps 1–4 use the current data model (Calendar and Tasks are queries over pages and placements);
the Page chip and link pages need the v0.4 page API from step 5. Steps 5 and 6 carry the v0.4 and editor work already estimated
(11–19 engineer-days, unvalidated).

## 5. Acceptance cases to add (from Ratchet's review)

- **K1** Bulk-delete text containing 2 plan rows: Tasks → Today and Calendar → today still list both, marked "not in note".
- **K2** Complete one planned task and cancel another: both still shown on today in Calendar with their state; Tasks → Today follows 01's done/cancelled display.
- **K3** Move a task planned Tue to Wed: Calendar Tue still shows it as moved (history); Wed shows it planned.
- **K4** Not today on a task with a deadline: it is in the Not today segment with the deadline shown; red only after the deadline passes.
- **K5** Yesterday had 5 planned open tasks, none with a passed deadline: all 5 in the hand-off; none shown red anywhere.
- **K6** Create a task with `/task` on a project page, never planned: it is in Open, not in the hand-off.
- **K7** Copy, Duplicate and cut/paste a task row: one task, several references; Duplicate task makes a new task with no placement.
- **K8** Bring a page card to today twice (retry, then deliberate): one reference after the retry, two after the deliberate second Bring; the page's parent and follow-up state unchanged.
- **K9** Task chip with a date: planned day set; deadline untouched.

## 6. What would show this worked

- Brian uses the Calendar tab to look back at past days instead of opening Notion (ask after 3
  days; count Calendar opens per day).
- Tasks → Today and the day page never disagree (Ratchet check: same rows, same order, after any
  plan edit).
- Whether checklist-style task rows in project pages inflate "Still open" (signal for the Later plain checklist).
- Capture with Task or Page chips: share of captures that skip the AI, and confirmation edits on
  Auto captures.
