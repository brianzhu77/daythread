# 00 · Scope and decisions — v0.3 draft

Status: **unapproved draft** (task #14, owner Bumblebee, reviewer Ratchet). It revises
`docs/specs-v0.2/00-scope.md` (frozen) using `docs/reviews/refs-delta/SUMMARY.md`, the four
delta files in that folder, and the Lead's ruling on Brian's daily-note sample
(#daythread:3cf148c1 msgs 11ec76e1 and its follow-up). Nothing here has been built, run, or
tested. Field-level rules are authoritative in 02; model input and budget rules in 03.

## Change log (v0.2 → v0.3)

| Ref | Change in this file | Evidence |
| --- | --- | --- |
| V | Pre-build validation gate removed. The first thin slice is the experiment; the baseline runs in parallel with the build. "Order of work" rewritten. | D-A; O-U08–O-U10 |
| RV | Review reminder and guided review move into round 1 (U12, scope item 7). Success re-centred on `review_saved` and the morning hand-off. | O-U03; D-B; Brian accepted the iOS reminder (msg 78871f09) |
| HO | Morning hand-off is a main path: all of yesterday's open tasks, each Keep / Not today, plus "Bring to today" for other lines. The cap of 3 now applies only to "Continue?" from older days (D06, D07). | Brian's sample and routine (msg 78871f09) |
| L | Layout A removed. One editable page with a section template: Top 3 · Other · Events · Good Stuffs · Notes (D01). Top 3 is a section, not markup. | O-U06; sample |
| DEL | Deleting a whole plan row sets the task "Not today" with a notice and Undo (D05). Bulk text deletion never sets tasks aside. | O-U07; Lead ruling after Ratchet review |
| M | Material identity comes from where a link is entered: the material section (Good Stuffs) or an explicit save. Task-row links stay with the task; Notes links stay text unless saved. Replaces "material only via Pages → Paste" (D12). | Sample; Lead ruling |
| C | D13 reversed: the model gets the day's note plus the full content of everything it explicitly links to. Too large → nothing sent, input kept, no silent truncation. | O-U10; D-C |
| B | New D14: 10 USD/day budget per Vancouver day, enforced by the app. | D-C |
| R | Resurfacing moves from "candidate gated by the concierge test" to a thin, removable "Related" line in the first slice, with a kill rule (D15, scope item 11). | O-U03 point 2 |
| REF | First-slice references are page-level; a quote keeps its excerpt as text. Paragraph anchors and the backlink view are deferred. | O-U11; source correction |
| SRC | Source column added to the needs table. Block-level references, "commitments never silently drop", and deferring reminders are relabelled as assistant or team proposals. | `refs/02-user-quotes.md`; `refs-delta/ratchet.md` |

## Product goal

Brian starts each day from a page that is already prepared and freely editable, and spends
less effort planning, recalling open commitments, and finding saved material. Tasks and
material persist; the daily page ties them together.

Round 1 serves one user (Brian) in a real 7-day trial of a thin slice. It tests whether the
daily loop (review or morning hand-off → prepared page → capture) is used and is predictable,
and whether saved material comes back usefully. It does not aim for recommendation accuracy,
an automatic knowledge base, or editor breadth.

## Kinds used in this file

**Goal** = Brian's stated need · **Evidence** = what Brian showed or reported about current
behaviour · **Preference** = stated technical or product preference, kept as the default and
open to evidence · **Design** = a team choice in this spec · **Hypothesis** = untested claim,
with the check that tests it.

## Brian's stated needs and preferences

Quote IDs (O-U*, C-U*) refer to `refs/02-user-quotes.md`. D-A..D-D and the sample refer to
#daythread:3cf148c1 msgs 7a55cbbf and 78871f09.

| ID | Content | Kind | Source | Note for v0.3 |
| --- | --- | --- | --- | --- |
| U01 | A standalone web app is fine. No Notion migration or sync; manual carry-over is acceptable. | Goal | O-U09 | Unchanged. |
| U02 | Keep natural-language input. Pass input and existing information to the AI; no prompt, retrieval, or context optimisation in v1. The day's note is the index page: give the model all linked context. | Preference | O-U10; D-C | v0.2's bounded context is withdrawn (D13). |
| U03 | Home is the daily entry point: a suggested free-writing page that includes today's plan, fully editable. | Goal | O-U06 | Realised as one page with Brian's own section template (D01). |
| U04 | Future items come back on, or near, their date. | Goal | O-U04, O-U05 | Unchanged. |
| U05 | Review connects to the next day's plan and reduces planning and recall effort. | Goal | O-U03 point 1 | Unchanged. |
| U06 | Removing items from today must not build an ever-growing list to maintain, and must not ask where each item goes. | Goal | O-U07 | Measured in the trial as burden, not only findability (Success). |
| U07 | A place to store manually collected material, and a way to reference it from the daily note. Automatic fetching can wait. | Goal | O-U11 | Page-level references in round 1. Block-level references and backlinks were assistant design, not Brian's request; deferred. |
| U08 | Long term: Calendar, e-ink/TRMNL, quotes/notes on a dashboard. | Goal | O-U03 point 3, O-U04 | Deferral is the team's cost choice, not a withdrawn need. |
| U09 | OpenRouter API with an OpenAI GPT model; the exact model is configurable. | Preference | O-U18 | Unchanged. |
| U10 | TanStack Start + TypeScript; Supabase for data. | Preference | O-U19, O-U20 | Unchanged; re-opened only on a real blocker. |
| U11 | Saved articles, videos, and repos are "basically never visited again"; Brian wants them to be useful. | Goal | O-U03 point 2 | Tested in round 1 by the "Related" line (D15). |
| U12 | A reminder to do the daily review, and a guided review. | Goal | O-U03 point 1; D-B | Now in round 1. First slice uses a repeating iOS reminder linking to the review (D16). |
| U13 | Today's routine: each morning Brian opens yesterday's note and copies over unfinished items that still matter, plus other lines he wants to keep on today's page. | Evidence | Sample, msg 78871f09 | One sample; basis for the morning hand-off (D07). |
| U14 | Today's note shape: `TODO - Top 3`, `TODO - Other`, `Events` (untimed lines), `Good Stuffs` (links: reading, inspiration, shopping), `Notes`. | Evidence | Sample | Basis for the template (D01) and material rule (D12). Top 3 is an existing habit. |
| U15 | Devices: MacBook and iPhone. The evening review does not happen reliably: he forgets, and there is no guidance. | Evidence | D-B | iPhone must support review, hand-off, and capture. |
| U16 | Model spending cap: 10 USD per day. | Goal | D-C | D14. |
| U17 | During the trial Daythread is the only daily note. | Goal | D-D | Trial rule (04 §T). |

## Invariants (must hold in every build)

| ID | Invariant | Source |
| --- | --- | --- |
| I1 | An open, unpaused task is never invisible without a user action. The open-pool count is visible on Today every day. | Design: protects Brian's recall goal (O-U03). The assistant proposed it (O-A07) and Brian answered "make sense" (O-U08); it was not an itemised request. |
| I2 | Input confirmed as persisted is never lost. Input that has not been saved stays in the current session with a prominent "not saved" signal; recovery after a reload is not promised (04 X01). No item is created twice by retries, double submits, or late responses. | Design |
| I3 | No commitment changes state (done, cancelled, rescheduled, deadline cleared) without either a direct user action or a user-confirmed AI proposal. | Design |
| I4 | Deadlines are never hidden by display caps, deduplication, or "Not today". | Design |
| I5 | Success messages describe what was actually saved; nothing is reported as done that did not happen. | Design |

I1 guarantees that open tasks can be found. It does not by itself solve U06: a growing
"Still open" count is the same backlog, compressed. The trial measures burden separately.

## Round-1 scope (the first thin slice)

1. **Daily page.** One page per local date, created on first open from the section template
   (D01), history kept. Opens instantly from saved data with no model call (D07).
2. **Natural-language capture.** The raw text is saved first. The model extracts tasks,
   events, notes, links Brian asks to save, and explicit dates. A capture with only new items applies
   immediately with an editable receipt; any change to an existing item makes the whole
   capture wait for one confirmation (D04).
3. **Material.** A link becomes a saved material item when it is entered in the material
   section or explicitly saved (D12). Pages lists and edits material; it is not a required
   entry point.
4. **References.** Page-level: a reference opens the source page. A quote keeps its excerpt as
   text with a source link.
5. **Task handling.** Done (the row stays on the page, checked), reschedule, cancel, "Not
   today" (including deleting a whole plan row, D05), and undo of the last action, with one
   task identity across all views.
6. **Dates.** Planned day, attention (start preparing) day, deadline, and event date are
   separate fields. Events may have no time.
7. **Reminder and guided review.** An evening reminder (D16) opens a short guided review that
   works on iPhone: today's plan cards (one-tap Done / Tomorrow / Another day / Not today),
   capture, one optional reflection line that is never parsed, and tomorrow's suggestions.
   Flow in 01.
8. **Morning hand-off.** On a new day, all of yesterday's open tasks, each with Keep / Not
   today, plus "Bring to today" for yesterday's other lines (D07). Skippable as a whole or in
   part; nothing has to be cleared.
9. **Open pool and upcoming.** A simple upcoming list, a "Still open" line, a "Not today"
   summary, and up to 3 "Continue?" suggestions from older days (D06). No full calendar.
10. **Top 3.** A section of the page. Plan rows move between Top 3 and Other. The review's Top 3
    suggestions are offered in the next morning's hand-off and land in Top 3 only when Brian
    adds them. No new task state.
11. **"Related" line.** 0–2 saved material items a day, each with a reason, chosen at review
    time from the resurfacing set (D15). Dismissible, never inserted into the body, IDs
    validated. Removable without data changes.
12. **Budget.** The 10 USD/day cap is enforced before every model call (D14).
13. **Reliability floor.** Durable saves, visible errors, idempotent retries, version-conflict
    detection, and JSON export.

## Deferred from round 1

- Notion or external-calendar sync; bulk history migration.
- Automatic web fetching, video transcription, repository analysis, attachments, PDF import.
- Automatically maintained wiki, knowledge graph, long-term personal profile, vector search,
  multiple agents.
- Full month or week calendar, drag scheduling, TRMNL output.
- Multi-user collaboration, generic database views, nested blocks, rich layout.
- Recurring items, multi-day events, travel time-zone scheduling.
- Background generation.
- Built-in notifications (Web Push from a home-screen web app). First follow-up if the trial
  shows the iOS reminder is not enough; email is the fallback.
- Receiving the iOS share sheet. Round 1 uses copy link → paste.
- Block-level references, stable paragraph anchors, and the backlink view. The data that
  would support backlinks is kept.
- The `selected_text` ("tidy this section") AI mode; Markdown export.
- Merge UI for conflicts (anything beyond choosing which version to keep, as in 01 §8), the
  global undo UI, and the per-task history timeline UI. Detection, precondition checks, and
  change data stay.
- A project feature. Typed prefixes ("Rewind - …") and search cover it for now.

## Defaults (team choices; adjustable after the trial)

| ID | Default | Kind | Reason |
| --- | --- | --- | --- |
| D01 | One editable page per day, prefilled with Brian's sections: **Top 3 · Other · Events · Good Stuffs · Notes**. All headings and text are editable, renamable, and removable; Brian can add or delete sections and write anywhere on the page. Plan rows (placement blocks) live in Top 3 and Other and are visually distinct from prose. Section roles (plan, material) belong to the section, not its title. The attention area shows only items not already placed. | Design, from U03/U14 | Matches how Brian already writes; one authoritative list for today (R1 data rules kept). |
| D02 | Tasks and events have their own identity. A **placement row** means "planned for this day"; an **ordinary reference** is a mention in notes. Deleting an ordinary reference never changes a task. | Design | A day's plan and a mention are different things. |
| D03 | Editing ordinary text saves text only. The model is called only by capture submit, the review's suggestion step, or an explicit "Draft my day". | Design | Feelings, quotes, and diary text are not commands. |
| D04 | Explicitly stated new tasks are created directly, with an editable receipt, when the capture contains only new items. AI-proposed **changes to existing items** (complete, cancel, reschedule, clear deadline) appear as one inline diff card (Apply / Edit / Discard). **Mixed capture** (new items plus changes): the whole group waits for one confirmation and nothing is applied before Apply; Discard applies nothing. Until handled, the capture stays `needs_confirmation`, its card stays visible, and Today's facts area shows "N captures waiting for confirmation". **Direct UI actions** never ask for confirmation. Suggestions the AI makes up stay as suggestion text until Brian turns them into tasks. | Design | Protects I3 without adding friction to direct actions. |
| D05 | "Not today" is one step with no destination dialog. It removes the task from today's plan, pauses carry-over, clears `planned_on` only if it equals today, and keeps the deadline and attention date. **Deleting a whole plan row** applies it directly; the notice says carry-over stopped and the deadline is kept, with Undo and "Keep planned" (undo the set-aside, then remove only the row from the page). The task stays findable in the "Not today" filter. Editing title text, deleting an ordinary reference, or deleting history presentation never sets a task aside. **Bulk text deletion** never sets tasks aside: plan rows removed this way stay on today's plan, listed outside the note as "Planned · not in note (N)" with Put back. Undo restores the prior carry-over state. Field rules in 02. | Design, from U06 | No per-item choice (O-U07) without a silent state change. |
| D06 | **Open pool** = open, unpaused tasks with no future `planned_on`, including never-dated ones. Today shows one collapsed line, "Still open · N · oldest X days", which expands to the full pool, with never-dated tasks labelled "unscheduled". Up to 3 **"Continue?"** suggestions come from previously scheduled pool tasks placed on days *before yesterday* and not already placed today. Yesterday's open tasks are handled by the hand-off (D07), never capped. Paused tasks are excluded from the pool and N, and get a separate "Not today · N" summary that never produces suggestions. Rotation of suggestions is a trial parameter, off by default. If the trial log shows the same 3 suggestions for more than 3 days in a row, the team switches it on by hand and notes it in the log; there is no automatic trigger (Lead ruling, msg a130692f; ordering rules in 02). | Design; the cap and rotation are hypotheses | Satisfies I1 and U06 together. |
| D07 | No model call when a page opens. **Morning hand-off** (a main path, not only a fallback): on the first open of a new day, a row lists all of yesterday's open tasks, each with Keep / Not today, and on expanding, yesterday's Good Stuffs and Notes lines with **Bring to today** for the ones Brian picks (copies the line once into the same section with a "from <day>" link; no AI, no new state). Plain lines have no done state, and lines not picked are not open commitments. Keep places the same task on today; it never copies a commitment. The hand-off can be skipped as a whole or handled in part; untouched items keep their state and nothing has to be cleared. When the hand-off shows, it replaces "Continue?" for that morning. If the review saved suggestions, the hand-off offers them first ("Suggested last night"); they become placements only when Brian adds them. Tomorrow's AI suggestions are produced only in the review's suggestion step or by "Draft my day". | Design, from U13 | Automates the copy step Brian does by hand each morning. |
| D08 | References show current content. History pages label linked tasks as "shown at current status". | Design | Unchanged. |
| D09 | Placed rows show their deadline and attention tags. Due or attention facts not in the plan appear in the facts area. Deduplication removes duplicate rows, never tags. | Design | I4. |
| D10 | No inferred lead time when a task has no attention date. | Design | Unchanged. |
| D11 | The workspace uses Brian's local time zone; the trial starts with America/Vancouver. | Design | Unchanged. |
| D12 | **Where something is entered decides what it is.** The capture bar means "I am speaking"; multi-line pastes show a preview first. A link becomes a saved material item only when it is in the material section (prefilled as Good Stuffs) or explicitly saved: a capture that is only a link, a capture that says to save it ("save this: <link>"), or Save on a Notes link. The model does not decide on its own that a link is material. A link in a task row stays attached to that task and never becomes material. A link in Notes stays text until saved. Pasting into Pages never creates tasks unless Brian runs "Turn into tasks". | Design | Safety does not depend on model labels; Brian's work links never pollute "Related". |
| D13 | **Model input = the day's note as root, plus the full content of everything it explicitly links to**, followed transitively, deduplicated, cycle-safe, without crawling backlinks. External URLs without collected content are sent as URLs and marked so. If the result exceeds the model's capacity or the budget, nothing is sent, the input is kept, and the app shows the size and reason. No silent truncation, summary, or split calls; a narrower scope only by Brian's explicit choice, labelled as limited. Receipts and drafts state the input actually used. Rules in 03. | Design, from U02/D-C | Brian asked for all linked context; failure stays visible. |
| D14 | **Budget:** 10 USD per Vancouver calendar day, enforced by the app (reserve before each call, settle with actual cost, shared across devices). At the cap nothing is sent; writing, task actions, the hand-off, and saving the review keep working; retry is manual after the reset. OpenRouter's own key limit is only a backstop. Rules in 03. | Design, from U16 | A hard user limit, honoured before spending. |
| D15 | **Resurfacing set:** only material Brian opts into for the trial. The preferred source is links from past Good Stuffs sections; up to 10–20 seed items Brian adds are optional. Items marked **Don't resurface** (for example, shopping) are excluded; the app does not guess from URLs. The set is sent as full text within D13/D14 checks. If it outgrows capacity, unlinked candidates fall back to a catalogue (ID, title, Brian's note) and the line says "Might be useful · Open", never implying the model read them. Linked context is never cut to make room. | Design, from U11 | Reasons need the content; the trial result must mean something. |
| D16 | **Reminder:** first slice uses a repeating iOS reminder whose link opens the guided review directly. The app cannot see whether it fired; it logs reviews opened from that link. | Design, accepted by Brian | Minutes to set up, no backend. |

## What success means

**Correctness** (gate): I1–I5 hold in acceptance (04) and in the trial.

**Value** (measured, not assumed):

- **Baseline.** 3 light days of self-logging on the current Notion routine, run while the slice
  is built (not a gate; it only has to exist before the trial ends):
  - minutes spent planning the day (including copying from yesterday);
  - number of times Brian went back to Notion or his memory to find a pending item.
  If Brian declines, a retrospective estimate from his notes is used and labelled as such.
- **Day signals**, logged separately:
  - `review_saved`: Brian's own review input was saved (end of step 3, or Finish).
  - `handoff_done`: Brian tapped Done on the morning hand-off card (01 §3.5). Handling every
    item is not required. Dismissing or ignoring the card is logged as `handoff_skipped` and is
    not a successful day by itself.
  - `draft_ready`: tomorrow's suggestions were generated and saved. A failed or
    budget-blocked draft is a system failure and never counts as a skipped review.
- **Candidate thresholds** for the 7-day trial. They become gates only when explicitly adopted
  after the baseline exists:
  - Daythread opened to start the day on ≥5 of 7 days.
  - A **successful day** (`review_saved` or `handoff_done`) on ≥5 of 7 days.
  - Planning time at or below the baseline.
  - "Went back to Notion or memory" events at or below the baseline count.
  - Guided review median under 5 minutes.
  - Zero lost or duplicated items (hard gate).
  - "Related" items used at least 3 times.
- **Stop and redirect rules:**
  - `review_saved` on fewer than 3 of 7 days with the reminder in use → the evening review is
    not working for Brian; make the morning hand-off the only default path and keep review
    optional before widening anything.
  - "Still open" count rises on ≥5 of 7 days with no triage, or Brian reports on ≥3 days that
    the open list feels like something to maintain → burden fail (U06). Next options, not
    built now: a grouped weekly summary of paused items; lower recurrence for never-scheduled
    ideas.
  - "Related" shown on ≥5 days with plausible links and never opened → cut to manual
    references only.
  - On the 2 rules-only days (if Brian agrees), AI suggestions no better than rules-only →
    shrink the AI draft to review-time capture only.
- **Fail signals:**
  - A parallel Notion daily note is still kept after day 3 (D-D trial rule).
  - Corrections and confirmations take more time than they save.
- **Insufficient evidence** is a valid result. If the trial had too few real chances (for
  example, a resurfacing set under ~10 items, or no future item came up), extend it or record
  the gap. An inconclusive trial is not reported as a pass or a fail.

## Not promised in round 1

- Understanding arbitrary rewrites or vague phrasing.
- Solving the problem of real commitments that exceed available time.
- Treating "saved a lot of material" as "material was reused".
- Knowing whether the iOS reminder fired.
- Treating JSON export as a tested backup. There is no import.

## Order of work

1. Done: paper state replay (`docs/reviews/round-1/state-replay.md`) and the v0.2 consistency
   review; the refs check (`docs/reviews/refs-delta/`).
2. Now, in parallel: this v0.3 revision; the local project scaffold (no external accounts);
   the setup proposal for Supabase, HTTPS hosting, and an OpenRouter key, which Brian
   approves before anything is created; the 20-case capture accuracy set on the chosen model
   once the key exists; the baseline (3 days).
3. Build the thin slice: capture → Today (template) → done / Not today / reschedule →
   reminder → guided review → tomorrow's suggestions → morning hand-off; material via Good
   Stuffs and a page reference; the "Related" line; the budget check. iPhone web for capture,
   review, and hand-off.
4. Pass the §A/§R/§X cases in 04 that cover I1–I5, then run the 7-day trial (04 §T).
5. Decide from the trial what to widen, cut, or rebuild.

Brian approved starting the build (msg 78871f09). External resources still need his approval
of the setup proposal.

## Open for Brian (asked through the Lead)

- What the Notion manual run showed: what worked, what felt heavy, where it stopped.
- Whether past Good Stuffs links are the material he wants back, and which items to mark
  Don't resurface.
- Whether 2 of the 7 trial days may use rules-only suggestions.
