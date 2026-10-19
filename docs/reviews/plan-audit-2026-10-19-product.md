# Plan audit 2026-10-19 · Product: Brian's own asks vs specs vs main

Author: Bumblebee. Base: main `24a1b4b` (live on 3000). Scope: every requirement in Brian's own messages
(refs/02-user-quotes.md O-U01..O-U20 for Oct 13-14, Raft messages Oct 15 to Oct 19 02:10Z; 49 Raft messages read in full).
Build status here comes from a code read (file evidence given); Roadbuster's spec table and Jazz's screen check
are the authority where they differ.

Status: **built** / **partial** / **missing** / **deferred (Brian agreed)** / **deferred (team only)**.
"Deferred (team only)" means we moved it later without Brian saying so. Those are the ones he would call forgotten.

## Headline

The framework Brian approved on Oct 17 (product-framework-r2 §10 "First version", all marked Settled) has
six parts. On main, one is built (day thread), one is partial (predictions, no AI), and four are missing:
link pages from URLs, "Linked from", nesting / manual page creation, indexing + Weave. The team chose
"editor first" on Oct 17 06:33Z, then spent Oct 18 on tags. Nobody told Brian the rest of his first version had not
started. `/page` is one visible symptom of that.

## Table

| # | Brian's ask (source) | Where it landed | Status on main 24a1b4b | Evidence | Agreed to defer? |
|---|---|---|---|---|---|
| 1 | Paste a URL -> new empty page with the link as a property, linked back to today's thread (3596b765; e83b0640 "B") | pages-delta N-3, N-5; framework §10 First version | **missing** | `Page.type` is only `daily \| document` (src/domain/types.ts:29); URLs become Materials in Good Stuffs, not pages; no URL property | No |
| 2 | "Linked from" back to the day thread (3596b765 "链接回 today's thread") | pages-delta N-5 | **missing** | no `Linked from` / backlink anywhere in src | No |
| 3 | Arbitrary page nesting (3596b765 "任意页面嵌套") | pages-delta N-2 | **missing** | no `parentId` in `Page` (types.ts:27-54); Pages = flat list (6dfad4e) | No. Step B was planned "after A" on Oct 19 by the team only |
| 4 | Create pages by hand: in a folder, or `/` new page inside any page, like Notion (e526eb12; again 155a107d) | pages-delta N-2; framework §3 Settled | **missing** (sidebar "New page" makes a top-level page only) | page-editor.tsx:641 slash items = 7 BlockNote types + Task | No |
| 5 | Three page kinds: day thread, AI pages (Weave), your pages; copy a Weave page into your pages to edit (06469260 #6, c377e316 1b, 08a02686) | framework §3, §10 "AI pages, minimal: browse and copy" | **missing** (Weave) | no `weave` in src | No |
| 6 | Indexing: day thread -> Weave pages; corrections written in a thread fix the next run; user > AI weight (c377e316 1, 3) | framework §6 | **missing** | no model call anywhere; workspace.ts:846,851,977 "Simulated ... no model called" | No |
| 7 | AI involved only event-driven at plan and review (c377e316 3) | framework §6 | **missing** (no AI) | as #6 | No |
| 8 | Predictions MVP: yesterday's unfinished + items earlier scheduled for today (c377e316 5; O-U03 "第二天自动先生成一版当日计划"; O-U04) | framework §10; v05 morning card | **partial**: deterministic hand-off and Bring to today exist; no AI draft | start-the-day.tsx, task-row.tsx:88; draft is `simulated: true` (types.ts:49) | No |
| 9 | Natural-language entry; AI sorts and stores (O-U05, O-U10) | v0.3 capture | **partial**: capture exists, sorting simulated | capture.tsx; workspace.ts:846 | No |
| 10 | Real model: OpenRouter + GPT, 10 USD/day cap (O-U18, 7a55cbbf D-C) | v0.3 03, budget | **missing** (budget code exists, no provider) | src/domain/budget.ts; no OpenRouter in src | Pending: account/setup timing went to Brian Oct 17, no answer recorded. **Needs a question to him, not silence** |
| 11 | Day note = index page; give the LLM all linked context (7a55cbbf D-C) | v0.3 03 + Wheeljack E2 | **missing** (no LLM) | as #10 | No |
| 12 | Evening review with guidance + reminder (O-U03 1; 7a55cbbf D-B "经常会不记得，且没有一个 review 的引导") | v0.3 review flow; reminder = his repeating iOS reminder with link (78871f09 #2 "ok") | **built** (guided /review, `?from=reminder`) | routes/review.tsx, review-flow.tsx | iOS reminder is his to set up. Confirm he has it |
| 13 | Good Stuffs: follow-up per item, keep watching / lower priority, never forgotten (O-U03 2; 0f106fa5) | ADDENDUM-good-stuffs | **built** for Materials; per-page version (N-6) **missing** with #1 | review-flow.tsx | No |
| 14 | Future items show up on/near their date; Calendar view (O-U04) | v0.3 Upcoming; Calendar tab | **built** | domain/upcoming.ts, calendar-screen.tsx | n/a |
| 15 | Future days: no page; › disabled after today; calendar future greyed; create only from Calendar with warning (2d30b162 #4) | date rules R2-R7 | **built** | day-header.tsx:11-74, future-day.tsx, calendar-screen.tsx:18 | n/a |
| 16 | "Back to Today" not between the arrows (2d30b162 #3) | Jazz f853703 | **built** (Today button, hidden on today) | day-header.tsx:62 | n/a. Jazz checks the look |
| 17 | Page = markdown-like editor; delete a whole section; drag a heading moves its section (9ec597fb) | editor-interaction spec | **built** per Ratchet/Lead runs; Jazz re-checks F-list | page-editor.tsx | n/a |
| 18 | Drag: highlight what's lifted + thumbnail preview card instead of "Blocks x lines" (2d30b162 #1) | editor-interaction spec | **Jazz to confirm on screen**; I found press-tint code, no custom drag image | page-editor.tsx:427-466 | n/a |
| 19 | Template like Notion: TODO has empty `- [ ]`, other sections bullets, no per-section custom placeholders (65eaa340, f5da955a, 2d30b162 #2) | editor spec | **built** (bulletListItem default) | editor-document.ts:32; `templateApplied` | Jazz confirms on screen |
| 20 | Block-level query and reference like Notion (c5c9142e #1) | pages-delta §4 lists "block-level references" as **Later** | **partial**: only Task references | types.ts:11 `reference` kind is task-only | **Team only.** He asked on Oct 18; "Later" was our call |
| 21 | Tags: block-level, Obsidian rule, low-key UI, own module on both devices (c5c9142e #2, c11a5935, 5b496134, fad0b8c2 #4, 77423ea0, bc661669) | tags spec | **built** | 5c6f165 .. 24a1b4b | n/a |
| 22 | Tags help AI classify and steer the graph (d7974f8f) | Lead thread e36141c5 | **missing** (no AI) | as #6 | Depends on #6 |
| 23 | Craft-like UI, then HeroUI latest; open-source editor, no home-made wheels (8d0ab5da, cf3b03a8, 4ee0dce9) | craft-v1, HeroUI screens | **built** (HeroUI 3.2.6, BlockNote 0.56) | package.json | Jazz checks prelaunch list |
| 24 | Data-layer abstraction, SQLite now, Supabase later; debug logs on core flows (45f574bf) | — | **built** | server/repository.ts, sqlite-repository.ts, debug-log.ts | n/a |
| 25 | Phone and laptop both; phone check via Chrome viewport (bc661669, 53eba550) | — | **built** at 390 | 885b7c8 | Real-phone check paused by Brian (test only) |
| 26 | Page properties to carry types; reminders/calendar as later add-ons (06469260 #2, c377e316 4) | framework §10 add-ons | **missing** (no properties); add-ons **deferred (Brian agreed)** | types.ts Page has no properties | Properties: no. Needed for #1 (URL property) |
| 27 | TRMNL e-ink dashboard: Top 3, TODO, quotes (O-U02, O-U03 3) | framework §10 Later | **deferred** | — | He called it "not important" (O-U03 3), but never said "later". Confirm |
| 28 | Search and AI chat over pages (c377e316 1) | framework §10 Later | **deferred (Brian agreed)** | — | Yes, "MVP 不 build" |
| 29 | Structure is a suggestion/template, user edits freely (7c4e0cab, O-U06) | framework §5 | **built** | templateApplied | n/a |
| 30 | App Store later: avoid legal/compliance risk (08a02686) | framework compliance | **partial**: Craft look-alike replacement list exists; Weave trademark check not done | docs/design/craft-v1-prelaunch-replace.md | Not urgent; record |
| 31 | No Notion migration; manual sync OK; web app (O-U09) | v0.3 00 | **built** (by not doing it) | — | n/a |

## Gap list for the Lead (missing / partial that Brian did not agree to defer)

Ordered by how directly they hit what he asked for:

1. **#1 + #2 + #26 URL -> link page with URL property + "Linked from"**. His first concrete pages example (3596b765). Settled Oct 17.
2. **#3 + #4 nesting and `/page`**. Step A is in progress. Step B (tree, subpages) has no date and no Brian OK to wait.
3. **#6 + #7 + #10 + #11 real AI: indexing at plan/review, model + 10 USD cap**. Blocked on account setup. We asked him once (Oct 17) and dropped it. Ask again with a concrete setup step list.
4. **#5 Weave pages, minimal browse + copy**. Depends on 3.
5. **#8 / #9 AI morning draft and capture sorting**. The structure is built and the AI part is simulated. Depends on 3.
6. **#20 block-level references**. We put it in "Later" ourselves after he asked. Either build it or ask him.
7. **#18 drag thumbnail preview**. Jazz to confirm.
8. **#27 TRMNL** and **#12 his iOS reminder**: one-line confirms, no build.

## Process cause (for the Lead, not for Brian's list)

- The framework's "First version" was never turned into a tracked build list with owners. Build order changed to
  "editor first" on Oct 17 06:33Z (Lead, with my product points behind it, so this is partly my miss), and the
  rest had no task, no date and no "not started" flag in status reports.
- Status reports listed what passed review, not what was still missing against the approved scope.
- Suggested fix: keep one checklist file of the approved first version (rows above), update it on every freeze,
  and include "N of M first-version items built" in every status Brian sees.
