# refs delta — Product (Bumblebee)

Task #11 · 2026-10-15 · Status: **proposal for Lead**, no spec edited.

Inputs: Brian's answers in #daythread:3cf148c1 (msg 7a55cbbf: D-A to D-D); `refs/` 01–03,
`refs/sources/discussion-2026-10-13.md`, `refs/history/`; compared against
`docs/reviews/round-1/synthesis.md` §2, §5, §6 and `docs/specs-v0.2/00`, `04` (frozen hashes
00 1c18fc2e, 04 6ab05264). Only changes are listed. Nothing here has been tested.

Scope assigned by Lead: (1) re-plan validation after D-A, (2) re-attribute goal sources in
synthesis §2 and say whether that changes the pool, (3) re-judge material resurfacing against
O-U03.

## Summary

| # | Change | Verdict | Affects |
| --- | --- | --- | --- |
| 1 | The pre-build validation gate goes. The first thin slice becomes the experiment, with review reminder and guided review inside it. | **Overturn** synthesis §5 order / R11; 04 §V3 removed | synthesis §5, §6 T5; 00 Order of work; 04 §V, §T |
| 2 | The biggest untested risk is now the review itself, not the draft's quality. Success and stop rules are re-centred on that. | **Modify** R9 | 00 Success; 04 §T |
| 3 | "Commitments never silently drop" was the assistant's proposal; Brian accepted the direction ("make sense"). Keep I1, relabel it, and measure backlog burden as well as findability. | **Keep** pool rule (R2), **modify** source labels and trial measures | synthesis §2; 00 U06, I1; 04 §T |
| 4 | Resurfacing serves Brian's own stated pain (O-U03 point 2) and its old gate (the concierge test) is gone. Put a thin, removable version into the first slice and judge it in the trial. | **Modify** R8 (candidate → in slice, with kill rule) | 00 scope item 10; 04 §T; 03 (context) |
| 5 | Brian's D-C answer covers material the note links to. Resurfacing also needs saved material the note does *not* link to. | **New gap** for Wheeljack's R7 rework | 03, 00 D13 |

## 1. Validation plan after D-A

**New evidence.** D-A: "我已经使用 Notion 进行手工验证了". O-U08: "我不倾向于假设太多 … 低成本的
MVP 进行验证". O-U09: "先测功能/loop的流畅程度吧". D-B: the evening review "经常会不记得，且没有一个
review 的引导".

**What D-A settles and what it doesn't.** It is a user statement; we don't yet know what the
manual run covered (Lead has asked). Two readings:

- *Narrow:* he kept a Notion daily note and carried items by hand. That shows the habit of a
  daily page exists. It doesn't show that a prepared draft saves effort, that review happens,
  or that saved material comes back.
- *Broad:* he also tried a prepared next-day plan (by hand or with a chatbot). Then "is a
  prepared page worth it" has some evidence, and the rules-only comparison matters less.

Either way, a second paper/concierge round would mostly re-ask what Brian believes he has
answered, at ~10 min/day of his time, and it would keep him off a real tool for 1.5–2 weeks.
That conflicts with O-U08/O-U09 (few assumptions, cheap MVP, test the loop's flow). The
cheapest remaining way to learn is to use the thin slice itself, because the hard rules
(state replay, v0.2 consistency) are already checked on paper.

**Proposed order (replaces synthesis §5 and 00 "Order of work"):**

| Step | What | Brian's time | Gate / exit |
| --- | --- | --- | --- |
| 0 | Done: paper state replay (V1) and v0.2 consistency review. | 0 | — |
| 1 | Brian sends 1–2 real daily notes and 2–3 lines on the Notion run (Lead's ask). Optional: ~10–20 saved items he'd like to see again (see §4). | ~15 min once | Decides layout A/B without the prototype if the notes are clear (Jazz). |
| 2 | Capture accuracy set (20 cases, T7) on the chosen model. Now unblocked by D-C. | 0 | Error rate per input kind; feeds 03, not a gate on value. |
| 3 | Build the thin slice: capture → Today → done / Not today / reschedule → **reminder → guided review → next-day draft** → morning hand-off; save a page and reference it; resurfacing line (§4). iPhone web for capture and review. | 0 | §A/§R/§X cases covering I1–I5 pass. |
| 3′ | In parallel with step 3: light baseline, 2 numbers/day on the current Notion routine for 3 workdays. | ~2 min/day | Not a gate; it only has to exist before the trial ends. If Brian declines, use a retrospective estimate from his notes and say so. |
| 4 | 7-day trial (D-D: Daythread is the only daily note). | ~2 min/day log | Success / stop rules in §2. |

Removed: V3 concierge test and its kit (T5). V2 prototype session paused (Lead), revived only
if the notes don't settle the layout. The rules-only comparison moves into the trial as a
switch: on 2 of the 7 days the draft is built by rules only, if Brian agrees (cheap, because
the rules path already exists for the pool).

**Risk of this change.** We build ~1–2 weeks of code before seeing the AI draft on real days.
Mitigation: the slice is the smallest loop, and the stop rules below cut the AI draft or the
resurfacing line without rework of the data model.

## 2. Success and stop rules, re-centred on review

**New evidence.** D-B: review is not running because he forgets and has no guidance. The loop
in O-U03 point 1 is "remind review → generate tomorrow's plan from it". v0.2 assumed review
would happen and deferred the reminder (00 U12, Deferred). Lead has already moved reminder and
guided review into round 1.

**Changes to 00 "What success means" and 04 §T (candidate numbers, adopted only after the
baseline, as before):**

- Primary value signal: **review (or morning hand-off) completed on ≥5 of 7 days with the
  reminder in use.** Record: reminder fired / opened / review finished / minutes spent. If the
  reminder is the recommended repeating iOS reminder with a link (Lead's summary, option 2),
  "fired" and "opened" are not observable by the app; log "review page opened from the link"
  instead, and Brian notes in the daily log whether the reminder fired.
- "Completed" means `review_saved`: Brian's own review input (step 1 actions, capture,
  reflection) is saved. It is logged separately from `draft_ready` (tomorrow's draft was
  generated and saved). A draft that fails or hits the budget never counts as Brian skipping
  the review; it counts against the system, as a draft failure. (Per Ratchet's cross-check of
  the three deltas.)
- New stop rule: review completed on fewer than 3 of 7 days even with reminder and guidance →
  the review-first loop is not working for Brian. Switch the default to morning-first (draft
  built from yesterday's page and the pool, review optional) before widening anything.
- Guided review must stay short: median under 5 minutes, logged. Longer is a burden signal.
- Keep: planning time ≤ baseline; "went back to Notion or memory" ≤ baseline; zero lost or
  duplicated items (hard gate); parallel Notion note after day 3 = fail (now an adopted trial
  rule via D-D, no longer pending).
- Remove from 00/04: "Round 1 does not claim to validate 'the system brings me back'". The
  04 §T reminder rule follows Brian's answer to the Lead's option 2 (an external iOS reminder
  linking straight to the review is fine, as long as the link opens the guided review).

New acceptance cases needed in 04 §R (after Jazz's flow and Wheeljack's channel choice): the
reminder fires at the chosen time on iPhone; tapping it opens the guided review; an abandoned
review keeps what was entered; a skipped review still produces the morning hand-off.

## 3. Goal sources and the pool

**Re-attribution (synthesis §2 row 3, 00 U06/I1):**

| Claim | Actual source | Proposed label |
| --- | --- | --- |
| "No ever-growing backlog to maintain"; no destination choice on every removal | Brian, O-U07 | Goal (user) |
| "Real commitments must not silently drop"; deadlines kept when moved off today | Assistant, O-A07 §2 and `history/personal-app-discovery.md` line 84 ("重要边界（助手建议）"). Brian replied "make sense" (O-U08) to that whole proposal. | Design, direction acknowledged by Brian; not an itemised requirement |
| Recall effort should go down | Brian, O-U03 point 1 | Goal (user) — this is what I1 actually protects: if items silently vanish, he has to recall them again |

So I1 is still justified, by O-U03 rather than by a quote that doesn't exist. Synthesis §2
should cite O-U03 + O-U07 + O-A07/O-U08 instead of "00 U06; discovery 重要边界".

**Does this change the pool (R2/D06)?** Not the rule; it changes what we must measure.
O-U07's worry is a list that grows until it can't be maintained. A "Still open N" count that
rises every day is that same list, only compressed into a number. v0.2 measures findability
(nothing lost) but not burden. Add to 04 §T:

- Daily: pool size and paused size (automatic).
- In the daily log, replace Q4 with: "Did the open list feel like something you have to
  maintain today? (no / a little / yes)".
- Fail signal: pool size rises on ≥5 of 7 days with no triage, or Brian answers "yes" on ≥3
  days. Response then: try the O-A07 ideas Brian already called sensible, in this order:
  grouped weekly summary of paused items instead of per-item; lower recurrence for
  never-scheduled ideas. Not built now.

Also check: O-A07 proposed "saving a link creates material, not a task, unless there is action
intent". v0.2 D12 already does this by entry point. No change.

## 4. Resurfacing against O-U03

**New evidence.** O-U03 point 2, in Brian's words: saved articles, videos and repos are
"从那之后基本上就不会访问了", and he wants the system to raise their value. O-U11 asks for
storage plus a reference from the daily note. 03 (refs) notes that manual references can test
the basic ability but can't by themselves show reuse.

**Judgement.** Manual referencing depends on Brian remembering the material exists, which is
the failure he described. Of the stated pains it's the only one v0.2 doesn't test in the first
slice, and its only gate (V3) is now gone. Leaving it as "candidate, decided by the concierge
test" would in practice defer it indefinitely.

**Proposal (modify 00 scope item 10):** build a thin version in the first slice, removable
without data changes:

- At review time the draft may add 0–2 saved items to tomorrow, each with a one-line reason
  tied to a planned item. Shown as one dismissible "Related" line, never inserted into the
  body, IDs validated (as v0.2 already says).
- No embeddings and no automatic fetching. **Lead decision (E2):** for the 10–20 trial items
  the model gets their full text, subject to the capacity and budget checks. Beyond capacity
  it gets a catalogue (ID, title, Brian's note) and the line reads "may be useful, open it",
  never implying the model read the item.
- Needs ~10–20 real saved items brought in by hand at the start (O-U09 accepts manual
  carry-over). This is a Brian-time ask; Lead decides whether to bundle it with the notes ask.

Trial rules (04 §T): count shown / opened / used in an action or conclusion; ask "was any of it
useful?" in the log.
- Used at least 3 times → keep and widen.
- Shown on ≥5 days with plausible links and never opened → cut to manual references only.
- Fewer than ~10 saved items or few plausible links → "insufficient evidence", not a cut.

Out of scope for this delta: block-level vs page-level references (Lead is correcting the
source; Jazz/Ratchet re-judge). Product view only: resurfacing doesn't need block-level
references; a page reference plus a short quoted excerpt is enough to test it.

## 5. Gap for the context rule (Wheeljack, R7/D13)

D-C: "当天的 note 就是索引页，我们需要抓到所有关联的 context，给到 LLM", cap 10 USD/day. This
covers everything the note links to. Resurfacing (§4) by definition needs material the note
does **not** link yet. Please make the review-time context = the day's note + everything it
links (full, per D-C) + a candidate list of other saved items (titles and short notes only).
That way both rules hold within the cap. My understanding is that 10 USD/day is far above a
few review-time calls a day, but that's Wheeljack's estimate to confirm, not mine.

## Documents to revise once Brian confirms (owner)

- `synthesis.md` §2 row 3 sources; §5 replaced by §1 above; §6 T5 removed, T6 paused (Lead).
- `00-scope.md`: U02 note and D13 (follow Wheeljack); U06/I1 source; U11/item 10 per §4; U12
  and the Deferred "Review reminder" paragraph; Success per §2; Order of work per §1; Open for
  Brian → answered (Bumblebee).
- `04-acceptance.md`: §V reduced to V1 (done) + baseline; §T trial rules, log Q4, thresholds,
  stop rules; new §R reminder/guided-review cases; resurfacing measures moved from §V3 to §T
  (Bumblebee; reviewer Ratchet).
