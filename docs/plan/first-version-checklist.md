# Daythread first version · tracked checklist

Owner: Bumblebee (Product). Created 2026-10-19 from the plan audit (`docs/reviews/plan-audit-2026-10-19-lead.md`).
Scope source: framework r2 §10 "First version", approved by Brian 2026-10-17 (all Settled), plus asks he made
after that (tags on Oct 18). Brian's latest message overrides this file; update it when he changes scope.

## Count

**Built: 8 of 18** (as of `c8fb28a`, live on 3000, 2026-10-19).

Every status update to Brian quotes this line. Count rule: a row counts as built only when it is live on 3000
**and** has passed review (Ratchet's acceptance task linked in Evidence). "Partial" counts as not built.
Group B is listed for tracking only and never counts toward M.

## How to update

- The author of a change updates the row's Status and Evidence in the same commit as the code, or in a
  docs-only commit right after the deploy. Bumblebee re-checks the count at each deploy.
- Status values: `built` · `partial` · `missing` · `regressed` · `settled` (Brian accepted an alternative).
- Adding or removing a row needs a message from Brian, cited in Source. Team-only deferrals are not allowed.

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
| A12 | Plan-row actions on the day page itself (Not today / Another day / Cancel) | v0.3 scope 5, 01 §9.2 | partial | only in menus on Tasks, facts strip, hand-off, review |
| A5 | A link written under Good Stuffs becomes a saved item for follow-up (incl. titled links) | 0f106fa5; v0.3 P14 | built | 7f0de2d live 2026-10-19; Ratchet #66 (docs/reviews/goodstuffs-editor-ratchet.md) |

### Part 2 · Your pages, with saved links as link pages

| ID | Item | Source | Status | Evidence |
|---|---|---|---|---|
| A1a | `/` → Page inside any page (day pages included): page card at the cursor, parent recorded, opens with the cursor in an editable title, Back returns to the card | e526eb12, 155a107d; v0.4 N-2 | built | c8fb28a live 2026-10-19; Ratchet #64 (docs/reviews/page-slash-ratchet.md) |
| A1b | Nesting shown and managed: Subpages list, sidebar tree, Move, breadcrumb, delete with children | 3596b765; v0.4 N-2, N-7, N-9 | missing | step B; parentId already stored since c8fb28a |
| A2 | Paste a URL → page with the URL as a property; one page per URL | 3596b765, e83b0640; v0.4 N-1, N-3, N-4 | missing | Page.type = daily/document only |
| A3 | "Linked from" back to the day on every page | 3596b765; v0.4 N-5 | missing | — |
| A4 | Delete a page to trash and restore it, with its subpages | v0.4 N-7 | missing | — |
| A9 | `[[` page reference; quote with source | v0.3 scope 4, 01 §6.2 | missing | `insert-reference` has no caller |
| A11 | Block-level references | c5c9142e #1 | missing | moved to Later by the team without asking; build or ask Brian |

### Part 3 · Indexing at plan and review · Part 5 · Weave (minimal: browse and copy)

| ID | Item | Source | Status | Evidence |
|---|---|---|---|---|
| A6 | Real model (OpenRouter, 10 USD/day cap) behind capture, Draft my day, review suggestions, Related | O-U18, 7a55cbbf D-C, c377e316 | partial | simulated provider only; **Brian yes (9f3f3f82); Step 1: (a) 33e1d38 Ratchet #68 + (b) 25dc72a Ratchet #69 reviewed; (c) receipt UI building**; probe weak (accepted risk; step 0 recount 6522522: 6 critical calls of 45 on his model, Luna also weak). Context: capture = his text + open tasks (step 1); one hop of linked pages + previous daily page in step 2 (Draft my day / proposals); transitive later, Brian told |
| A7 | Indexing at plan/review into Weave pages; browse; copy to your pages; corrections in a thread fix the next run | 06469260, c377e316, 08a02686 | missing | waits on A6; layout A chosen (C2); context: Step 2 (one hop + previous daily page) |

### Part 4 · Predictions: yesterday's unfinished + items scheduled for today

| ID | Item | Source | Status | Evidence |
|---|---|---|---|---|
| A8 | Morning card per v05 design (merged suggestions with reason, proposals for text lines, Undo) + Bring to today for plain lines | 7c4e0cab (O4=b), 78871f09 | partial | old Keep / Keep all card; plain lines dropped by team rule (start-the-day.tsx:27); unblocked (C5 yes) |

Count: M = D1–D6 + A1a, A1b, A2–A9, A11, A12 = 18. A10 (drag preview) is settled inside D5, not a separate row.
A1 was split into A1a/A1b on 2026-10-19 when `/page` shipped (same sources, no scope change), so M went 17 → 18.
N = D1–D6 + A5 + A1a = 8.

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
| B13 | Capture receipt follow-ups after Step 1 (receipt-v2-design-check.md, Lead 85852c23): (1) no-key capture still shows the v1 receipt; (3) an older receipt shows its capture-time date, should show the task's current date; (4) a held row saved without fixing keeps its reason chip, drop it on Save | Jazz design check acdfa91 | missing (after Step 1 deploy) |

## C. Open questions for Brian

Asked 2026-10-19 02:18Z (9e538364 572b3c3a); Brian answered 02:20Z (a4fd5686). Re-ask any future question within 24 h if unanswered.

| ID | Question | Recommended | Answer |
|---|---|---|---|
| C1 | OpenRouter key for a real model, now | yes | yes; asked where to put it (a4fd5686) |
| C2 | Weave layout A (Mine \| Weave in Pages) or B | A | A (a4fd5686) |
| C3 | Checkbox on an ordinary page: plain checklist + "Make task", or always a task | checklist | checklist (a4fd5686) |
| C4 | Capture default type Auto | yes | yes (a4fd5686) |
| C5 | Restore Bring to today for plain lines | yes | yes (a4fd5686) |
