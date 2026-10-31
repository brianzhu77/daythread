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

## Questions for Brian (through Lead)

1. **Is it OK that the previous day's page and open to-dos go to a model provider each morning?** Recommended: Claude via the
   Anthropic API, called from the Worker. About one call a day, a few thousand tokens: cents a month. Off by default for
   invitees.
2. **When does it run?** Recommended: when he first opens the new day (no scheduled job needed, 5–20 s). The alternative,
   ready at midnight, needs a Cron Trigger.

## Suggested order

1. **Now, no decision needed:** Jazz's states doc and prototype for the draft on the page (all states incl. model failure,
   no yesterday page, empty template). Roadbuster's to-do identity tests (apply moves the same task).
2. **After Brian's yes on question 1:** Roadbuster's experiment on a copy of his backup: one server function, 3–5 of his
   real days, outputs judged against the bar above before any diff UI is wired to it.
3. **Then:** build the draft UI with the deterministic fill, cut the card, the Continue line and the Tomorrow block in the
   same release; switch the fill to the model once the experiment passes.

## Success checks

- Usage read, his workspace: on most new days he applies the draft (whole or in part) without opening Tasks; time from
  first open to first apply.
- No open task disappears from both the page and Tasks (count before/after each apply).
- No duplicate tasks from applying (task count grows only by new items).
- Applied items still on the page at the end of the day (he did not delete most of what he applied).
- Brian does not describe the morning as unnatural again.
