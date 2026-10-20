# Morning card with the model: Draft my day and proposals — states (A6b step 1)

Owner: Jazz (Design). Status: proposal for the A6b plan (Lead `b7f87619`). Builds on
`docs/design/morning-card-build.md` (§3, §4, §8, §12) and `docs/design/v05-morning-and-weave.md` §1.
State words and colours come from `docs/design/capture-receipt-v2.md`. Where this file and §12.2 of the card spec
disagree, this file wins (it merges the two failure lines into one, see §3).

Scope: what Brian sees in the **Start the day** card while the model drafts his day and after. Review suggestions
and Related are a later step; they reuse the same state words.

## 1. One call, one result

- **Draft my day** and **proposals** are one model run that writes `page.draft` for today. The run returns
  suggested tasks (picked from his open tasks) and proposals (lines that aren't tasks yet). Both show in the card;
  nothing is written to his page or his tasks until he taps `+` (v05 §1.3).
- **Trigger: his tap only.** No model call when a page opens or reloads. Reasons: cost stays visible and
  predictable, a reload never runs it twice, and step 1's success criterion ("he uses it on 2 of 5 mornings",
  Bumblebee `c741457c`) needs a real choice to measure. A finished evening review also writes a draft, as now, without the model in step 1 (Lead `f94c640d`): on those days the card shows "Suggested last night" and no Draft my day. So a morning has at most one real model run.
- **One draft per day.** Once today has a draft (from the review or from Draft my day), the link goes away. No
  "draft again" in step 1. Retry exists only after a failure (§3).
- The run belongs to the day it was started for. A tap at 23:58 that finishes at 00:01 lands on the earlier day.
- **Done or Later while drafting:** the result is kept but never reopens the card. After Done, nothing shows today.
  After Later, the strip count updates. A result that arrives after a newer Retry is dropped (Ratchet `b64dd79d`).

## 2. Where the link is

- **Card shown** (open tasks or lines qualify): the Tasks group line "No suggestions from last night · **Draft my
  day**", as now (`start-the-day.tsx:180`). Tasks rows below it work as normal.
- **Card not shown today** (nothing qualifies), a gap today: there's no way to run it. Show the card with only that
  line plus Done / Later when today has no draft and no failure. Done hides it for the day as usual. This is the
  only change to when the card appears.
- **Later strip:** "Suggestions · {n} ▸" counts rows only; while a run is going, it reads "Suggestions · drafting…".

## 3. States

Wording (Bumblebee `9a13d092`): the capture receipt's lines, with "· nothing was added" in place of "· text saved". Every state line uses the card's existing line style (the size and spacing of "No suggestions from last night"), in the same spot, so only the words and colour change between states and nothing below moves. Retry looks like the Draft my day link. "Cost unknown" follows inline in the same text and wraps with it. Tasks rows, lines, Done and Later keep
working in every state. Never red.

| State | What shows | Action |
|---|---|---|
| Ready, no draft | "No suggestions from last night · **Draft my day**" (`--ink-2`) | Draft my day |
| Drafting | "Drafting your day…" with the 14 px spinner, `--ink-2`. No placeholder rows | none; he can leave and come back |
| Done, with results | The line goes. Suggested tasks join the Tasks group with **"Drafted for today"** (so a model pick never reads like his own "Suggested last night") as their reason. Proposals appear under **FROM YOUR NOTES** | `+` per row |
| Done, nothing to suggest | "Nothing to suggest today" (`--ink-3`), no link | none |
| Simulated (no model key) | Results as above, plus the existing **"Simulated"** tag in the card header | as above |
| Key rejected | "Model key rejected · nothing was added" in `--warn` | **Retry** |
| Model unavailable (error, timeout, every item invalid) | "Model unavailable · nothing was added" in `--warn` | **Retry** |
| Paused (a cost couldn't be confirmed) | "Model paused · a cost couldn't be confirmed · nothing was added" in `--warn` | none |
| Stuck (still drafting 90 s after the tap: the 60 s call plus margin, or the server restarted mid-run) | The server ends the run as failed (Ratchet `676b6ad1`, Lead `c1ba8868`). With no generation id: "Model unavailable · nothing was added". With a generation id whose cost can't be found: the Paused line below. A late answer from that run is dropped | **Retry** for unavailable; none when paused |
| Busy (a capture is with the model; one call at a time in step 1, Ratchet `ae9c7b87`) | "Model busy · nothing was added" in `--warn` | **Retry** |
| Too large (yesterday's page alone is over the context limit) | "Too much to read in one go · nothing was added" in `--warn` | none (Retry would fail the same way) |
| Budget used up | "Today's model budget is used up · nothing was added" in `--warn` | none until tomorrow |
| Cost unknown (error with no cost or id) | the failure line above, then a muted **"Cost unknown"** tag in `--ink-3` | as the row says |

- This replaces §12.2's separate "Suggestions from your notes unavailable" line: proposals and suggested tasks come
  from the same run, so one line covers both.
- **The other way round:** a capture saved while Draft my day is running keeps his text and its receipt reads
  "Model busy · text saved" with Retry (capture receipt vocabulary). Neither waits silently for the other.
- **Some linked pages left out** (over the limit, Bumblebee `e24bfd8c`): results show as normal, plus one muted `--ink-3`
  line under the Tasks group: "Read yesterday's page and {k} of {n} linked pages". Not shown when everything was read.
- Retry is the same run again and keeps the day it was started for. A Retry that fails shows the same line.
- No cost figure anywhere in the card, as in §12.2.
- At 390 a failure line may wrap to 2 lines. Retry stays at the end of the text, with a 44 px target.

## 4. Rows after a run

- **A task the card already offers** (Unfinished · from {Mon}, or Suggested last night) keeps its reason and its
  destination when the model also picks it. The model adds nothing new there, and "from Mon" is the fact he needs
  (Lead `e5806572` with Bumblebee `c34c3531`, after the real-model run on 97d1679). "Drafted for today" is only for tasks the card wouldn't offer
  otherwise.
- **Drafted tasks** ("Drafted for today"): already tasks, so card spec §3 applies (shown once, empty-title tasks and
  tasks already planned for today never shown), except where they go: `+` sends them to the **plan list section**
  (his "TODO - Other"), never Top 3. Top 3 holds only what he chose, including "Suggested last night"; a model pick
  is a proposal and moving it up is one drag (Lead `c1ba8868`, after Bumblebee). Strip: "Added to {Section} · Undo".
- **Proposals** (card spec §4 and §12.1): title = his line word for word, reason "{Mon} · {Section}" computed by
  the app, date tag only when grounded in his text, dashed `+`. `+` creates a new task with the full line:
  - **no date, or the date is today** → a row in today's {plan list section}; strip "Added to {Section} · Undo";
  - **a later date** (the tag shows "Do Fri, Oct 23") → the task is planned for that day, like a dated capture, and
    today's page gets no row; strip "**Added for Fri, Oct 23 · Undo**" (Bumblebee `a487ca0e`). It shows on Calendar
    and Upcoming, and on that day's page when it comes.
  Undo deletes the task (and today's row, if any). ⋯ → Hide for today.
- A live proposal isn't also listed under "{n} lines from {Mon}". If it's hidden or withdrawn, the line goes back
  there; once added, it's linked and leaves both.
- **The source changed after the run.** A proposal points at its source line by block id. When the card draws:
  - line text edited → the row isn't shown. The model judged the old words ("call the dentist tomorrow" edited to
    "called the dentist" must not become a task, and a changed date word must not keep the old date). No automatic
    re-run (Ratchet `8ba9abb6`);
  - its page moved under a different day (the anchor for words like "明天" changed) → the row isn't shown, the same
    as an edit, with no re-run (Ratchet `c19b111a`). Date tags follow the rule "no tag when unsure": the model's date
    must equal the date the app parses; relative words on a top-level page give no tag; a subpage uses its day;
    absolute dates work anywhere;
  - only its section renamed → the row stays and the app-computed reason shows the new name;
  - line deleted, its page in trash (A4), or the line already became a task → the row isn't shown.
  - `+` checks the same thing at tap time; if the line changed, the tap adds nothing and the row leaves.
- **Never proposed:** page cards (§12.4), lines in trashed pages, lines already linked to a task, his own empty rows.

## 5. Checks (for Ratchet), on a copy of Brian's data at 390 and 1280

Use the fake model (`scripts/fake-openrouter.mjs`): `http401:`, `http500:`, `slow:`, and the budget cap
`DAYTHREAD_MODEL_CAP_USD`.

1. Opening and reloading today makes no model call. Only the tap does.
2. Drafting shows "Drafting your day…"; leaving and coming back shows the result once.
3. Each failure in §3 shows its line, Retry only where the table says, and tasks rows still work.
4. With nothing to suggest, the card says so and offers no link. Reloading doesn't bring the link back.
5. A proposal's `+` creates one task with his exact line; Undo removes it; the source line is unchanged.
6. Editing a source line's text after the run removes its row (no new model call); renaming its section only updates
   the reason; deleting the line or trashing its page removes the row; `+` on a row whose line just changed adds nothing.
7. With no open tasks and no lines, the card still offers Draft my day until today has a draft.
