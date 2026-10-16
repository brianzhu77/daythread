# refs delta — Design (Jazz)

- Task: #12 · 2026-10-15 · Status: **draft for the Lead's summary.** No spec file was changed.
- Inputs: `refs/README.md`, `refs/01`–`03`, `refs/sources/discussion-2026-10-13.md` (O-U06, O-A06, O-U07, O-A07, and the reminder trade-off on lines 435 and 477), Brian's answers to D-A..D-D (thread msg `7a55cbbf`), the Lead's split (msg `473d1d1e`), and Wheeljack's interim R7/budget note (msg `6c4d49f1`).
- Compared against: `docs/reviews/round-1/jazz-design.md`, `synthesis.md` R1/R3/R7/R10, and `docs/specs-v0.2/01-flows-and-ux.md` (sha256 `892da1ff…`).
- Only changes are listed. Anything not mentioned in 01 v0.2 stays as it is. Nothing here has been prototyped or tested.

## Summary

| # | Change | Affects | Verdict |
| --- | --- | --- | --- |
| 1 | Layout B (plan rows inside the free page) becomes the default; A becomes the fallback | R1 layout part, synthesis §5, 01 §3.2, §11.1; my round-1 finding 1 | **Overturn** my A recommendation. R1's data rules stay |
| 2 | Backspace on a plan row applies **Not today** straight away with Undo. No prompt | 01 §3.2 B, 04 A19 [Layout B] | **Modify** |
| 3 | Review becomes a short guided flow that starts from a reminder, phone first | R3, 01 §7, §9, §3.5 | **Modify** (substantial) |
| 4 | The phone/laptop split sets the design limits of the first slice | 01 §1, §3.2 B, §5, §6, §8 | **Modify** (new constraints) |
| 5 | Any prototype should be the phone review, not A vs B | synthesis §5, T6 | **Modify** |
| 6 | New user-facing states for "context too large" and "daily budget reached" | 01 §7, §8; depends on Wheeljack's R7 change | **Add** |
| 7 | Page-level references that open at the matching passage become the default | 01 §6.2, §11.2, R10 | **Modify** (design view only; Bumblebee and the Lead own the call) |

## 1. Layout: B is the default, A is the fallback

**New evidence.**
- **O-U06** (Brian's own words): "a suggested free-writing page for today *that contains today's action plan*. The page content can be *completely* changed." The plan is inside the free page, not in a zone above it.
- **D-C** (Brian, 2026-10-15): "the day's note is the index page." The note is the main surface that everything else is linked from.
- Corroborating: Brian keeps a daily note in Notion today (O-U03), which is a free document. His manual Notion trial (D-A) ran in that format as well.

**Strength.** O-U06 was put forward as an idea ("我在想…你觉得呢"), not a tested habit. It is still the only first-hand statement about layout, and it points one way. My case for A was a usability judgement (one source of truth, less merging). It had no user evidence behind it.

**What stays.** The rules that removed my round-1 blocker are layout-independent and stay as they are:
- the Task is the fact and a placement is the day's selection (R1);
- plan rows look different from ordinary references;
- deleting text never silently cancels a task;
- the attention area never repeats placed items;
- no AI call when the page opens (R3).

The blocker was the ambiguity, not the free page itself.

**Change.**
- 01 §3.2: make **B** the default. Drop "decided in the prototype session". Keep A as a documented fallback, used only if the real daily-note samples, or the first week of use, show that Brian loses track of what's planned inside prose. Measure that as "where did it go?" moments.
- In B, the prefilled sections (Plan, Notes, Review) are ordinary headings. Brian can rename, reorder or delete them, as v0.2 already says. To match "completely changed", the prefilled *text* is a suggestion too. Only the plan rows carry task state.
- Remove the hover cue ("Hovering a placement row shows Planned for today"). There is no hover on the phone (see §4). The left rail and the date tag are enough.
- 01 §11.1 and synthesis §5: the A/B question moves from the prototype session to the sample check (see §5).
- Round-1 `jazz-design.md` finding 1: record it as superseded by this delta. I won't edit the round-1 file.

**Remaining risk (hypothesis).** In B, a plan row can be dragged far from the Plan heading, or buried in prose. Mitigation, already in B: the attention area lists anything due that isn't placed. If samples show heavy interleaving, add an optional "Plan (4)" summary line pinned at the top of the page that jumps to each row. It's a view, not a second list.

## 2. Backspace on a plan row: apply, don't ask

**New evidence.** **O-U07**: "I also don't want to be asked to choose every time I remove something; that friction is big." Earlier in the same exchange, the assistant (O-A07) proposed a single "set aside" action with Undo and no picker. That proposal is the assistant's, but the "don't make me choose" part is Brian's.

**Conflict in v0.2.** 01 §3.2 B selects the row on Backspace and asks "Not today? · Remove from page only", with Not today as the default. That is a choice on every removal, which is exactly what O-U07 rejects. Bumblebee's 04 A19 [Layout B] encodes the same prompt.

**Change.**
- Backspace or Delete on a whole plan row applies **Not today** immediately. The row leaves the page and a toast appears: "Not today — won't carry over · due Fri still tracked · Undo · Keep planned". The secondary action covers the rare "I only wanted it off the page" case without asking every time. (Wording and semantics amended in the addendum.)
- Deleting characters *inside* the title still edits the title. Only removing the whole row counts as removal.
- 04 A19 [Layout B] needs the same change. That's Bumblebee's file; I'll flag it in the thread.

## 3. Guided review that starts from a reminder

**New evidence.**
- **O-U03**: "remind me to do the daily review … and improve review quality through a guided routine." Both the reminder and the guidance come from Brian, not the assistant.
- **D-B** (2026-10-15): the evening review "isn't running smoothly yet, mainly because I often forget, and there's no guidance for the review."
- History: dropping the reminder in round one was the assistant's cost cut. It already said: "if forgetting the review turns out to be the main blocker, add a reminder first" (discussion lines 435 and 477; `history/mvp-v0.1.md` line 89). D-B is that evidence.

**What was wrong in v0.2.** 01 §7 treats the review as free text with optional prompts, opened from today's page. It has no reminder, and the guidance is two skippable questions. §3.5 (the morning hand-off) quietly assumed skipped reviews were normal and made up for them. Together these designed around the actual problem instead of addressing it.

**Change: replace 01 §7 with a step flow** (the Lead has put it in first-round scope):

0. **Reminder.** One notification per evening, at a time Brian sets once (no default guessed for him). The first-run prompt asks for the time. Tapping it opens **the review directly**, not Today. Preferred actions: **Start**, **In 30 min**, **Skip tonight**; at most one snooze-driven repeat, nothing after Skip. The delivery channel is Wheeljack's call (Web Push/PWA, email, calendar). The design needs two things from any channel: it reaches the phone's lock screen, and one tap opens step 1. Lock-screen actions and snooze must be verified per channel; email or calendar may only offer the link. Where the channel can't carry them, **In 30 min** and **Skip tonight** sit on step 1 instead.
1. **Today's plan** (about 1 min). One card per still-open item placed today. Each card has one-tap **Done · Tomorrow · Another day ▾ · Not today**. Cards Brian doesn't touch stay in the open pool, so there is no forced triage. These are direct UI actions (R4: no confirmation needed), and they apply as they're tapped.
2. **Anything new?** The normal capture bar with its receipt (§4). On the phone this is where dictation is used.
3. **One reflection line**, optional: "What changed today?" Saved as text and never parsed into task changes, so "too tired" stays a feeling (§7.5 kept).
4. **Tomorrow.** The draft suggestions are built from steps 1–3, so the daily-draft model call happens here (R3 kept). Step 2 capture still calls the model for organizing, as everywhere else. Brian can star up to 3 as Top 3, remove any, then tap **Save for tomorrow**. Suggestions and Top 3 stars are stored suggestions, not placements (R3), so the copy is "Tomorrow: 3 suggestions saved". "N planned" appears only for items Brian explicitly placed on tomorrow (step 1 **Tomorrow**), and only after the save succeeds.

Rules:
- Every step can be skipped. Progress is saved per step, so an interruption on the phone resumes at the same step later that night. Two separate states (aligned with Ratchet, msg `71a311b1`): **review saved** is set when Brian reaches the end of step 3 or taps **Finish**, and it is what the trial's completion rate counts. **Tomorrow's draft ready** is set only when step 4 saves. A failed draft (budget, capacity or model error) shows "Review saved · Tomorrow's suggestions couldn't be prepared — Retry" and never counts as a skipped review. Stopping before step 3 counts as **partial**.
- The three-stage receipt from v0.2 §7.3 (Saved → Changes → Tomorrow) collapses. Step 1 changes are made by Brian's own taps, so free-text review rarely produces AI changes to confirm. Step 3 is pure reflection and is never parsed. Any task change written in words goes through step 2 (capture), and changes to existing tasks there use the inline confirm card from §4.3, unchanged.
- Target length: about 3 minutes. This is a hypothesis to measure, not a promise in the UI.
- §3.5 morning hand-off: keep it as the fallback for a skipped or partial review. Add one line to it: "Last night's review wasn't finished · Finish now (1 min)". That opens step 1 for yesterday's page.
- No streaks, badges or "you missed N reviews" copy (§1 principle kept).

**§9 thin slice.** Item 3 becomes "Reminder → guided review steps 1–4 → tomorrow stored", and it must run on iPhone.

**Success signals for the trial** (proposed; Bumblebee owns the validation plan): review done on at least 5 of 7 evenings; median completion time at most 4 minutes; reminder tap → step 1 → done without opening another screen.

## 4. iPhone and MacBook split

**New evidence.** D-B: "usually my MacBook or iPhone." Brian didn't say which device does what. Below is a working assumption, listed as a hypothesis and checked against the samples and the first week of use. It isn't a question for Brian now.

| Device | Assumed main jobs | Design consequence |
| --- | --- | --- |
| iPhone | Evening review (the reminder lands here), quick capture, a morning look at Today, ticking Done | Review and capture are designed phone-first. Today is readable and tappable at 390 px width |
| MacBook | Writing the day's note, Pages and material, references, longer planning | The full editor, `[[` references, block moves and paste are designed laptop-first |

**Changes.**
- 01 §1: ⌘K gets a visible search button on the phone. The capture bar sits at the bottom of the screen on the phone.
- 01 §2 and §3.2 B: every row action also has a tap path, through a row ⋯ menu. Nothing depends on hover or the keyboard. The Backspace rule from §2 above also applies to the iOS keyboard, so deleting an empty row on the phone runs the same Not today plus Undo.
- 01 §5 (phone, first slice): plain text editing, task rows and Done work on the phone. Block drag/move, multi-block selection and **Turn into tasks** are laptop only in the first slice and are hidden on the phone, not shown disabled. This is a **scope choice** to keep likely-risky editor work (mobile Safari selection and IME) out of the first slice. It is not a claim that the editor can't work on the phone: nothing has been tested on a phone yet (Wheeljack, msg `103372a9`). A real-iPhone check of the editor belongs in the first build, and these limits get lifted if it passes.
- 01 §6: saving material from the phone (share sheet) is a known gap. Wheeljack (msg `103372a9`) found no current compatibility data showing iOS web apps receiving system shares, so the first slice must not rely on it. The phone's path is "paste a link into capture", which already creates a material page marked "no body provided" (§4.2).
- 01 §8: the edit-conflict row (Keep mine / Use other / Keep both) is now a likely case, for example the MacBook tab left open while the review runs on the phone. Add one row: when a page is open on another device and the review changes a task shown on it, the other device updates the row in place and shows no conflict, because task state isn't page text.

## 5. Prototype: phone review, not A vs B

**New evidence.** D-A (Notion manual check done); the Lead has paused T6 and cancelled T5.

**Change.**
- A vs B is decided from 1–2 real daily notes (§1). If Brian doesn't send samples, B stays the default and the first week of use is the check.
- If anything is prototyped before the build, it should be **the guided review on the phone** (§3). It's the newest and least-evidenced flow, the one tied to Brian's stated blocker, and the cheapest to fake: about half a day of clickable screens he can try on his own iPhone in one evening. I'd recommend that only if the Lead wants evidence before the build. Otherwise it goes straight into the thin slice.
- `prototypes/today-ab/`: don't build it.

## 6. New states: context too large, daily budget reached

**New evidence.** D-C: the day's note is the index; send *all* linked context; cap of 10 USD per day. Wheeljack (msg `6c4d49f1`) is withdrawing R7's "title + short excerpt" default in favour of fully expanding linked content, and will **fail explicitly** when it's over capacity instead of summarizing silently. The UI must therefore show two states it didn't need before. The rules belong to Wheeljack (02/03). This only covers the wording.

Proposed rows for 01 §8, used in review step 4, **Draft my day** and capture:

| State | Copy | Actions |
| --- | --- | --- |
| Before an AI call (always visible, small) | "Using today's note + 6 linked items" | **See list** |
| Context over capacity | "Too much linked material to send in one go (14 items). Nothing was sent." | **Choose items** (unlink for this run only) · **Try without links** |
| Daily budget reached | "Today's AI budget is used up ($10). Your text is saved. You can retry once the budget resets." | **Retry** (enabled after the reset; nothing retries in the background) |
| Budget close (≥ 80 %) | Shown once per day in the receipt, not as a banner: "Most of today's AI budget is used." | — |

Rules: the capture is always saved first, even when no AI call can happen (§4.2 kept). Review steps 1–3 work without AI. Only step 4's suggestions wait. When unlinked material is sent as a catalogue (title + note) instead of full text (Lead's E2 ruling), any material suggestion reads "Might be useful · Open" and never implies the model read it. The context line names the mode: "Using today's note + 6 linked items (full text) + 18 saved items (titles only)". Only unlinked saved items can drop to titles; linked items are never cut. If the linked full text alone is over capacity, the "Context over capacity" row applies.

## 7. References: default to page-level, opening at the passage

**New evidence.** O-U11 asks only for "somewhere to store material, then reference it from the daily note". Paragraph-level references and backlinks were the assistant's design. The Lead is correcting the synthesis on this.

**Design view** (narrowed after Ratchet, msg `71a311b1`, and Wheeljack's note that block-level anchoring is deferred). In the first slice, `[[` searches page titles and text, and inserts a **page reference that opens the page**. It doesn't promise to land on a passage. To keep a specific passage, Brian copies it as a quote with a source link (01 §6.4, unchanged), and that quote is independent text. Precise, stable passage anchors are a separate later feature, added if the samples or trial show Brian reaching for paragraphs. Bumblebee (material loop) and the Lead own the scope call. This only removes my design objection.

## Disagreements and open items

- **My earlier A position.** Withdrawn as the default (§1), but kept as a fallback with a stated trigger. I don't see a remaining disagreement unless Ratchet or Wheeljack want A for state-simplicity reasons; R1 already covers those.
- **For Bumblebee:** 04 A19 [Layout B] and the review acceptance cases need the §2 and §3 changes.
- **For Wheeljack:** the reminder channel must reach the lock screen and deep-link to step 1. Confirm the mobile editor limits (§4) and Web Share Target on iOS.
- **For the Lead's summary to Brian:** nothing new to ask beyond the samples request already sent. The device split (§4) and the reminder time are handled in the product (first-run prompt), not by asking now.

## Addendum — after Ratchet's ruling on §2 (thread msg `ecbb4aa9`)

Ratchet supports §2 with conditions. I accept them all; §2 is amended as follows.

1. **Only a whole plan row triggers Not today.** Deleting title characters edits the title. Deleting an ordinary reference, or a row shown on a past day's page, never changes a task (01 §2 "Remove reference" kept).
2. **Bulk deletion** (a selection containing text and plan rows), revised after the Lead's ruling (msg `5ea2fcaf` thread): **nothing is set aside.** A multi-row selection is more often a tidy-up or an accident than a decision about each task, so it changes no task state. The plan rows leave the note but stay placed for today, shown outside the note as "Planned · not in note (3)" with **Put back** and per-row **Not today**. One summary toast: "Text removed · 3 planned items still on today's plan · Undo". Undo restores everything. Wheeljack confirmed (msg `103372a9`) this maps to 02's "remove presentation only": the block is soft-removed, Task and placement are unchanged, and the facts area shows the still-planned items. The deletion, the facts update and the summary receipt commit in one transaction, and the group Undo carries a version check.
3. **"Keep on page only" is renamed "Keep planned"** with a defined meaning. It reverses the Not today. The row stays off the page, and the task stays placed for today, shown in the attention area as "Planned · not in note" with **Put back**. In 02 terms this is two steps: undo the pause, then remove only this presentation. Before, the label read as the opposite of what the action did, which Ratchet rightly flagged.
4. **The toast is the receipt.** It always states both facts: carry-over stopped, and any deadline kept ("Not today — won't carry over · due Fri still tracked"). Set-aside items stay findable in the "Not today · N" line and Upcoming → Not today. Neither ever asks to be cleared: no badge, no growing must-see count.
5. **Claim narrowed.** This reduces repeated suggestions and the "choose where it goes" friction from O-U07. It does not shrink the stored backlog, and 01 must not claim it does. Bumblebee's pool-size measure in the trial covers backlog burden.

Acceptance (for Bumblebee's 04): add the mapping "delete whole plan row → Not today + toast", plus cases for the four exclusions above (title characters, ordinary reference, past-day row, bulk delete pausing nothing and listing the rows as "Planned · not in note").

## Addendum 2 — Brian's daily-note sample (thread msg `78871f09`, 2026-10-16)

**Evidence.** One real note structure plus his description: headings `TODO - Top 3` (3 checkboxes, one done), `TODO - Other`, `Events` (plain lines, no times), `Good Stuffs` (links to read, inspiration, shopping), `Notes` (loose ideas). Each morning he opens yesterday's note and **copies** open items that still matter, and also anything else he wants to keep on today's page. This is one sample; patterns below are observations to confirm in the first week, not facts about every day.

1. **Layout: B confirmed, A not needed.** Plan items are not interleaved with prose. They sit in headed sections at the top of one free document, with Notes at the bottom. B with prefilled headings matches this exactly. A's separate zone adds nothing he lacks. Remove A from 01 rather than keeping it as a fallback.
2. **Prefilled headings mirror his own.** The template is `Top 3` · `Other` · `Events` · `Good Stuffs` · `Notes`, all renamable. **Top 3 is a section, not a star.** Moving a plan row between Top 3 and Other (drag, or the row menu "Move to Top 3") replaces the star from v0.2 §3.2. Review step 4's Top 3 picks land in that section on the next page.
3. **Done rows stay on the page, checked.** His `[x]` stays visible. Done never removes a row from that day's page (the toast and Undo stay).
4. **Carry-over includes non-task lines.** He copies "things that should stay on today's note", not only tasks. Tasks are already handled by the pool, the hand-off and Continue?. Add **Bring to today** on any block of yesterday's page (and in the hand-off's expanded view: yesterday's unchecked Good Stuffs and Notes lines). It copies the line into the same section today with a small "from Wed" source link. No AI, no new state. This replaces the manual copy step, which is the recall cost O-U03 names.
5. **Material enters through the daily note** (narrowed with Bumblebee, thread msg `c29d22b3`). His saved links live in `Good Stuffs`, not in a separate library, which contradicts the R5 split ("Pages → Paste = material"). Where a link is entered decides what it is (the spirit of D12):
   - A link in the **material section** (prefilled as `Good Stuffs`), or captured as material ("save this: <link>"), becomes a saved material item, referenced from that line.
   - A link inside a **task row** stays attached to that task (PRs, forms). It never becomes material and never feeds "Related".
   - A link in **Notes** stays text. A quiet inline **Save** turns it into material when he wants.
   - The material role belongs to the section, not its title, so renaming `Good Stuffs` keeps it. Moving or deleting the section moves or ends that behaviour, shown once as a hint.
   - Shopping and other "not again" links: a per-item **Don't resurface** mark on the material item. No URL guessing.

   Pages stays the place to browse and annotate, not a required entry point. Past Good Stuffs links are the natural pool for "Related". Wheeljack to check against 02.
6. **Events can be untimed.** "Lunch with Kevin" has no time. Event rows show a time only when one exists; capture never asks for one.
7. **Project prefixes are enough for now.** "Rewind - APPX PR - Provider" uses a typed prefix for the project. No project feature is needed in the first slice; search and the prefix cover it.

Affects 01 §3.2 (drop A, template), §3.5 and §3.4 (Bring to today), §4.1 and §6 (links in the day note become material), §7 step 4 (Top 3 section), §2 (Done keeps the row).
