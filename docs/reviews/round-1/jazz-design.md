# Round 1 — Design review (Jazz)

- Scope: daily flows, information structure, start/finish/recover, empty/wait/error/conflict states, editing model.
- Reviewed versions: `README.md` + `docs/specs/00`–`05`, matching `BASELINE.sha256` (checked with `shasum -c`, all OK).
- Written independently. I haven't opened other reviewers' files. I did see the one-line chat summaries Bumblebee and Wheeljack posted in the task #1 thread, but only after this review's findings were drafted.
- Kinds: **goal** = Brian's stated goal; **preference** = technical preference; **design** = current spec design; **hypothesis** = untested claim. Nothing below has been prototyped or tested.

## Top 5

### 1. The day's plan has two sources of truth — **blocker**

- **Kind:** design.
- **Issue:** Plan items live as task blocks inside a freely editable document (D01, D02, F01). At the same time, "需要留意" (needs attention) is computed live outside the body (D09, F05), and new facts arrive as update prompts that the user may or may not merge (D07, F05, R07). The user has to reconcile three lists: what's in my page, what the attention area says, and what the update prompt offers.
  - A task due today and planned for today can appear in the body *and* in the attention area. 02 §Page 与 Block defines dedup for counts and drafts, but not for **display** between the body and the attention area.
  - Backspacing a task line — the most natural "remove" in an editor — silently means "set aside for today" (F06), while backspacing any other line just deletes words.
- **Evidence:** 01 F01, F03, F05, F06; 02 §DailyPlacement, §页面生成; 00 D07, D09.
- **Impact:** This undermines the core goal (less planning/recall effort): the user can't trust that "my page" is the plan. It also drives most of the merge machinery: Generation `ready`/`applied`, update prompts, and R03/R06/R07.
- **Alternatives:**
  - **A — recommended:** Split the daily page into two zones.
    - A structured, live **Today zone**: events, tasks planned today, items whose attention or due date has arrived, and up to 3 carry-over suggestions. It's always computed from current data, so nothing needs merging. Order is user-owned per day. Row actions are explicit (see finding 3).
    - A free **Notes zone** below it: prose, headings, quotes, references and optional inline task mentions. Nothing in Notes changes task state except explicit task controls.

    This still satisfies the U03 intent (prefilled, editable plan plus free writing). *Cost:* the plan can't be interleaved with prose, and the Today zone isn't "document". *Benefit:* no draft/edit merge for the plan, a smaller editor surface (only reference and inline-task blocks are custom), and simpler acceptance.
  - **B — current model, tightened:**
    1. The attention area shows only items **not already in the body**.
    2. Deleting a task block always shows a toast naming the effect ("Not today — due 10/16 still tracked · Undo").
    3. Unmerged updates show as one collapsed line ("2 new for today · Add"), not inline cards.

    *Cost:* keeps all the merge states and the editor complexity.
- **Verify:** A clickable prototype of A and B built from 3 days of Brian's real items. Brian does 6 scripted tasks while thinking aloud. Count "where did it go?" moments and wrong turns, and ask which model he would open every morning. Decide before any editor/data work.

### 2. Calling the AI when the page opens costs more than it gives — **major**

- **Kind:** design. The value claim is a hypothesis.
- **Issue:** In F01, opening a blank day requests an AI draft. If the user starts typing first, the draft becomes "pending to add". The plan's substance — facts plus 3 candidates "in original order" (02 §接续候选) — is already computed deterministically. The AI only adds titles and suggestion lines, which D04 deliberately keeps non-binding.
- **Evidence:** 01 F01 steps 3–6; 02 §页面生成; 03 §每日草稿; 04 R06.
- **Impact:** The first screen of every day gets a waiting state, a failure state and a merge state. Those are the most frequent and least valuable AI states in the product.
- **Alternative:** The day page opens instantly from data, with no model call. AI suggestions are produced at review time, or when the user explicitly asks to "Reorganize today". They're stored as suggestion lines and shown the next morning. With no review, there are simply no AI suggestions; 01 §通用状态 already allows "no new suggestions". *Cost:* there's no AI touch on mornings after a skipped review. *Benefit:* an instant, predictable morning, and one fewer AI mode to build and test.
- **Verify (hypothesis):** In the prototype and the trial, record each morning whether Brian wished for a suggestion that wasn't there.

### 3. The boundary between "my items" and "material" will be crossed in week one — **major**

- **Kind:** design. Linked goal: hand-carried material (U01, U07).
- **Issue:** 03 §自动应用边界 says: "an article with a list → save as material, don't create tasks". But the likeliest first trial action (04 §试用: "bring in a small set of real plans") is pasting Brian's **own** to-do list, which looks exactly like an article with a list. The model has to guess.
- **Evidence:** 03 §自动应用边界, §信任边界; 04 §5–7 天试用, X08.
- **Impact:** Either 12 junk tasks, or real commitments silently filed as reading material. Both destroy trust on day one.
- **Alternative:** Decide by the entry point, not by the model.
  - **Capture bar** (on Today, plus a global shortcut) = "I'm speaking". A multi-line paste there shows a preview of N items with a checkbox per line before saving. This doubles as the trial import path.
  - **Pages → New / Paste** = material. It never creates tasks unless the user selects text and runs "Turn into tasks".

  *Cost:* a preview step for multi-line captures. *Benefit:* the safety rule in X08 becomes deterministic instead of depending on the model.
- **Verify:** New acceptance case: paste an 8-line personal to-do list into the capture bar → preview of 8 tasks → save. Paste the same text into Pages → 0 tasks.

### 4. The receipt is the trust surface, but correcting it is undefined — **major**

- **Kind:** design.
- **Issue:** F02 says the receipt can be "expanded, corrected or undone", but not how. If correcting means another natural-language message, every model mistake costs a round-trip and another wait. Most mistakes will be a wrong date or a wrong object type.
- **Evidence:** 01 F02 step 5; 03 §结构化返回; 04 trial question 1 ("what had to be corrected?").
- **Impact:** Correction friction drives whether Brian keeps using capture at all. It's also the trial's main measurement point.
- **Alternative:** A compact receipt card anchored to the capture.
  - Each produced object is a row of **editable chips**: type (task / event / note), title, and dates (`start 10/14` · `due 10/16`). A tap opens a small picker, and edits apply as normal versioned changes.
  - The card also offers **Undo all** and **Show original**. When the active page isn't today, it says so: "Tomorrow = Oct 16 (from today, not from Oct 9)".
  - Clarifications (`needs_clarification`) appear in the same card as one-tap options when they can be enumerated: "Which meeting? [Thu design sync] [Thu 1:1]".
  - *Cost:* one more UI component with chip editors. *Benefit:* most corrections take one tap, and corrections become countable for the trial.
- **Verify:** In the prototype, seed one wrong date and one wrong type. Time how long Brian takes to fix each, and see whether he tries to retype instead.

### 5. Without reminders, the evening review is the weakest link — **major**

- **Kind:** goal (U05: review should connect to the next day and reduce recall). The habit assumption is a hypothesis.
- **Issue:** The design makes the evening review the gateway to a good morning. Push reminders are deferred, and 00-scope itself predicts "forgot to review" as the likely blocker. Skipping is allowed (R05), but each skipped evening quietly degrades the next morning.
- **Evidence:** 00 §首轮明确暂缓 plus the reminder note; 01 F07, F08; 04 R05 and §试用后决策.
- **Impact:** The value of the action loop depends on a habit the product can't prompt.
- **Alternative:** Make the **morning open** the guaranteed hand-off. If yesterday wasn't reviewed, the Today zone shows one quiet row: "Yesterday: 3 open · Continue / Not today / Later". It expands to one-tap actions and never blocks. The evening review stays optional, for reflection and natural-language adjustments. This uses the same F07 candidate logic in a different place, so it adds no new scope. *Cost:* less pull toward an evening ritual. *Benefit:* the loop works even on skipped evenings.
- **Verify:** Trial log: for each day, did Brian use the evening review, the morning hand-off, or neither?

## Other findings

| # | Severity | Kind | Finding → recommendation |
|---|---|---|---|
| 6 | major | design | **Four similar "removes"** (F06): set aside, remove reference, remove history reference, cancel. Fix the interface vocabulary:<br>• Task row: **Done** · **Another day ▾** (Tomorrow / Weekend / Next week / Pick / No date) · **Not today** · overflow **Cancel task**, **Open**.<br>• Reference: **Remove reference** only.<br>• History page: task placement is read-only, with a "shown at current status" label.<br>Every toast names the effect. |
| 7 | minor | design | **Three task dates are a data model, not a UI vocabulary** (02 §日期与时间, F09). Show plain phrases, and only the fields that are set: "Do Wed", "Start Wed · Due Fri". In Upcoming, show one row per task per date with a `start`/`do`/`due` tag. *Hypothesis:* `attention_on` and `planned_on` may collapse in real use; log it if Brian ever sets both on one task. |
| 8 | minor | design | **Typing a task in Notes does nothing** (D03). Keep D03, but add a faint, ignorable inline hint when a line contains a date phrase (`↵ Make task?`), plus `/task` and `[]` shortcuts. No AI call is involved. |
| 9 | minor | design | **Navigation can be 3 entries:**<br>• **Today** (← → dates, "Back to today")<br>• **Pages**<br>• **Upcoming** (tabs: by date / No date / Not today)<br>Search becomes a global ⌘K. This gives set-aside and undated tasks one findable home. Add one review line, "4 items set aside this week · Look", with no badge. |
| 10 | minor | design | **Reference picking** (F04 leaves the trigger open): use a single `[[` trigger whose results include **blocks** (snippet + page title), so referencing a paragraph takes one search instead of a two-step navigation. Whether a touch toolbar is needed depends on question (a)2. |
| 11 | major | design | **The state/copy table is missing.** 01 §通用状态 names the states but not what the user sees, and X01/X13 depend on exact wording. Add the table to 01 before building:<br>• Page indicator: `Saving…` / `Saved` / `Not saved — retry`, persistent rather than a toast.<br>• Capture: `Saved · organizing…` / `Couldn't organize — your text is safe · Retry / Add manually`.<br>• Conflict: `Changed elsewhere · Keep mine / Use other / Keep both`.<br>• Missing reference: `Original removed · Restore`.<br>• Session expired: `Signed out — unsaved text kept here · Sign in`. |
| 12 | minor | design | **Empty first day:** focus the capture bar and show 2–3 example phrasings that disappear after the first capture. No setup required. |

## (a) Questions only Brian can decide

1. **Where does the day's plan live?** Option A is a structured Today zone above free Notes; option B is the plan inside the free document (current spec). I recommend A. Decide after the A/B prototype and before any editor or data-model work, because this choice drives both.
2. **Which device does Brian capture on, and which does he plan and review on?** (Desktop only / phone capture + desktop planning / phone for everything.) This changes the capture bar, reference picking and editor choice; BlockNote on mobile is unverified. It's cheap to answer now and expensive to change later.
3. **Is the evening review an existing habit, or one he wants to form?** If it's new, I'd make the morning hand-off the default (finding 5).

## (b) Smallest experiment I'd run

A **clickable low-fidelity prototype** (static HTML, about 1 day, no backend and no AI) using Brian's real items over 3 consecutive days. It would show:

- the Today page in model A and model B;
- a capture receipt with one seeded wrong date to correct;
- "Not today" and finding the item again;
- a morning after a skipped review;
- `[[`-referencing a paragraph from a page.

Brian does 6 scripted tasks while thinking aloud. Outputs: the A/B choice with reasons, correction time, and a list of "where did it go?" moments. This is design evidence for questions 1–3, not evidence of daily value. It complements a real-use trial and doesn't replace one.

## (c) What I'd cut from round 1

- AI draft generation on page open (finding 2), along with its pending/merge states.
- The `selected_text` AI mode ("整理这段", tidy this paragraph). Typing shortcuts plus capture cover it, and it can come back after the trial if it's missed.
- If model A is chosen: "update available → merge into body" for plan items. The Today zone is live, so nothing needs merging.
- The per-task change-history view on history pages (F09). Keep the data, show only "shown at current status", and defer the timeline UI.
- The fourth navigation entry (finding 9).
- Markdown export, which 02 already marks as optional.

## Cross-review

I read `bumblebee-product.md`, `wheeljack-engineering.md` and `ratchet-review.md`.

**1. Single source of the day's plan — conditional.** Wheeljack and Ratchet reach the same rules I want: the Task is the fact; placement is the day's selection; the Block is only presentation; deleting text never silently changes commitments; "Not today" is an explicit action. The open question is only *where* the placement/reference distinction is visible. Inside one editor, "placement block" vs. "ordinary reference" needs a visible difference plus delete rules for each (Ratchet #2 states this condition itself). A separate Today zone is the simplest visible difference, and it shrinks the editor work Wheeljack flags as unverified (#5): only reference blocks are custom in Notes, and there's no merge for plan items.
- *Floor I can accept:* the plan stays in the body, provided (a) placement rows look different from references, (b) Backspace on a placement row does not change state (it asks, or shows "Not today · Undo"), and (c) the attention area hides items that are already placed.
- *What would change my mind:* the A/B prototype showing that Brian wants prose between plan items.

**2. Carry-over — yes, merge into one rule.** Use one deterministic set: open, not paused, and no future planned date, *including tasks that are undated and were never placed*. That's Wheeljack's carry frontier and Ratchet's unscheduled inventory, which are the same query. Order by last explicit placement, then creation time. The rule has three views:
- up to 3 items as suggestions in the Today zone;
- one collapsed row below them, "Still open · N · oldest 6 days" (Bumblebee's row, and my morning hand-off);
- a "No date / Not today" tab in Upcoming (Ratchet's entry).

The cap limits only what's shown, never eligibility. Agreeing with Ratchet: set-aside items whose attention date has arrived fold into that same collapsed row, not into a separate attention list, so they don't become a second backlog.

**3. AI on page open — no conflict.** Bumblebee's concierge test drafts the next day **in the evening, from the review**, which is exactly where I'd move generation. What's left is the skipped-review morning. The deterministic plan plus the "Still open" row shows instantly, and an explicit "Draft my day" button is allowed, so the AI is never called automatically on open. The concierge log should record skipped-review mornings separately, so we can see whether the missing draft actually hurt.

**4. Material loop — agree the pain is real (goal); the build commitment is conditional.** Hand-picked references alone repeat the "saved, never revisited" failure. But resurfacing is a value hypothesis, and Wheeljack's context cost (#6) is real. So test it in the concierge run first (0–2 related items with a reason), and build it only if Brian actually uses them. If it is built: one dismissible "Related" line in the Today zone, never inserted into the body, with open/use logged.
- On cutting block-level references: acceptable for round 1 **if** opening a page reference lands on the matched passage (search highlight). That keeps most of the "find the paragraph" value without stable block-ID references.

**5. Confirm before changing existing items — agree, with interaction conditions.**
- It applies only to **AI-proposed** changes. Direct UI actions (checkbox, Not today, date picker) never ask.
- The confirmation is inline in the receipt card ("Meeting Wed → Thu · Apply · Edit · Discard", with Enter = Apply), never a modal.
- A capture that mixes new and changed items creates the new ones immediately and holds only the changes.
- After the trial, check whether AI "done" is safe to auto-apply with Undo.

**6. Validation order.**
- *In parallel, now:* the rule-replay tables (Ratchet + Wheeljack); Brian's 3-day baseline (Bumblebee, needed anyway); and a **smaller** prototype from me. I'm cutting it to a half day: the Today zone A/B and the receipt card with confirmation, built on the same real items.
- *Then:* the concierge test, which needs Brian's go-ahead for paid model calls.
- *After the A/B decision:* the editor spike, because A vs. B changes its scope.
- *Cut:* nothing entirely. My prototype no longer needs to test value, since the concierge run covers that.

**Missed blocker:** none new. The primary-device question (my Q2, also in Wheeljack's questions) should be in the first batch of questions for Brian. A phone-first answer changes the capture entry point, the A/B layout and the editor choice before any spike.
