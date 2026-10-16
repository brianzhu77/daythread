# 00 · Scope and decisions — v0.2 draft

Status: **unapproved draft** (task #7, owner Bumblebee, reviewer Ratchet). It revises
`docs/specs/00-scope.md` (v0.1, unchanged on disk) according to
`docs/reviews/round-1/synthesis.md` R1–R11. Nothing here has been prototyped, run, or tested.
Paragraphs that depend on the page layout are written as **[Layout A]** and **[Layout B]**;
they are decided in the prototype session (04 §V2), not by this document.

## Change log (v0.1 → v0.2)

| Ref | Change in this file |
| --- | --- |
| R1 | D01/D02/D05/D09 rewritten: Task holds facts, `DailyPlacement` holds the day's selection, blocks are presentation. Placement row and ordinary reference are distinct. "Not today" is an explicit action; editor deletion never changes a task. Layout A/B variants added. |
| R2 | D06 replaced by the open-pool rule. The cap of 3 limits display only. New invariant I1. |
| R3 | D07 rewritten: no AI call when a page opens; drafts are produced at review time or on request. |
| R4 | D04 extended: AI changes to existing items need one inline confirmation; new items apply with a receipt; direct UI actions never confirm. |
| R5 | New D12: the entry point decides "my words" vs. "material". |
| R7 | U02 annotated: whole-workspace context becomes bounded context (titles plus excerpts). New D13. |
| R8 | Resurfacing of saved material added as a tested candidate (§Round-1 scope, item 10). |
| R9 | "What success means" replaced by a baseline, candidate thresholds, and fail signals. |
| R10 | Cut list updated; Top 3 markup added; block-level references kept pending Brian. |
| R11 | "Before implementation" replaced by the validate → revise → thin-slice order. |
| Wording | Stack items moved from "user confirmed" to "preference". Every requirement is tagged by kind. |

## Product goal

Brian starts each day from a page that is already prepared and freely editable, and spends
less effort planning, recalling open commitments, and finding saved material. Tasks and
material persist; the daily page ties them together.

Round 1 serves one user (Brian) in a real trial. It tests whether the daily loop is worth
using and whether it is predictable. It does not aim for recommendation accuracy, an
automatic knowledge base, or editor breadth.

## Kinds used in this file

**Goal** = Brian's stated need · **Preference** = stated technical or product preference,
kept as the default and open to evidence · **Design** = a team choice in this spec ·
**Hypothesis** = untested claim, with the check that tests it.

## Brian's stated needs and preferences

| ID | Content | Kind | Note for v0.2 |
| --- | --- | --- | --- |
| U01 | A standalone web app is fine. No Notion migration or sync; manual carry-over is acceptable. | Goal | Unchanged. |
| U02 | Keep natural-language input. Pass input and existing information to the AI; no prompt, retrieval, or context optimisation in v1. | Preference | v0.2 bounds the context (D13) because whole-workspace context fails as material grows (R7). This is a proposed revision of the preference; Brian sees it in the synthesis. |
| U03 | Home is the daily entry point: a suggested free-writing page that includes today's plan, editable. | Goal | How "plan" and "free writing" share the page is the layout question (D01). |
| U04 | Future items come back on, or near, their date. | Goal | Unchanged. |
| U05 | Review connects to the next day's plan and reduces planning and recall effort. | Goal | Unchanged. |
| U06 | Removing items from today must not build an ever-growing list to maintain, and must not ask where each item goes. | Goal | Balanced against I1 (nothing open disappears). |
| U07 | Pages/Blocks for manually collected material that a daily note can reference. Automatic fetching can wait. | Goal | Block-level references stay in scope until Brian decides otherwise (R10). |
| U08 | Long term: Calendar, e-ink/TRMNL, Top 3, reminders, revisiting material. Keep round 1 cheap. | Goal | Top 3 markup and a resurfacing test move into round 1 (items 9–10). |
| U09 | OpenRouter API with an OpenAI GPT model; the exact model is configurable. | Preference | Kept as the default. |
| U10 | TanStack Start + TypeScript; Supabase for data. | Preference | Kept as the default. Compatibility is verified in spikes; re-opened only on a real blocker. |
| U11 | Saved articles, videos, and repos are "basically never visited again"; Brian wants them to be useful. | Goal | Source: discovery doc, pain 2. Missing from v0.1's table. |
| U12 | A reminder to do the daily review. | Goal | Source: discovery doc, pain 1. Round 1 uses an external reminder (see Deferred). |

## Invariants (must hold in every layout and every build)

| ID | Invariant |
| --- | --- |
| I1 | An open, unpaused task is never invisible without a user action. The open-pool count is visible on Today every day. |
| I2 | Input confirmed as persisted is never lost. Input that has not been saved stays in the current session with a prominent "not saved" signal; recovery after a reload is not promised (04 X01). No item is created twice by retries, double submits, or late responses. |
| I3 | No commitment changes state (done, cancelled, rescheduled, deadline cleared) without either a direct user action or a user-confirmed AI proposal. |
| I4 | Deadlines are never hidden by display caps, deduplication, or "Not today". |
| I5 | Success messages describe what was actually saved; nothing is reported as done that did not happen. |

## Round-1 scope (must have)

1. **Daily page.** One page per local date, created on first open, history kept. It opens
   instantly from saved data with no model call (D07).
2. **Natural-language capture.** The raw text is saved first. The model extracts tasks,
   events, notes, and explicit dates. A capture with only new items applies immediately with an
   editable receipt; any change to an existing item makes the whole capture wait for one
   confirmation (D04).
3. **Pages and basic blocks.** Create, edit, reorder, save, and search manually collected
   material. Pasting into Pages never creates tasks (D12).
4. **References.** Reference a page or a block from a daily note; clicking jumps to the
   target. The backlink *view* is deferred; the data that supports it is kept.
5. **Task handling.** Done, reschedule, cancel, "Not today", and undo of the last action, with
   one task identity across all views.
6. **Dates.** Planned day, attention (start preparing) day, deadline, and event date are
   separate fields.
7. **Review.** One free-text review produces confirmed changes and tomorrow's draft. A skipped
   review is recovered by the morning hand-off (01 F08), with no backfill required.
8. **Open pool and upcoming.** A simple upcoming list, a "Still open" line, and a "Not today"
   summary (D06). No full calendar.
9. **Top 3.** The review-time draft may mark up to 3 placed items as Top 3. Display markup
   only; no new task state.
10. **Resurfacing test (candidate).** In the concierge test, 0–2 related saved items per day,
    each with a reason. It is built into round 1 only if the test shows use (04 §V3). If
    built: one dismissible "Related" line on Today, never inserted into the body, validated
    against real IDs.
11. **Reliability floor.** Durable saves, visible errors, idempotent retries, version-conflict
    detection, and JSON export.

## Deferred from round 1

- Notion or external-calendar sync; bulk history migration.
- Automatic web fetching, video transcription, repository analysis, attachments, PDF import.
- Automatically maintained wiki, knowledge graph, long-term personal profile, vector search,
  multiple agents.
- Full month or week calendar, drag scheduling, TRMNL output.
- Multi-user collaboration, generic database views, nested blocks, rich layout.
- Recurring items, multi-day events, travel time-zone scheduling.
- Background generation, push notifications, system notifications.
- **New in v0.2:**
  - The `selected_text` ("tidy this section") AI mode.
  - Markdown export.
  - The backlink view.
  - Merge UI for conflicts (anything beyond choosing which version to keep, as in 01 §8),
    and the global undo UI. Detection and precondition checks stay.
  - The per-task history timeline UI. The change data stays.

**Review reminder (U12):** round 1 does not build one. During the trial Brian uses an existing
recurring phone or calendar reminder that links to the review. The trial records reminders
fired against reviews done. If the trial shows forgotten reviews are the main blocker, a
built-in reminder channel is the first follow-up. Round 1 does not claim to validate "the
system brings me back".

## Defaults (team choices; adjustable after the trial)

| ID | Default | Kind | Reason |
| --- | --- | --- | --- |
| D01 | Daily notes and material are both Pages made of basic blocks with stable IDs. Where the day's plan lives depends on the layout. **[Layout A]** The plan is a structured Today zone computed from Task and `DailyPlacement`, with user-owned order, above a free Notes zone. **[Layout B]** Plan rows are placement blocks inside the free body. The attention area shows only items not already placed. | Design; layout is a hypothesis tested in 04 §V2 | One authoritative list for "today" in either layout (R1). |
| D02 | Tasks and events have their own identity. A **placement row** means "planned for this day"; an **ordinary reference** is a mention in notes. Deleting an ordinary reference never changes a task. | Design | A day's plan and a mention are different things (R1). |
| D03 | Editing ordinary text saves text only. The model is called only by capture submit, review, or an explicit "Draft my day". | Design | Feelings, quotes, and diary text are not commands. |
| D04 | Explicitly stated new tasks are created directly, with an editable receipt, when the capture contains only new items. AI-proposed **changes to existing items** (complete, cancel, reschedule, clear deadline) appear as one inline diff card (Apply / Edit / Discard). **Mixed capture** (new items plus changes): the whole group waits for one confirmation and nothing is applied before Apply; Discard applies nothing (one apply key, one transaction; rules in 02/03). Until handled, the capture stays `needs_confirmation`, its card stays visible, and Today's facts area shows "N captures waiting for confirmation", so a set-aside card can never silently keep new items from being created. The trial logs how often mixed captures occur and how often cards are left waiting; if frequent, split the group later. **Direct UI actions** never ask for confirmation. Suggestions the AI makes up stay as suggestion text until Brian turns them into tasks. | Design | Protects I3 without adding friction to direct actions (R4). |
| D05 | "Not today" is one step with no destination dialog. It removes the task from today's plan, pauses carry-over, clears `planned_on` only if it equals today (an earlier planned day is kept as history and is not treated as overdue), and keeps the deadline and attention date. Undo is offered and restores the task's carry-over state from before the action (a task that was already paused or never scheduled does not become eligible). Field-level rules are authoritative in 02. Editor Backspace never triggers it. | Design | Low effort without losing constraints (R1). |
| D06 | **Open pool** = open, unpaused tasks with no future `planned_on`, including never-dated ones, computed from data. Today shows up to 3 "continue?" suggestions drawn only from previously scheduled pool tasks that are not already placed today (order: last explicit placement, then creation time). It also shows one collapsed line, "Still open · N · oldest X days", which expands to the full pool, with never-dated tasks labelled "unscheduled". Paused tasks are excluded from the pool and from N; they get a separate "Not today · N" summary that never produces suggestions. **Rotation** of suggestions is a trial parameter, off by default, switched on if the trial shows the same 3 suggestions for more than 3 days in a row. | Design; the cap and rotation are hypotheses | Satisfies I1 and U06 together (R2). |
| D07 | No model call when a page opens. Tomorrow's AI suggestions are produced at review time. After a skipped review, Today shows a morning hand-off and an optional "Draft my day". Drafts never change dates or overwrite notes; whether a draft was generated comes from Generation state, not from an empty body. | Design | An instant, predictable morning (R3). |
| D08 | References show current content. History pages label linked tasks as "shown at current status". | Design | Unchanged from v0.1. |
| D09 | Placed rows show their deadline and attention tags. Due or attention facts that are not in the plan appear in the facts area. Deduplication removes duplicate rows, never tags. Deadlines are never limited by caps or "Not today". | Design | I4. |
| D10 | No inferred lead time when a task has no attention date. | Design | Unchanged. |
| D11 | The workspace uses Brian's local time zone; the trial starts with America/Vancouver. | Design | Unchanged. |
| D12 | **The entry point decides intent.** The capture bar means "I am speaking"; multi-line pastes there show a preview first. Pages → New / Paste is material: it never creates tasks unless Brian selects text and runs "Turn into tasks". Bodies pasted inside a capture stay source content. | Design | Safety does not depend on model labels (R5). |
| D13 | **Bounded model context.** Material goes to the model as titles plus a short excerpt unless Brian selects more. Soft-deleted content and run logs are excluded. Receipts and drafts state the actual input scope. On overflow, the app says so and keeps the input; it never truncates silently. | Design; revises U02 | Cost, latency, and privacy (R7). Brian decides what may be sent (synthesis D-C). |

The cap of 3 applies only to suggestions. Real deadlines and fixed events are never hidden by
it.

## What success means (R9)

**Correctness** (gate): I1–I5 hold in acceptance (04) and in the trial.

**Value** (measured, not assumed):

- **Baseline.** Before any trial, 3 light days of self-logging on the current Notion routine:
  - minutes spent planning the day;
  - number of times Brian went back to Notion or his memory to find a pending item.
- **Candidate thresholds** for the 7-day app trial. They are proposals; they become
  gates only when explicitly adopted after the baseline exists (the baseline alone does not
  approve any number):
  - Daythread opened to start the day on ≥5 of 7 days.
  - Review or morning hand-off used on ≥5 of 7 days.
  - Planning time at or below the baseline.
  - "Went back to Notion or memory" events at or below the baseline count.
  - Zero lost or duplicated items (hard gate).
  - Resurfaced material used at least 3 times, if resurfacing is built.
- **Fail signals:**
  - A parallel Notion daily note is still kept after day 3.
  - Corrections and confirmations take more time than they save. That time counts toward the
    burden.
- **Insufficient evidence** is a valid result. If the trial had too few real chances (for
  example, no relevant material came up), extend it or record the gap. An inconclusive trial
  is not reported as a pass or a fail.

## Not promised in round 1

- Understanding arbitrary rewrites or vague phrasing.
- Solving the problem of real commitments that exceed available time.
- Treating "saved a lot of material" as "material was reused".
- Treating JSON export as a tested backup. There is no import.

## Order of work (R11)

1. Fix the rules on paper: the state replay (`docs/reviews/round-1/state-replay.md`) and this
   v0.2. In parallel, run the user-facing validation (04 §Pre-build validation).
2. Decide the layout from the prototype session, then finish the layout-dependent parts of
   v0.2.
3. Run throwaway spikes only where the chosen layout needs them (editor, database).
4. Build one end-to-end slice: capture → Today → done / Not today / reschedule → review →
   tomorrow hand-off, plus saving one page and referencing it from Today.
5. Widen from there, then run the 7-day app trial.

No application code until Brian approves this order (synthesis D-A).

## Open for Brian (pointers; the questions live in the synthesis)

- D-A: validate before building.
- D-B: devices, and whether evening review is an existing habit. This may change D07 and the
  capture entry points.
- D-C: what may be sent to the model, and the budget.
- D-D: Daythread as the only daily note during the app trial.
- Any proposal to cut block-level references (U07) comes back to Brian as a scope change.
