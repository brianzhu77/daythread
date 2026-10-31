# Preparing a new day as a draft (product analysis)

Status: **proposal, not decided.** Source: Brian 361325a5 (2026-10-31 18:09Z). Owner: Bumblebee (product). Interaction and
states: Jazz. Engineering read: Roadbuster 30dd8d29. Decisions go to Brian through Lead.

## What Brian asked (his words, translated)

- "I updated my day template. It now contains the full review."
- "Check whether we can simplify some system components."
- Goal: "when preparing a new day, feed in the previous day's notes; an LLM outputs suggestions for the new day following the
  template. The user can apply the whole thing or apply piece by piece, a bit like a code diff."
- "I don't like the big card on top where I choose, item by item, whether it's today or some other day. It isn't natural."

## Facts (read-only, his workspace only, 2026-10-31 18:10Z)

- His Day template (default for day pages) is 33 blocks: **Morning Planning** (Events, Top 3 with a quote and 3 empty
  to-dos, Other - Outside the Tunnel with an empty to-do, Intentional Drop / Slack), **Raw Notes** (+ Inspiration),
  **Daily Reflection** (Progress, Tunnel Check, Borrowing Check, Tomorrow's Todo), each prompt as a quote.
- The Tomorrow block (evening input) has saved on 0 of 4 evenings since it shipped. His template now has its own
  "Tomorrow's Todo" section.
- The app has no model call today (Roadbuster). The morning card is deterministic.
- Open to-dos can be older than yesterday ("TRV for Lu and Kathy" has been open since Oct 23), so "yesterday's notes" alone
  does not cover everything open.

## Product judgment

The thing he rejects is the **form** (a separate card, one decision per item, a date choice per item), not the job
(start the day from what was left open and what he wrote). The new form: the new day's page shows a proposed version of
itself, filled in his template's shape, and he accepts all of it or piece by piece, in place.

Two parts, which can ship separately:

1. **The draft-on-the-page interaction** (replaces the card). Needed in every case: it is also what shows when the model is
   off, offline or fails, filled by today's deterministic rules (open to-dos into the first to-do section, as B74).
2. **The model filling the draft** from yesterday's page, every open to-do and today's events, following the template.
   Needs Brian's yes on privacy, provider and when it runs.

## Cut list (what each current component does, against the new flow)

| Component | What it does today | With the draft | Call |
| --- | --- | --- | --- |
| Start the day card (`start-the-day.tsx`) | Yesterday's open to-dos, + / Add all, Not today, Another day per item, Done | The draft proposes where each open to-do goes | **Cut** |
| Bring to today (in the card) | Copies a line from yesterday into today | The draft can propose a line from yesterday in the right section | **Cut** as UI; `bring-line` may stay as the apply step |
| "Continue?" fact line | Reopens the card after Later | No card | **Cut** |
| Tomorrow block (`tomorrow-block.tsx`) | Evening input; lines become tomorrow's to-dos | His template's "Tomorrow's Todo" is read by the draft; 0/4 evenings used | **Cut** (keep B68's rule that nothing typed is lost: migrate any pending lines once) |
| Not today / Another day | Per-item date choice in the card | Not part of the morning; stays in the row ⋯ menu and on Tasks | **Keep, move out of the morning** |
| Carry placement (B74, #44 Events/Bring rules) | Where inserted rows land | The draft decides placement; the rules stay as the fallback draft | **Keep as fallback** |
| Due soon / events strip (facts) | Computed facts above the page | Inputs to the draft; the strip itself is data, not explanation | **Keep for now**, revisit after the draft ships |
| Tasks screen, reminders, templates | Task store, push, template editing | Unchanged | **Keep** |

## Rules the draft must keep (product bar)

1. **Nothing open silently drops.** Every open to-do appears in the draft (placed, or listed as not proposed) or stays
   visibly open on Tasks. A model that leaves one out does not make it disappear.
2. **To-dos stay the same tasks.** Applying a carried to-do moves the existing task (same id, history, done state); only
   new items become new tasks (Roadbuster's constraint, unit-testable before any UI).
3. **His words are never overwritten.** If he has already written on the page, applying only inserts; a stale draft fails
   safely (`expectedContent`).
4. **Nothing waits on the model.** The page is made from the template at midnight as today; the draft arrives when ready, or
   the deterministic one shows.
5. **Reflection is his to write.** The draft fills planning sections only and leaves journal prompts empty (his Daily
   Reflection, Raw Notes), unless he says otherwise.
6. **Works for any template and any user.** Invitees on the built-in template get the same interaction; whether the model
   runs for them is a separate opt-in.
7. **Minimalist copy** (Brian 1ac6784b): no explanatory text in the draft.

## Settled (Lead 055b72c0)

1. **Provider:** OpenRouter, which Brian said yes to on 2026-10-19 ("Draft my day", 15c94de, 903f3a7). `OPENROUTER_API_KEY`
   and `OPENROUTER_MODEL` are already set. Cost is ours, cents a month.
2. **When:** when he first opens the new day. No cron job. The page is made from the template as today, and the draft
   arrives on top.
3. **Failure:** the template page stays as it is, and the draft comes later or not at all.

Open before inviting others: invitees' notes would go to the same provider. Model drafting stays off for them until they
turn it on (rule 6).

## Suggested order

1. **Now, in parallel (Lead 055b72c0):** Roadbuster's experiment on the `before-b74` copy through OpenRouter (yesterday's
   page, open to-dos with ids, today's events and the template in; a block list anchored to template block ids out),
   raw outputs by 19:30Z. Bumblebee scores them against what he actually did on the next day. Jazz does states and the
   prototype. Ratchet does the risk list and test plan for applying a draft.
3. **Then:** build the draft UI with the deterministic fill, cut the card, the Continue line and the Tomorrow block in the
   same release; switch the fill to the model once the experiment passes.

## Success checks

- Usage read, his workspace: on most new days he applies the draft (whole or in part) without opening Tasks; time from
  first open to first apply.
- No open task disappears from both the page and Tasks (count before/after each apply).
- No duplicate tasks from applying (task count grows only by new items).
- Applied items still on the page at the end of the day (he did not delete most of what he applied).
- Brian does not describe the morning as unnatural again.

## Experiment score (Bumblebee 98e0dcb9, on Roadbuster d1f24561, `exp/day-draft` 2772d58)

Five days on a copy of `before-b74`, OpenRouter `deepseek/deepseek-v4.1-flash-1017`, 3–4.4 s and about $0.0004 a day.

- **Pass:** no invented items, every to-do by id, reflection left empty on all 5 days, slots filled in place. Oct 28
  proposed PRD, Mazda and Credit Card for Top 3, and all three were done that day (planned dates may have leaked in).
- **Fail, rule 1:** an open to-do dropped on 3 of 5 days (Oct 28 TRV and 买狗窝; Oct 29 买狗窝; Oct 31 买狗窝, which was
  planned for that day). The app enforces it: a to-do planned for today that the model did not place is inserted by the
  fallback rule in the same diff; other open ones show under Jazz's "N more open". Ratchet tests this on real model output.
- **For the build:** no dated lines copied into Events (events come from events, else they show twice); no "why" text in
  the UI (logs only); the prompt names the account, not "Brian".
- Real quality ("did it guess his day") can only be judged from Nov 1 on, when he writes days on the new template.

