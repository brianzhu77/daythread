# Plan audit · engineering: approved specs vs main 24a1b4b

- Author: Roadbuster · 2026-10-19 · requested by the Lead (#daythread:b842c6d3 `5cd751d9`) after Brian's "review all items in the plan" (#daythread:9e538364 `a6b28f07`).
- Code checked: main `24a1b4b` (the build on 3000). Evidence is code reading plus one domain probe (below). No browser run. Items Jazz covers (editor F1–F18, §4 layout, v05 morning card, craft-v1, prelaunch list) are not repeated here.
- Specs checked: v0.3 `00-scope.md` round-1 scope items 1–13 and `01-flows-and-ux.md` §5, §6, §9; v0.4 `pages-delta.md` N-1 to N-9; `ADDENDUM-good-stuffs.md` G-1 to G-3; `date-navigation-rules.md` R1–R11 (branch product/date-rules); `editor-interaction.md` §1–3 (branch design/drag-and-dates).
- Status: **built**, **partial**, or **missing**. "Reachable" means a mounted screen calls it; `src/components/day-page.tsx` (`DayPage`) is **not mounted anywhere** since the editor replaced it, so commands called only from there count as unreachable.

## Probe

`/tmp/rb-daythread/audit/probe-goodstuffs.test.ts`: the editor saves a day page with a bare URL line in Good Stuffs (`save-editor`). Result: **0 materials**, and the block is stored as a plain `paragraph`. The material rule (v0.3 scope 3, 01 §6.1, P14) only runs in `add-text` (`workspace.ts:504`), which no mounted screen calls.

## Missing

| Spec item | Status | Evidence | Deferred with Brian's OK? |
| --- | --- | --- | --- |
| v0.4 N-2: `/page` creates a subpage and inserts a page card; Subpages list; nesting to any depth | missing | `types.ts:27` Page has no parent field; the "/" menu has only Task plus 7 BlockNote types (`page-editor.tsx:637-652`) | No. Brian asked for it (`3596b765`); step A in progress, paused for this audit |
| v0.4 N-2: Move (sidebar drag, Move to…) | missing | No move command (`workspace.ts` command list) | No |
| v0.4 N-1/N-3/N-4: pasted URL → link page with URL property; one page per URL (dedup key); Make page for inline URLs; link card | missing | Material is still a separate entity (`types.ts:84`); no URL property on Page; no paste handling for URLs (`page-editor.tsx:82-125` handles only our own block clipboard and checklists) | No. Brian's own words in pages-delta §1 |
| v0.4 N-5: "Linked from" under every page title | missing | No backlink query or UI in `src` | No ("链接回 today's thread") |
| v0.4 N-7 / v0.3 P06, P12: delete a page, trash, restore | missing | No delete-page/restore command; no ⋯ menu on pages | No |
| v0.4 N-9: sidebar tree, breadcrumb, phone Subpages navigation | missing | Sidebar lists document pages flat (`navigation.tsx:106`) | No |
| v0.3 scope 4 / 01 §6.2 / P03: `[[` page reference from any page | missing | `insert-reference` exists in the domain (`workspace.ts:780`) but nothing calls it; no `[[` trigger in the editor | No. Thin-slice flow 5 (01 §9) needs it |
| v0.3 01 §6.3: quote with source link | missing | No quote-with-source action | No |
| v0.3 P02: rename a page | missing | No rename command for pages; page title is a static `h1` (`pages-screen.tsx:23`) | No |
| v0.3 scope 13 / X12: JSON export | missing | Only `loadWorkspace` and `runCommand` server functions (`server/functions.ts`) | No |
| v0.3 scope 6, A18, A38: events as their own records (event date, untimed events) | missing in UI | `add-event` has no caller; simulated capture creates no events; no screen reads `workspace.events`. The Events section is plain text | No |

## Partial

| Spec item | Status | Evidence | Deferred with Brian's OK? |
| --- | --- | --- | --- |
| v0.3 scope 2 / 03 AI contract: capture parsed by a model, editable receipt, one confirmation for changes | partial: UI and transaction rules built, **no model connected** | Capture runs a simulated provider: "Simulated provider · no network request · no charge" (`workspace.ts:835-846`); no provider client anywhere in `src` | Not that I can find; the Lead should confirm whether "simulated first" was agreed with Brian |
| v0.3 scope 7 + 11, 03: review suggestions, "Draft my day", Related line | partial: flows built, output simulated | `start-the-day.tsx:57` and `facts-strip.tsx:145` show "Simulated" labels | Same as above |
| v0.3 scope 12 / D14: 10 USD/day budget | built in the domain, never exercised | `budget.ts` plus tests; no real call to guard | Moot until a model is connected |
| v0.3 scope 3 / 01 §6.1 / P14 / v0.4 N01: a link in Good Stuffs becomes saved material | partial: **regressed** | Works through capture "save this" only (`workspace.ts:923`). Through the editor, 0 materials (probe). The editor replaced `DayPage`, whose `add-text` held the rule | No. Regression from the editor migration |
| Addendum G-1/G-2: "Saved items" sort step in the review | built, but starved | UI built (`review-flow.tsx:141`, `223-275`). With the regression above, only captured links ever reach it | n/a |
| v0.3 scope 3: Pages lists and edits material | partial | Pages lists only document pages (`pages-screen.tsx:24`); no screen lists materials; they appear only in the review and the Related line | Pages-flat was Brian's call (`77423ea0`); material visibility was never discussed with him |
| v0.3 scope 5 / 01 §9.2: plan rows with Done / Not today / Another day | partial | In the editor, a plan row has the checkbox and delete → "Not today · deadline kept" (`page-editor.tsx:414`). Not today / Another day / Cancel are in the row menus on Tasks, the facts strip, the hand-off and the review (`task-row.tsx:88-93`), not on the day page itself | No |
| v0.3 scope 8: morning hand-off "Bring to today" for yesterday's other lines | partial | Tasks are offered; prose lines are not (`start-the-day.tsx:27`, "rules doc, visible controls"); `keep-block` has no caller | Dropped by team rule; I can't find Brian's OK. The Lead to confirm |
| Date rules R11: list blank pages auto-created by browsing, for Brian to decide | unverified | Not found in code or in my notes | — |

## Built (summary, with evidence)

- **Daily page and template** (scope 1, D01): `ensure-day`, `dayTemplate` (`editor-document.ts:4`), template rows on first open (`needsTemplateRows`).
- **Task identity, done, Not today on plan-row delete with Undo, cancel, reschedule** (scope 5): domain tests A09–A21 (`tests/ACCEPTANCE.md`); UI as described in "Partial" above.
- **Morning hand-off for tasks, Top 3 suggestions** (scope 8, 10): `start-the-day.tsx:41-49`.
- **Open pool, upcoming, Not today summary** (scope 9): `tasks-screen.tsx`, `facts-strip.tsx:79-126`.
- **Guided review steps, Saved items sort step** (scope 7, addendum): `review-flow.tsx`, at `/review`.
- **Durable saves, replay, stale-write rejection, SQLite** (scope 13 except export): `tests/repository.test.ts`, `tests/sqlite.test.ts`.
- **Date rules R1–R9**: feat/future-days `be749f6`, Ratchet and Jazz passed; **R10** held by the Lead's decision.
- **Editor §1–3** (heading drags its section, single-block drag, select and delete a section, phone drag, undo): step 1 `c424bb2` and heroui-screens `0859725`, Ratchet passed.
- **Tags** (Obsidian rule, Tags screens): `24a1b4b`, Ratchet #57/#61/#62/#63.

## What this means

1. The whole **v0.4 pages spec** (N-1 to N-9) was approved on Oct 16 and **none of it is built**. `/page` is one row of it. Brian's Oct 16 ask (paste a URL → a new page with the URL, linked back to the day) is also unbuilt.
2. The **editor migration dropped two v0.3 behaviours**: links in Good Stuffs no longer become saved material (so the sort step and Related starve), and there is no `[[` reference. Thin-slice flow 5 (01 §9) is broken end to end.
3. **No AI model is connected.** Capture, Draft my day, review suggestions and Related all run on the simulated provider. If Brian expects real AI, this is the biggest gap.
4. **Smaller missing items:** rename page, delete/trash page, JSON export, events as records.
