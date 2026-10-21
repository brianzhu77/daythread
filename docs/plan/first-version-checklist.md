# Daythread first version · tracked checklist

Owner: Bumblebee (Product). Created 2026-10-19 from the plan audit (`docs/reviews/plan-audit-2026-10-19-lead.md`).
Scope source: framework r2 §10 "First version", approved by Brian 2026-10-17 (all Settled), plus asks he made
after that (tags on Oct 18). Brian's latest message overrides this file; update it when he changes scope.

## Count

**Built: 17 of 20** (as of `7896ccc`, live on 3000, 2026-10-21).

Every status update to Brian quotes this line. Count rule: a row counts as built only when it is live on 3000
**and** has passed review (Ratchet's acceptance task linked in Evidence). "Partial" counts as not built.
Group B is listed for tracking only and never counts toward M.

## How to update

- The author of a change updates the row's Status and Evidence in the same commit as the code, or in a
  docs-only commit right after the deploy. Bumblebee re-checks the count at each deploy.
- Status values: `built` · `partial` · `missing` · `regressed` · `settled` (Brian accepted an alternative).
- Adding or removing a row needs a message from Brian, cited in Source. Team-only deferrals are not allowed.
- **Geometry rule for every visual change** (Brian 6220a8c2; Lead 4b3ce971, effective 2026-10-21): before a change is shown to
  anyone (Brian, a review, a deploy), measure all row types on the day page, not only the part that changed: heading, task
  (open, done, cancelled), bullet, nested bullet, page card with and without preview, link card, empty row. Use a copy of
  Brian's data at 1280 and 390. Pass = each row's text starts within 1px of its expected column (headings and nested rows
  have their own columns), and markers and icons (checkbox, dot, page icon, chevron, drag handle on hover) centre on the
  first text line within 1px, judged on unrounded coordinates. A row type his data doesn't have is added on the copy as a
  fixture or reported as missing, never as a pass (Ratchet 74c68e9d). The design check runs it with the repo's alignment script
  (pass/fail table, Roadbuster), and Ratchet's acceptance includes it. Tools: `scripts/align-fixtures.ts` on a copy (refuses
  the live path) adds a day with every row type through the app's own commands, then `node scripts/check-alignment.mjs <url>`
  must show 0 FAIL / 0 MISSING at 1280 and 390. Standard: docs/validation/visual-geometry-acceptance.md (Ratchet #88).
  Markers are measured as drawn (pixels): every level's size within 1px and gap to text within 1px of the top-level dot
  (added after Brian found nested bullets too small, ec2c2fe1; Ratchet #89 standard 03d6b8f). Small status marks (such as the picker's day dots)
  must reach at least 3:1 contrast against their own cell's fill, computed from colour and opacity (Lead f5c37a18, in check-alignment since 27200c3). Brian should not be the one who finds basic alignment
  or spacing defects.
- **Rollback rule** (Bumblebee 6505644c, Lead 45fbfd99): every rollback message to Brian tells him to **reload the page**. Since the tab refresh (c1ead10),
  an open tab ignores loads older than what it holds, so after a rollback to a lower revision it keeps showing content the server no longer has until reloaded.
- Each evidence script runs on its own fresh copy of Brian's data; scripts that write markers break each other's database checks (Lead, c1ead10 deploy).

## A. First version (counts toward N of M)

### Part 1 · Day thread is the source of truth

| ID | Item | Source | Status | Evidence |
|---|---|---|---|---|
| D1 | Daily page from an editable template (TODO with empty checkbox, other sections bullets) | 7c4e0cab, 65eaa340, f5da955a, 2d30b162 #2 | built | editor-document.ts:32, `templateApplied` |
| D2 | Tasks keep identity across days: hand-off of yesterday's open tasks, Not today, Upcoming, Calendar | O-U03, O-U04, 78871f09 | built | start-the-day.tsx, domain/upcoming.ts, calendar-screen.tsx |
| D3 | Guided evening review, opened from his iOS reminder link | O-U03, 7a55cbbf D-B, 78871f09 #2 | built | routes/review.tsx, review-flow.tsx |
| D4 | Date rules: no future pages unless created from Calendar; Today control | 2d30b162 #3, #4 | built | day-header.tsx, future-day.tsx (R1–R9) |
| D5 | Block editor like Notion/Craft: delete whole section, drag a heading with its section, native drag preview | 9ec597fb, 2d30b162 #1, task #48 | built | Ratchet #49; A10 settled here |
| D6 | Tags: Obsidian rule, low-key colour, own entry on laptop and phone | c11a5935, 5b496134, fad0b8c2, 77423ea0, bc661669 | built | 5c6f165 … 24a1b4b; Ratchet #62, #63 |
| A12 | Plan-row actions on the day page itself (Not today / Another day / Cancel) | v0.3 scope 5, 01 §9.2 | built | Before:  only in menus on Tasks, facts strip, hand-off, review. Plan docs/plan/a12-row-actions.md b67c49e (branch docs/a12-plan) passed (Ratchet #85; fix §5 Undo wording and test same-task-on-target-day + failed-request draft before code); states docs/design/day-row-actions-states.md 27763d3 (Jazz). Rulings: one-tap Tomorrow, Another day opens the picker; Not today = D05 = deleting the row (same command); Done stays the checkbox; notice with Undo puts the row back in its old section and position; reachable at 390 without hover; keyboard: ⌘/ (Ctrl+/) opens the caret row's menu, Shift+F10 / Menu key too, Tab keeps indenting (Lead b8ec39d5; Brian uses Chrome on macOS, Safari's ⌘/ untested); Top 3 full on target day → "Top 3 is full · added to {Section}"; stale row (task planned for another day) only removes this row, no pause, "Removed from {day} · still planned for {day} · Undo"; `from` removes the source row only on today/future pages, past pages keep it (Bumblebee 16ce6fe4 and follow-ups, Lead). Live 2026-10-21 as 7896ccc (Lead 89657c92, 3b4ef4cc; from f3daebd; backup before-7896ccc, rollback = build 9d0b7f3 + restart; Ratchet #91, docs/reviews/a12-row-actions-ratchet.md, ff33b25, 270 passed / 0 failed / 0 missing; Jazz design pass and combined picker + A12 check 0c1c1d2): ⋯ on hover or ⌘/ offers Tomorrow, Not today, This weekend, Next week, Pick date…, Move to Top 3, Cancel task; date moves, Not today and Cancel show a notice with Undo (⌘Z too), Move to Top 3 is a local row move with no notice, undone by ⌘Z (Ratchet 4f4f41ac); past days offer only Bring to today; Esc returns the caret to where it was. Success check after release: does he move tasks on the day page rather than the Tasks screen. His data can't tell (receipts have no time or entry point), so after a few days of use: check whether "Planned for …" moves rose, and ask Brian where he moved tasks from. No tracking added. Shipped separately from B19 |
| A5 | A link written under Good Stuffs becomes a saved item for follow-up (incl. titled links) | 0f106fa5; v0.3 P14 | built | 7f0de2d live 2026-10-19; Ratchet #66 (docs/reviews/goodstuffs-editor-ratchet.md) |

### Part 2 · Your pages, with saved links as link pages

| ID | Item | Source | Status | Evidence |
|---|---|---|---|---|
| A1a | `/` → Page inside any page (day pages included): page card at the cursor, parent recorded, opens with the cursor in an editable title, Back returns to the card | e526eb12, 155a107d; v0.4 N-2 | built | c8fb28a live 2026-10-19; Ratchet #64 (docs/reviews/page-slash-ratchet.md) |
| A1b | Nesting shown and managed: Subpages list, sidebar tree, Move, breadcrumb | 3596b765; v0.4 N-2, N-9 | built | 960d5d4 live 2026-10-19 (Lead fbfa9390); Ratchet #73 (docs/reviews/pages-tree-ratchet.md, re-checked on a copy of Brian's real data), Jazz design pass. Pages screen lists pages under days ("In your days"). Move is Move to… only, drag is B14. Delete with children is A4 (N-7). Known limit: Linked from order (B15) |
| A2 | Paste a URL → page with the URL as a property; one page per URL | 3596b765, e83b0640; v0.4 N-1, N-3, N-4 | built | 32ef34b live 2026-10-21 (Lead 038e7cf1, layout 5); Ratchet #82 (docs/reviews/a2-candidate-ratchet.md, b157465), Jazz design pass. Rollback = stop, scripts/sqlite-rollback-link-pages.ts, build 21eb45b. plan docs/plan/a2-url-page.md 46ba81b passed (Ratchet #81, report 01e36d1); states docs/design/link-pages-states.md 26a3625, design passed (Jazz). No fetching; page = card where pasted + child of that page, like `/page` (Lead ca10deaf); Good Stuffs pastes make pages too and the review lists them (Lead 5043b9c5); empty bullet counts; Undo checks only this paste's cards (Lead 2c2c1350). Migration 5 (`pages.url`) with rollback. A link copied from a page (one text-only `<a>`) is titled with its link text; media inside or beside it = normal paste (Lead aa5d532f, 06f5a617). Not tested: real iPhone, Safari's own clipboard. Watching: same site with and without `www.` makes two pages with the same default title (N-4; Lead 06f5a617). Capture-bar URLs: B18 |
| A3 | "Linked from" back to the day on every page | 3596b765; v0.4 N-5 | built | 960d5d4 live 2026-10-19, Ratchet #73. Real references only; the breadcrumb parent is not repeated; today shows as "Today" |
| A4 | Delete a document page to trash and restore it, with its subpages | v0.4 N-7 | built | 9936224 live 2026-10-20, layout 4 (Lead 2f917190); Ratchet #77 (docs/reviews/trash-ratchet.md: migration, rollback script round trip, atomic failure), Jazz design pass incl. nested pages. Document pages only; day pages can't be deleted (B16). Rollback = stop, scripts/sqlite-rollback-trash.ts, build 5193991, start (Undo cleared) |
| A9a | `[[` page reference (also `【【`), inline link, pick list incl. link pages, New page from `[[` | v0.3 scope 4, 01 §6.2; O-U11 | built | 9e432f3 live 2026-10-21 (Lead d9487ce9, layout 6); Ratchet #84 (docs/reviews/a9-candidate-ratchet.md, e3e149c), Jazz design pass. Rollback = stop, scripts/sqlite-rollback-page-links.ts, build 32ef34b. Links in headings count like any line (Lead 0552bbc0). Plan docs/plan/a9-page-links.md a9e0842 passed (Ratchet #83, report 0a5462d); states docs/design/page-links-states.md b8f985e, design passed (Jazz). Ships with B15 (Lead a5a33307). Inline `pageRef` node = format change, layout 6 with rollback to plain in-app links (Lead 6db69cd3). Empty `[[` list ranked by newest reference, same on every device. Not yet tested: a real Chinese input method (Lead asked Brian to try `【【`, fbbae5f5) |
| A9b | Quote with source: pasted text from another page offers "Add source" → Quote with "— [link]" (v0.3 P03) | v0.3 scope 4, 01 §6.3; O-U11 | dropped | Next round after A9a (Lead a5a33307); depends on whether an in-app copy can carry the source page id (plan §7 to answer). States in page-links-states.md §4. Scope as small as §4: one paste notice, nothing extra; clipboard experiment first; no code until Brian answers whether he copies passages between pages (Lead bf4cb359, 4274a5e6). If no, A9b moves behind B20 and the plan stays on its docs branch. No evidence of the habit yet: his data on 2026-10-21 has 0 quotes and no copied prose (Bumblebee c3a575fa). Success check after release: at least one quote with a source line on his real data within about 5 writing days **Dropped 2026-10-21:** Brian copies between pages and prefers Notion's model (7b89f7c9): plain copy stays as today with no source, and live sharing is a synced block he makes himself (Lead dfcb04d4, 072a7ee4). Plan parked on docs/a9b-plan 631de44; design §4 marked dropped (Jazz 3c3607d); Ratchet #93 closed as moot. Not counted |
| A11 | Block-level references | c5c9142e #1 | missing | moved to Later by the team without asking; build or ask Brian |

### Part 3 · Indexing at plan and review · Part 5 · Weave (minimal: browse and copy)

| ID | Item | Source | Status | Evidence |
|---|---|---|---|---|
| A6a | Real model (OpenRouter, 10 USD/day cap) behind capture: auto-save with receipt, grounding holds, edit/Undo all | O-U18, 7a55cbbf D-C, c377e316 | built | ca4c4ca live 2026-10-19 15:34Z; Step 1 a 33e1d38 Ratchet #68, b 25dc72a #69, c Ratchet #70 (docs/reviews/model-receipt-ratchet.md) + design check acdfa91; smoke 7/7. Probe weak, accepted risk (Brian yes 9f3f3f82). Context: his text + open tasks |
| A6b-1 | Real model behind Draft my day and the morning card's "From your notes" proposals, on a tap only (morning-card-build.md §11 step 3, step 1) | O-U18, 7a55cbbf D-C, c377e316; 7c4e0cab | built | 21eb45b live 2026-10-20 (Lead 2edb2589); Ratchet #80 (docs/reviews/model-draft-ratchet.md, b3dfa2f), Jazz design pass on b3dfa2f. Plan a902b05 (Ratchet #79), states docs/design/morning-model-states.md. Pre-release real-model run on a copy of his data: $0.000681, "后天" on Oct 19 planned for Wed, Oct 21. Drafted tasks go to TODO - Other; dated proposals are planned for their day. Not tested: real iPhone with Chinese input; real-model value is judged by the 5-writing-day check from Oct 22 (new tasks offered, proposals offered, what he added; used on >=2 mornings). Proposals moved here from A8 on 2026-10-19 (Lead e602d3b1) |
| A6b-2 | Real model behind review suggestions and Related (morning-card-build.md §11 step 3, step 2) | O-U18, 7a55cbbf D-C, c377e316 | missing | Waits for the 5-writing-day check on A6b-1 (Lead 2edb2589). Still simulated. Context: one hop of linked pages + previous daily page; transitive later, Brian told. Brian wants capture (3097861f) |
| A7 | Indexing at plan/review into Weave pages; browse; copy to your pages; corrections in a thread fix the next run | 06469260, c377e316, 08a02686 | missing | waits on A6; layout A chosen (C2); context: Step 2 (one hop + previous daily page) |

### Part 4 · Predictions: yesterday's unfinished + items scheduled for today

| ID | Item | Source | Status | Evidence |
|---|---|---|---|---|
| A8 | Morning card per v05 design (merged suggestions with reason, Undo) + Bring to today for plain lines | 7c4e0cab (O4=b), 78871f09 | built | 5193991 live 2026-10-19 (Lead 3600952d); Ratchet #75 (docs/reviews/morning-card-ratchet.md, copy of Brian's real data), Jazz design pass. Text and link lines only; a brought line stays brought after its copy is deleted, Undo re-offers it; every card write saves the editor first. "From your notes" proposals are in A6b-1. Not tested: real iPhone with Chinese input. Blank "Unfinished" row from an empty-titled draft task fixed in 53c1b83 (Ratchet #78); "N other open tasks" leaves out tasks shown on the card |

Count: M = D1–D6 + A1a, A1b, A2–A5, A6a, A6b-1, A6b-2, A7, A8, A9a, A9b, A11, A12 = 21. A10 (drag preview) is settled inside D5, not a separate row.
A1 was split into A1a/A1b on 2026-10-19 when `/page` shipped (same sources, no scope change), so M went 17 → 18.
A6 was split into A6a/A6b on 2026-10-19 when capture went live on the real model (same sources, no scope change), so M went 18 → 19.
A4 narrowed to document pages on 2026-10-19 (Lead 5598fdab); deleting daily pages is B16. M unchanged.
A6b was split into A6b-1/A6b-2 on 2026-10-20 when step 1 went live (same sources, no scope change), so M went 19 → 20.

A9b dropped on 2026-10-21 (Brian 7b89f7c9, Lead 072a7ee4): replaced by the synced block, tracked as B21 until Brian says first version or after, so M went 21 → 20.
A9 was split into A9a/A9b on 2026-10-21 when quote with source was moved to the round after `[[` (Lead a5a33307; same sources, no scope change), so M went 20 → 21.

A8's proposals for text lines moved to A6b on 2026-10-19 (they need the real model; same sources); M unchanged.
A1b dropped "delete with children" on 2026-10-19 because A4 already covers it (N-7, trash and restore with subpages); M unchanged.
N = D1–D6 + A5 + A1a, A1b, A3 + A4 + A6a + A8 = 13.

## B. In our own specs, Brian never named them (tracked, not counted)

| ID | Item | Source | Status |
|---|---|---|---|
| B1 | Rename page | v0.3 P02 | built (c8fb28a, editable title; Ratchet #64) |
| B2 | Events as records | v0.3 scope 6 | missing |
| B3 | JSON export | v0.3 scope 13 | missing |
| B4 | "/" menu Link and Separator; "Paragraph" → "Body" | editor spec F13 | missing |
| B5 | Phone toolbar: Aa, indent/outdent, hide keyboard | editor spec F16 | partial |
| B6 | Dark mode | craft-v1 | missing |
| B7 | Review as a sheet | craft-v1 step 5 | missing |
| B8 | Capture type chips Auto · Task · Page | craft-v1; C4 = Auto | missing |
| B9 | One loading message on first open | design audit | missing |
| B10 | Notes: explicit "Save" for a link | v0.3 P16 | missing |
| B11 | Craft-colour replacement before any App Store build | prelaunch list, 08a02686 | not started (pre-launch only) |
| B12 | Past day without a page shows "Nothing written · Start this page" (date rule R10, team addition) | date-navigation-rules R10 | built; Brian may veto |
| B13 | Capture receipt follow-ups after Step 1 (receipt-v2-design-check.md, Lead 85852c23): (1) no-key capture still shows the v1 receipt; (3) an older receipt shows its capture-time date, should show the task's current date; (4) a held row saved without fixing keeps its reason chip, drop it on Save; (5) inline refusal copy: "Task changed; not applied" → "Task changed since · not applied", "… not found" → "Item no longer exists" (Bumblebee 77b32429) | Jazz design check acdfa91 | missing (after Step 1 deploy) |
| B14 | Sidebar tree drag: move a page by dragging it, and manual sibling order by drag (N-2 lines 64, 67) | pages-delta N-2; Lead c000dc41, dd5e347 | missing (left out of Step B; Move to… covers moving) |
| B15 | Linked from: document entries ordered by when the reference was made (N-5 "newest first"); today they follow page order, so a move reshuffles them. Needs a stored time on reference blocks (column + migration); do it in the same round as A9 `[[` references | pages-delta N-5; Lead 4b587c39 + 6bea449 ruling, Roadbuster 97171952 | built (9e432f3 live 2026-10-21, Ratchet #84, with A9a); older references frozen in today's order at upgrade (Jazz 377f955) |
| B16 | Delete a daily page with its subpages; hand-off still counts its placements, its prose isn't offered for Bring, "(removed)" sources, P12 restore on reopening the date (N-7 lines 180-186) | pages-delta N-7, 04 P12; Lead 5598fdab | missing (left out of A4; touches the morning card) |
| B17 | Trash style fixes: 390 Trash row wraps so the time shows, trashed page Subpages in `--ink-2`, 1280 hover covers Restore. Optional: wrap only at " · " | Jazz ac552a0d, 40e03d46 | built (53c1b83 live 2026-10-20). Optional " · " wrap still open |
| B18 | URLs from the capture bar make link pages (one page per URL) instead of saved items, so the two kinds of saved link don't drift apart | pages-delta N-1/N-4; Jazz 90dfd91 §1 cut, Lead 043d101e | missing (cut from A2; he has never used capture) |
| B19 | UI polish from Brian's comparison with Notion and Craft: done tasks greyed (strikethrough per his pick), smaller headings and spacing, deeper nested indent, no blue bar left of TODO groups (Jazz); page-card preview line per v0.3 "title + short preview", empty template lines hidden on past days, render only (Roadbuster) | Brian afb0c665; Lead 2ea283a3, a2edc0a7 | built: ad6d83d live 2026-10-21 (Lead d6d6fec7, d35259b2; no migration, layout 6; backup .daythread-local/backups/2026-10-21-before-ad6d83d; rollback = build 9e432f3 + restart, no data steps). Ratchet #86 (docs/reviews/b19-polish-ratchet.md, 7e04609), Jazz design pass. Done tasks = strikethrough + grey (Lead's default, Brian didn't pick; one setting to switch to grey only). Card title semibold (Lead 9bd8d728); preview = page's first line, his recipe pages show "#recipe"; trashed page = no preview. Past-day empty rows hidden on screen only. ↓ from a heading on a past day skipped the hidden rows (Lead 474d7849): fixed d513d39, live as d3ad709 (Lead e65d588f, 12e2dba1; backup before-d3ad709, rollback = build ad6d83d + restart), Ratchet #87 (docs/reviews/past-heading-down-ratchet.md, 1cc1f21); entering a heading reveals its section's hidden rows. Brian found the page icon centred on title + preview instead of the title line (6220a8c2): alignment release 29481c3 live 2026-10-21 (Lead 42286e2f, b51edfe5; backup before-29481c3, rollback = build d3ad709 + restart; Ratchet #88, docs/reviews/b19-alignment-ratchet.md, f67117c): card icon in the marker column, title on the text column, icon/chevron on the first line, long titles wrap, link cards keep one-line ellipsis, phone task gap matches bullets; led to the geometry rule under How to update. Nested bullets (Brian ec2c2fe1, too small, use Craft's sizes): a697f14 live 2026-10-21 (Lead 1d0a635f, 850d7cf9; backup before-a697f14, rollback = build 29481c3 + restart; Ratchet #89, docs/reviews/b19-nested-markers-ratchet.md, 03d6b8f): level 2 = 6px ring, level 3+ = 5px square, all 19px from text, 24px per level. Neutral day nav (Brian 116a40ab, picked A 4ac98b29): Today and arrows black on grey instead of blue, checkboxes stay the page's only blue (= done), disabled → on today light grey; 78d18cb live 2026-10-21 (Lead 97a2ff27, 54944e51; backup before-78d18cb, rollback = build a697f14 + restart; Ratchet #90, docs/reviews/day-nav-neutral-ratchet.md, 6292bb2; contrast 14.28:1, hover 13.02:1). Day picker (Brian a6bd90e4; future days preview per Lead bf158449, Brian f092ae63): past days and today open with a plain page, future days are grey and clickable and open the preview with "Create page" (nothing created until pressed), a dot marks days with something written; dots at least 3:1 against their cell (plain 3.6:1, today 5.1:1, selected 3.6:1); 3617d5d live 2026-10-21 (Lead 865badbd; backup before-3617d5d, rollback = build 147e8a6 + restart; Ratchet #92, docs/reviews/day-picker-ratchet.md, 9c6869a, 288 passed / 0 failed / 0 missing). Awaiting Brian's acceptance |
| B20 | Left out of the B19 round (Lead f540ab5f): move the floating + button, which at 390 covers text when its menu is open (seen under 奥德赛 on Oct 18, Lead 9bd8d728); sidebar "2 pages in your days" doesn't name the pages; grey vertical guide line under nested bullets, which Craft and Notion don't draw: kept for now since Brian didn't ask (Lead db4692d0), removal parked on design/no-guide-line 67e67e4 (Jazz); the line stays (Lead 0b879b56). Round assigned to Jazz 2026-10-21 (Lead 0b879b56): items 1 and 2, before/after on a copy at 1280/390, check-alignment 0/0, Ratchet review | Brian afb0c665 comparison; Lead f540ab5f, 9bd8d728 | building (Jazz) |
| B21 | Synced block (Notion model): select blocks → "Turn into synced block" → copy → paste on another page; both places show the same content, an edit in either shows in both, each copy can be unsynced. Copied text never re-syncs **except** in a synced block he creates himself (v0.3 §6.3 exception, Lead 072a7ee4). Open: tasks inside one (a task belongs to one day; "no tasks inside, first version" acceptable), deleting or trashing the original, Linked from, Undo, format bump and rollback. Order: Roadbuster checks plain copy on a copy of his data (headings, bullets, nested bullets, tasks, `[[` links; copying a task row makes a separate new task), Jazz states doc, Roadbuster risk experiment + plan with size, Ratchet pre-review; then Lead asks Brian "first version or after" with the cost. Brian named it, but it stays in B until he picks first version | Brian 7b89f7c9; Lead dfcb04d4, 072a7ee4 | missing (planning) |
| B22 | Copied task keeps its identity: pasting a task row pastes a **reference row** to the same task (A12 states §1, the existing row type with its menu), not a new task, so ticking it ticks the one task on every page; the notice offers "Pasted as the same task · Make a copy" for when he wants a separate task (Jazz 8561624e, Lead bf166022). The task keeps its own plan day, so the one-day rule holds. Separate from B21; tasks stay out of synced blocks even then. Today a paste makes a new, separate task (Roadbuster copy check b086b86, 25/25; told to Brian 95be492d, fc54f9a7) | Brian fb1fda77 ("ok, improve later") | later |
| B23 | "Draft kept" split (after B20, about a day, Roadbuster): network/server failure keeps "Couldn't save · Retry saving · Copy draft"; a conflict (page changed in another tab) gets **Load latest**: loads the page and puts his changes below their lines as ordinary lines, "Latest loaded · your changes are below their lines · Undo"; no clipboard (Bumblebee cda199db; same rule as the B21 conflict). His changes = lines that differ from the save's starting point, not from the latest (Jazz 14b0d3a9); new tasks he added stay tasks, tasks already in the latest are not repeated (Bumblebee 79df4242), except a renamed one, which comes back as a plain line with his title under the task (Roadbuster dd2536db). Must clear the browser's saved draft once his version is in the page, or a reload conflicts again (Roadbuster 12c8dc5e notes 1-4 = engineering spec). States: docs/design/save-conflict-states.md ce54bfd (Jazz) | Jazz 7bacfe99, b76290d5; Lead 8781f41f | building (Roadbuster, fix/b23-load-latest, in parallel with B20 per Lead 0b879b56) |
| B24 | Tab refresh: switching back to a tab (or the window regaining focus, at most every 5s) saves what was typed first, then loads the latest; a refused save keeps the draft ("changed elsewhere · draft kept"); a load older than the tab's last save is dropped. Found while planning B21 (Roadbuster); a stale tab could never silently overwrite a newer edit even before (two-tab check 3). c1ead10 live 2026-10-21 (Lead 457533aa, 45fbfd99; from 596bf9a; backup before-c1ead10, rollback = build ec9fcd5 + restart, then tell Brian to reload; Ratchet #95, docs/reviews/refresh-on-visible-ratchet.md, aac515d; Chromium 1280 and WebKit 390, Jazz WebKit run). Not checked on a real iPhone: phone access isn't set up; when it is, ask Brian to edit on the Mac and switch to the phone | Lead c02857fc | built |

## C. Open questions for Brian

Asked 2026-10-19 02:18Z (9e538364 572b3c3a); Brian answered 02:20Z (a4fd5686). Re-ask any future question within 24 h if unanswered.

| ID | Question | Recommended | Answer |
|---|---|---|---|
| C1 | OpenRouter key for a real model, now | yes | yes; asked where to put it (a4fd5686) |
| C2 | Weave layout A (Mine \| Weave in Pages) or B | A | A (a4fd5686) |
| C3 | Checkbox on an ordinary page: plain checklist + "Make task", or always a task | checklist | checklist (a4fd5686) |
| C4 | Capture default type Auto | yes | yes (a4fd5686) |
| C5 | Restore Bring to today for plain lines | yes | yes (a4fd5686) |
