# Daythread review round 1 — synthesis

Author: OptimusPrime (Lead) · 2026-10-15 · Status: **draft for Brian's review**

Update 2026-10-15: R1–R11 are now written into `docs/specs-v0.2/` (versions in
`SPECS-V0.2.sha256`), reviewed for cross-document consistency by Ratchet. That is a document
check only; nothing has been built or tested. Layout-dependent parts carry both A and B
versions until the prototype session.

Correction 2026-10-15 (after `refs/` was added): §4 and §7 cite "U07" as an explicit request
for block-level references. Per `refs/02-user-quotes.md` O-U11, Brian asked for a place to
store manually collected material and a way to reference it from the daily note; the
granularity (block vs. page) and backlinks were the assistant's design. Block-level references
are therefore a design choice to be judged on merit, not a user requirement. Likewise §2's
"real commitments must not silently drop" originated with the assistant; Brian's stated pain
is backlog size and maintenance friction (O-U07). An incremental check against `refs/` is in
`docs/reviews/refs-delta/`; this file is not otherwise rewritten.

Superseded 2026-10-16: Brian answered D-A..D-D and approved a thin slice (msgs 7a55cbbf,
78871f09). §2's goal sources, §5 (validation plan) and §6 (follow-up tasks) are replaced by
`docs/reviews/refs-delta/SUMMARY.md` and `docs/specs-v0.3/README.md`.

Inputs: `README.md` and `docs/specs/00`–`05` at the versions in `BASELINE.sha256` (unchanged
during the review); four independent reviews and their cross-reviews in this folder; the
discovery history in `~/Documents/Codex/2026-10-13/wo-j/outputs/personal-app-discovery.md`.
Nothing here has been prototyped, run, or tested. Every claim about value or feasibility is a
hypothesis until the validation plan below produces evidence.

## 1. Bottom line

The specs are careful about data correctness: stable identity, dates and time zones,
save-first capture, atomic apply, access rules. That foundation should be kept.

They should not be implemented in the current M0–M5 order. All four reviewers found,
independently, that:

1. **The core value is tested last.** Whether a prepared daily page actually reduces planning
   and recall effort is first observed in M4/M5, after the editor, references, and data layer
   are built.
2. **The day's plan has no single source of truth.** Task dates, `DailyPlacement`, and task
   blocks in a free-form body can disagree, and deleting a line has ambiguous meaning.
3. **Open tasks can silently disappear.** Undated tasks and carry-over beyond the first three
   have no defined path back into view, which recreates the recall load the product exists to
   remove.
4. **The material loop does not address the stated pain.** Brian's pain is "saved, and
   basically never visited again"; a loop that depends on him remembering to search and
   reference repeats that failure.

Recommendation: revise the specs on the points in §3, run a short pre-build validation (§5)
that mostly costs team time, and then build one thin slice through the action loop instead of
the old content-first order.

## 2. What is goal, preference, design, hypothesis

| Kind | Content | Source |
| --- | --- | --- |
| Goal | Reduce daily planning and recall effort; review should connect to the next day. | Brian, 2026-10-15; discovery §1 |
| Goal | Saved articles, videos, and repos should come back when useful; today they are "basically never visited again". | discovery §2 (line 40), §104 |
| Goal | No ever-growing backlog to maintain; real commitments must not silently drop. | 00 U06; discovery "重要边界" |
| Goal | Wants a review reminder; long-term Top 3, Calendar, e-ink. | discovery §1, §3; 00 U08 |
| Preference | TanStack Start + TypeScript, Supabase, OpenRouter + OpenAI GPT. | Brian, 2026-10-15 ("曾偏好") |
| Design | Page/Block tables, task blocks in a free body, D01–D11, BlockNote, 3-item carry-over, AI draft on page open, M0–M5 order. | specs 00–05 |
| Hypothesis | An AI draft saves effort vs. writing the Notion note by hand; Brian will review in the evening; BlockNote maps cleanly onto per-block rows; whole-workspace context is affordable. | none tested |
| Unknown | Brian's real daily-note format and review routine; which devices he captures and plans on. | discovery §111, §117 (listed as unresolved) |

The specs currently say "用户已确定" for the stack. Revise to "preference; kept as the default;
compatibility to be verified". No reviewer found evidence that justifies replacing the stack.
Changing the framework would not fix any of the issues above.

## 3. Recommended revisions (team consensus after cross-review)

Each item lists the specs it changes. Severity is the highest any reviewer assigned.

### R1 · One source of truth for the day's plan — blocker

- The Task holds the facts (status and dates). `DailyPlacement` is the day's selection and
  order. Blocks are presentation only.
- Distinguish a **placement row** (the task is planned for this day) from an **ordinary
  reference** (a task mentioned in notes). Deleting an ordinary reference never changes a
  task. Taking a task off today is an explicit **Not today** action with an undo toast.
  Editor Backspace never silently pauses or cancels.
- Each scheduling action updates Task, affected placements, and presentation in one
  transaction. A rescheduled task stays visible on the old page, marked as moved, and is not
  eligible for carry-over from there.
- The attention area never repeats an item that is already placed. Placed rows carry their
  deadline/attention tags, so deduplication cannot hide a deadline; after "Not today" the
  deadline remains in the facts area.
- **Layout is still open (decided in the §5 prototype session):** structured Today zone above free Notes (recommended
  by all four in cross-review) vs. plan rows inside the free body. The rules above hold for
  both.
- Changes: 00 D01/D02/D05/D07/D09, 01 F01/F03/F06, 02 Page/Block, DailyPlacement, 暂放, 04.

### R2 · One carry-over rule; nothing open disappears without a user action — major

- The **open pool** = every task that is `open`, not paused, and has no future `planned_on`,
  including tasks that were never dated. It is computed from data, never from "the most
  recent page".
- Three views of the same query:
  1. Up to 3 "continue?" suggestions on Today, taken from pool tasks that were explicitly
     scheduled before. Stable order: last explicit placement, then creation time.
  2. One collapsed line, "Still open · N · oldest X days", that expands to the full pool, with
     never-dated tasks labelled "unscheduled".
  3. An Upcoming tab for "No date / Not today".
- Paused tasks are not in the pool and are not counted in N. Today shows them as a separate
  collapsed summary ("Not today · N, of which M have reached their attention date"). It never
  produces suggestions, so it does not become a second attention backlog. Deadlines stay
  independent.
- The cap of 3 limits display, never eligibility.
- **Invariant for acceptance:** an open, unpaused task is never invisible without a user
  action, and the pool count is visible on Today every day.
- Changes: 00 D06, 01 F07, 02 接续候选, 04 A13/A14/R05 plus a multi-day case.

### R3 · No AI call when the page opens — major

- The day page opens instantly from data: facts plus carry-over.
- AI suggestions for tomorrow are produced at review time. After a skipped review, Today
  shows a morning hand-off ("Yesterday: N open · Continue / Not today / Later") and an
  optional **Draft my day** button.
- Drafts never change dates or overwrite notes. An "already generated" flag comes from
  Generation state, not from whether the page body is empty.
- Changes: 00 D07, 01 F01/F08, 02 页面生成, 03 每日草稿, 04 R06.

### R4 · AI changes to existing items are confirmed; new items are applied — major

- From capture or review, AI-proposed **changes to existing items** (complete, cancel,
  reschedule, clear deadline) show as one inline diff card with Apply / Edit / Discard.
  Confirming re-checks object versions and the capture revision.
- **New items** are created immediately with an editable receipt. Ambiguous or multi-line
  pastes show a preview first.
- **Direct UI actions** (checkbox, Not today, date picker) never ask for confirmation.
- `daily_draft` mode has no state-changing operations at all. Each mode gets its own
  operation allowlist.
- Log confirmations and rejections in the trial, then relax per action type based on
  evidence.
- Changes: 00 D04, 01 F02/F08, 03 自动应用边界/结构化返回, 04 X08 plus new cases.

### R5 · Entry point decides "my words" vs. "material" — major

- The capture bar means "I am speaking". Pages → New / Paste means "material": it never
  creates tasks unless the user selects text and runs **Turn into tasks**.
- Pasted bodies inside a capture stay source content.
- Model labels alone are not a safety guarantee. X08 passing once does not prove safety.
- Changes: 01 F02/F04, 03 信任边界, 04 X08 plus a "paste own to-do list" case.

### R6 · Retry, revision, and partial-success protocol — major

- `capture_id` keeps the original identity; `capture_revision` increments on edit or
  clarification; `attempt_id` identifies one model call; `apply_key`
  (capture + revision + mode) is unique.
- If the same key arrives with a different payload, reject it. Leases expire, so a stuck
  `processing` can be retried. A duplicate model cost is acceptable; applying twice is not.
- A review shows three stages: text saved → changes committed → draft ready or failed.
  Retrying a failed draft never re-applies changes.
- Undo across several objects checks all preconditions first and never partially rolls back.
- Changes: 02 Capture/Generation/写入一致性, 03 请求生命周期, 05 录入执行, 04 X02–X07.

### R7 · Bounded model context and explicit sending scope — major

- Measure context size, latency, and cost per call. Set input/output budgets and timeouts.
- New context strategy (a revision of the "send existing content directly" preference):
  materials go to the model as titles plus a short excerpt unless the user selects more. The
  receipt and draft state the actual input scope and never claim the full text was read.
- Soft-deleted content and run logs are excluded.
- On overflow, say so, keep the input, and let the user narrow the scope. Never truncate
  silently.
- What may be sent to OpenRouter is Brian's decision (§4, D-C).
- Changes: 03 输入上下文, 04 X11.

### R8 · Resurfacing saved material: test before building — major

- The concierge test (§5) includes 0–2 related saved items per day, each with a reason,
  drawn only from a material set Brian approves.
- If Brian uses resurfaced items, round 1 builds one dismissible "Related" line on Today. It
  is never inserted into the body and is validated against real IDs.
- If related material and real chances to use it existed and it still went unused, downgrade
  to manual references. If there were too few chances, record "insufficient evidence" rather
  than a result.
- A non-AI fallback stays available: "one saved item not opened in 14+ days" in review.
- Changes: 00 U07/U08 and scope, 01 F04, 03, 04 trial measures.

### R9 · Measurable trial, with a way to fail — major

- **Baseline:** a short self-log of minutes spent planning and the number of "went back to
  Notion or memory to find something" events.
- **Candidate thresholds** (proposed, not yet validated):
  - Daythread opened to start the day on ≥5 of 7 days.
  - Review or morning hand-off on ≥5 of 7 days.
  - Planning time at or below baseline.
  - "Went back to Notion or memory" events at or below the baseline count.
  - Zero lost or duplicated items, as a hard gate.
  - Resurfaced material used at least 3 times.
- **Fail signals:**
  - A parallel Notion daily note is still kept after day 3.
  - Corrections and confirmations cost more time than they save. That time counts toward
    the burden.
- Changes: 00 成功的含义, 04 试用.

### R10 · Smaller round-1 surface — minor to major

Smaller interaction defaults proposed by Jazz (row actions Done / Another day / Not today /
Cancel task; plain-language date labels such as "Start Wed · Due Fri"; three navigation
entries with ⌘K search) go into T3 as proposals reviewed by Bumblebee. Brian does not need to
decide them.

**Cut or defer:**

- The `selected_text` ("整理这段") mode.
- Markdown export.
- AI on page open.
- Plan-merge prompts, if layout A is chosen.
- Conflict-merge UI and global undo UI.
- The per-task history timeline UI.
- The backlink UI. Stable block IDs stay in the data so it can return without migration.

**Block-level references stay in scope for now.** U07 asks for Pages/Blocks that a daily note
can reference. Ratchet objects to quietly reducing this to page-level references because they
are cheaper to build. The prototype tests whether "page reference that lands on the matched
passage" is enough. Any proposal to cut block-level references comes back to Brian as a scope
change; it is not decided by the team.

**Keep, even though costly:**

- Capture saved first.
- Single task identity across days.
- Planned, attention, and deadline dates.
- Idempotent apply.
- Version-conflict detection and undo precondition checks. Two tabs plus retries are enough
  to corrupt data.
- RLS ownership with same-workspace foreign keys.
- JSON export. It is not described as a restorable backup.

**New, small, from the reviews:**

- Top 3 markup on the draft (stated want, no new state).
- A state and copy table in 01 (exact wording for saving, failure, conflict, missing target,
  and session expired).
- Date edge cases: DST, a deadline with a time, and the target day of "tomorrow" in a
  historical review.

### R11 · Replace M0–M5 with: validate → revise → thin slice — major

1. Fix the rules on paper first (state replay, spec v0.2 with R1–R10), in parallel with
   user-facing validation (§5).
2. Decide the layout from the prototype session, then finish the layout-dependent parts of
   v0.2.
3. Throwaway spikes only where the chosen layout needs them.
4. One end-to-end slice: capture → Today → done / Not today / reschedule → review → tomorrow
   hand-off, plus save one page and reference it from Today.
5. Widen from there.

Changes: 05 交付顺序 and 最先交付的可见切片; README "统一依据" wording.

## 4. Decisions

### Resolved by Lead (routine; reversible)

| Topic | Decision | Reason |
| --- | --- | --- |
| Carry-over suggestions | Suggest only from tasks that were scheduled before. Never-dated tasks appear in the "Still open" line, not as suggestions. Rotation is a trial parameter, off by default; switch it on if the trial log shows the same 3 suggestions for more than 3 days in a row. | Wheeljack vs. Bumblebee. Suggesting tasks Brian never scheduled adds push he did not ask for (U06). Visibility is already guaranteed by the count line. |
| Baseline | 3 light days of self-logging, run **in parallel** with the prototype build. It is not a serial gate. Thresholds are candidates until the baseline exists. | Bumblebee vs. Wheeljack. Both concerns hold: a baseline is needed, and it must not add weeks. |
| Confirmation scope | AI-proposed changes to existing items only. Inline, never modal. | All four agree on the substance. Jazz/Wheeljack's conditions adopted. |
| Mixed capture (new + change) | Added during v0.2 review. The whole group waits for one confirmation under one apply key; captures that only create items still apply directly. While pending, the capture stays `needs_confirmation`, the card stays visible, and Today's facts area shows "N captures awaiting confirmation". This overrides Jazz's cross-review suggestion to save the new items first. | Splitting needs separate group identity, temp_id dependencies and a partial Capture state. Mixed captures should be rare. Log their frequency and how often cards sit unhandled; split later if needed. |
| Editor spike | After the layout decision. If A wins, the spike covers Notes (text plus references) only. | All four. |
| Stack | Keep the preferences as defaults; fix the wording. Re-open only if a spike hits a real blocker. | All four. |

### Needs Brian (the only four questions)

| # | Question | Recommended | Cost / reversibility |
| --- | --- | --- | --- |
| D-A | **Validate before building?** About 15 min to hand over material, ~2 min/day for 3 baseline days, one ~45 min prototype session, then 4–5 days of ~10 min/day starting each day from a model-written draft. No app code until it is done (~1.5–2 weeks). | Yes. It is the cheapest way to learn whether the loop is worth building, and it decides the page layout. | The alternative is going straight to the thin slice with spec v0.2. That is faster to code but builds on an untested value claim; reversible only by rework. |
| D-B | **Your devices:** where do you capture, plan, and review (desktop only / phone capture + desktop plan / phone for everything)? Is the evening review an existing habit or a new one? | — (fact we need) | Cheap now; expensive to change after the editor and layout are chosen. |
| D-C | **What may go to the model, and a budget:** which real notes and saved items can be used (redacted copies), and a spending cap for the concierge test plus a 20-case accuracy set on OpenRouter. | Redacted copies; a small fixed cap you set. | Nothing is sent without this. You can stop further sending at any time; content already sent is subject to the provider's retention and deletion terms, which we will check before the first call. |
| D-D | **During the trial, is Daythread your only daily note** (Notion read-only)? | Yes. Otherwise double entry confounds the result. | Applies only to the later 5–7 day app trial, not the concierge test. |

Not asking you, with recommended defaults:

- The page layout. It is decided from your behaviour in the prototype session; you see both
  options there.
- Confirmation rules (R4).
- The carry-over rule (R2).
- Retry protocol, access constraints, and context budget (R6, R7).
- Cuts (R10).

## 5. Minimal validation plan

| When | What | Owner | Brian's time | Output / exit |
| --- | --- | --- | --- | --- |
| Now | Paper state replay: 4 days, 8 undated tasks, deadline/attention/event, a material page with commands, two references to one task. Run pause, skipped review, delete reference, reschedule, late response, undo. Each step records the expected Task, placement, body, attention, and pool. | Ratchet (author), Wheeljack (independent re-derivation) | 0 | Every step has exactly one answer under R1/R2. Ambiguities are fixed in spec v0.2. |
| Now | Spec v0.2 revision pass (R1–R11) on a copy; the original drafts stay untouched | See §6 | 0 | Revised specs plus a change log. Layout-dependent text is marked open. |
| After D-A/B/C | Hand over 3–5 recent daily notes, about 10 saved items, devices | Brian → Bumblebee | ~15 min | Redacted fixture set |
| Days 1–3 | Baseline self-log | Brian, form by Bumblebee | ~2 min/day | Baseline numbers |
| Days 1–3 | ~1-day clickable prototype (first to drop if time is tight: the skipped-review morning, which the concierge test also covers): Today zone A vs. plan-in-body B; receipt card with an inline confirm; a morning after a skipped review; Not today, then finding the task again; writing notes about one task and referencing a passage of saved material (tests both the cost of A, which can't interleave plan and prose, and whether a page-level reference is enough) | Jazz | 0 | Prototype |
| Day 3–4 | Prototype session: 6 scripted tasks, thinking aloud | Jazz with Brian | ~45 min | Layout decision, correction time, "where did it go?" count |
| Days 4–8 | Concierge test: an evening draft from the review plus open items plus 0–2 resurfaced items. 2 days are rules-only (no AI wording). | Bumblebee, Wheeljack | ~10 min/day | Does AI beat rules; is resurfaced material used; is review kept |
| Days 4–8 | 20-case capture accuracy set on the chosen model: explicit, feeling, conditional, reported speech, negation, two same-name meetings, article list, malicious command. Run twice. | Wheeljack, reviewed by Ratchet | 0 | Error and correction rates per mode |
| After layout chosen | Throwaway editor spike (scope depends on the layout) and a local Postgres spike: two concurrent applies, stale revision, cross-workspace ID, two users | Wheeljack, reviewed by Ratchet | 0 | Go/no-go on BlockNote and per-block storage |

**Stop or redirect rules:**

- Any undetected lost or mis-changed commitment in the replay or the concierge test means
  fixing the rules before building.
- Drafts needing heavy rewrites on most days, or AI drafts no better than rules-only, means
  shrinking or removing the draft AI mode.
- Resurfaced items consistently unused despite real chances to use them means downgrading
  resurfacing; too few chances means "insufficient evidence", not a drop.

**Limits:** the concierge and prototype runs show value and comprehension. They do not prove
data consistency, the editor mapping, or model accuracy over weeks. Those belong to the
spikes and the later 5–7 day trial.

## 6. Follow-up tasks

| Task | Owner | Reviewer | Depends on | Writes |
| --- | --- | --- | --- | --- |
| T1 Paper state replay | Ratchet | Wheeljack | — | `docs/reviews/round-1/state-replay.md` |
| T2 Spec v0.2: 02 data/state + 03 AI contract + 05 delivery | Wheeljack | Ratchet | T1 findings | `docs/specs-v0.2/02,03,05` |
| T3 Spec v0.2: 01 flows + state/copy table | Jazz | Bumblebee | — | `docs/specs-v0.2/01` |
| T4 Spec v0.2: 00 scope + 04 acceptance/trial + README | Bumblebee | Ratchet | — | `docs/specs-v0.2/00,04`, README draft |
| T5 Concierge kit: prompt (from 03 draft rules), log form, baseline form, redaction guide | Bumblebee | Jazz | D-A, D-C | `docs/validation/` |
| T6 Clickable A/B prototype | Jazz | Bumblebee | D-A, D-B | `prototypes/today-ab/` |
| T7 20-case capture dataset and method (run only after D-C) | Wheeljack | Ratchet | D-C for the run | `docs/validation/capture-cases.md` |
| T8 Editor and DB spikes | Wheeljack | Ratchet | Layout decision | `spikes/` |

T1–T4 need nothing from Brian and are reversible: they write new files and leave the current
drafts unchanged. T5–T8 wait on the decisions in §4.

## 7. Disagreements kept on record

- **Layout.** All four now lean toward Today zone A. Bumblebee and Wheeljack make it
  conditional on Brian: U03 is his wording ("a free-writing page that includes today's plan"),
  and if his real notes interleave plan lines with prose, B may fit better. Decided by the
  prototype session, not by team preference.
- **Resurfacing.** Bumblebee holds that round 1 must bring material back without searching.
  Wheeljack accepts only a bounded test on an approved material set. Resolved as
  test-then-build (R8). If evidence is mixed, this returns to Brian as a scope choice.
- **Baseline and thresholds.** Wheeljack warns that thresholds without a baseline should not
  become gates. Adopted: the thresholds stay candidates until the baseline exists.
- **Block-level references.** Bumblebee proposed cutting them to page level. Ratchet objects
  because they are an explicit request (U07). Kept in scope until the prototype shows whether
  a page reference that lands on the passage is enough. Any cut goes to Brian. Bumblebee accepted this in cross-review; the fallback cut is
  backlinks.
- **How much reliability scope a single user needs.** Not an open disagreement. Bumblebee
  proposed cutting the merge and undo UIs while keeping detection. Wheeljack and Ratchet
  require version checks and undo preconditions. Adopted: keep detection and checks, cut the
  merge and undo UIs.
