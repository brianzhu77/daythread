# Plan audit · Lead summary (merged)

- Author: OptimusPrime · 2026-10-19 · for Brian's "review all items in the plan" (#daythread:9e538364 `a6b28f07`).
- Inputs: engineering (Roadbuster, `plan-audit-2026-10-19-engineering.md`, commit b4f7ecc), asks vs specs (Bumblebee, `plan-audit-2026-10-19-asks.md`, 75d456c), design vs screen (Jazz, `plan-audit-2026-10-19-design.md`), Ratchet's independent cross-check (`plan-audit-2026-10-19-reviewer.md`, test/ratchet-tags 84c04ff: agrees on pages/lifecycle, slash Page/Link/Separator, F16, budget helper never called by the app, no model/Weave; drag preview = replaced, not missing), and my own pass over v0.4 pages-delta, framework r2 §10 and Brian's database (read-only copy of the 2026-10-18-before-24a1b4b backup).
- Code audited: main `24a1b4b`, the build on port 3000.

## Headline

Brian approved the first version on 2026-10-17 (framework r2 §10, all Settled): day thread as source of truth · pages with saved links as link pages · indexing at plan and review · predictions (yesterday's unfinished + today's scheduled) · minimal AI pages (Weave). Of these, only the day thread is fully built; predictions are partial (tasks only, old card). Pages, indexing, Weave and real AI are not started. No message from Brian defers any of them.

Root cause (Lead): the 2026-10-17 06:10Z work order (1 pages, 2 editor, 3 morning suggestions, 4 Weave) was never confirmed by Brian; his 06:31Z feedback made the editor first (`f41bd4ff`). After the editor the team went to R1–R11 polish, HeroUI screens, the shift fix and tags (his Oct 18 ask) and never returned to item 1. Status reports listed only what passed review, so the gap was invisible. The first version never became a tracked checklist.

## A. Brian asked for it, not built or partial (no deferral from him)

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| A1 | Pages: nesting any depth, `/page` + page card, Subpages, Move, sidebar tree, breadcrumb | `3596b765`, `e526eb12`; v0.4 N-2, N-9 | missing | `types.ts:27` Page has no parent; "/" menu = Task + 7 BlockNote items |
| A2 | Paste URL → link page with URL property, linked back to the day; one page per URL; Make page; link card | `3596b765`, `e83b0640`; v0.4 N-1, N-3, N-4 | missing | Material still separate (`types.ts:82`); no URL on Page; no paste handling |
| A3 | "Linked from" on every page | "链接回 today's thread"; v0.4 N-5 | missing | no backlink query or UI |
| A4 | Delete page → trash, restore subtree | v0.4 N-7, v0.3 P06/P12 | missing | no delete-page/restore command |
| A5 | Regression: a link in Good Stuffs becomes saved material (follow-up, "never forgotten") | `0f106fa5`; v0.3 scope 3, P14 | regressed | domain probe: editor save with bare URL in Good Stuffs → 0 materials; rule lives in `add-text`, only old `DayPage` called it. Brian's data: 0 URLs in any page, 0 materials → nothing lost yet |
| A6 | Real AI: capture parsing, Draft my day, review suggestions, Related via a model with 10 USD/day cap | `c377e316`, `7a55cbbf`; v0.3 scope 2/7/11/12 | partial | all paths on simulated provider (`workspace.ts:835-846`); blocked on account setup asked 2026-10-17, never re-asked |
| A7 | Indexing at plan/review + Weave pages (browse, copy) | framework §10; v0.5 draft | not started | depends on A6; Weave A/B never answered |
| A8 | Morning card per v05 design (merged suggestions with reason, Proposals for text lines, round +, Undo) and "Bring to today" for plain lines | `7c4e0cab` (O4=b), `78871f09` | partial | old Keep/Keep all card; prose lines dropped by team rule (`start-the-day.tsx:27`), no Brian OK |
| A9 | `[[` page reference; quote with source | v0.3 scope 4, 01 §6.2/6.3 | missing | `insert-reference` exists (`workspace.ts:780`), nothing calls it |
| A10 | Drag preview thumbnail + selection marking | `2d30b162` #1 | settled, not owed | Brian approved task #48 (native real-content preview + press highlight) at 2026-10-17 21:59Z; Ratchet #49 verified. Corrected after Ratchet/Bumblebee; listed only so the record is complete |
| A11 | Block-level references | `c5c9142e` (Oct 18) | missing | put under Later by us, not asked |
| A12 | Plan-row actions on the day page (Not today / Another day / Cancel) | v0.3 scope 5, 01 §9.2 | partial | only in menus on Tasks, facts strip, hand-off, review |

## B. In our own specs, Brian never named (do after A)

Rename page (P02) · events as records (scope 6) · JSON export (scope 13) · "/" menu Link and Separator, "Paragraph" → "Body" (F13) · phone toolbar Aa, indent/outdent, hide keyboard (F16) · dark mode · review as sheet (craft-v1 step 5) · capture chips Auto · Task · Page (waits on C5) · two loading messages on first open · Craft-colour replacement before any App Store build · R11 verification (my notes: done, all blank, skipped).

## C. Questions only Brian can answer (recommended defaults)

1. Model account: an OpenRouter key (and Supabase/hosting later, when the app leaves his Mac). Recommend: provide now; everything in A6/A7 waits on it.
2. Weave layout A (Mine | Weave pills in Pages) or B. Recommend A.
3. C4: a checkbox on an ordinary page = plain checklist + "Make task" (recommend) or always a task.
4. C5: capture default type Auto (recommend).
5. Bring to today for plain lines: restore (recommend).

## D. Build order (proposed)

1. A5 regression fix, with a domain test and a rescan of existing Good Stuffs URLs (small, first).
2. A1 step A (`/page`, resumes now) → A2 link pages + A3 Linked from → A4 delete/restore, Move, tree (rest of N-1…N-9).
3. A8 morning card + Bring to today (one item).
4. A9 `[[` refs, A12 row actions, A11 block refs (or ask). A10 is settled.
5. A6 real model once the key arrives → A7 indexing and Weave.
6. Group B.

Every item goes live after review under Brian's auto-deploy rule. Every status update to Brian states "N of M first-version items built" against a tracked checklist (owner: Bumblebee).

## Process fixes

- First version becomes a tracked checklist file; status reports count against it.
- Jazz's editor spec gets a docs-only merge to main (it lives only on design/drag-and-dates).
- Open questions for Brian are re-asked within 24 h, not dropped.
