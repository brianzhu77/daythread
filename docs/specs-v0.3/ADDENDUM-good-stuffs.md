# Addendum · Good Stuffs follow-up — v0.3.1 draft

- Task #19 · Owner: Bumblebee · Reviewer: Jazz · 2026-10-16
- Status: **approved by Jazz (reviewer) at `ade04c01`, plus the reviewer's three wording clarifications in G-2; not yet folded into 00/01/04.** Nothing here has been built or tested. It amends the committed
  v0.3 set (commit `41146f0`: 00 `25c216d9`, 01, 04 `68e9703b`) and will be folded into 00, 01,
  and 04 once approved. Until then, where this file and v0.3 disagree on saved-material
  follow-up, this file wins; everything else in v0.3 stands.
- Field names and storage are authoritative in 02 (Wheeljack). This file states the product
  rules 02 must support.

## 1. What Brian asked for

> "on good stuffs: 我希望能够有一个回顾，下一步是选择降低权重还是日后还需要继续关注等等。避免被放进来之后就被遗忘了"
> — Brian, #daythread:3cf148c1 msg `0f106fa5` **[Goal]**

The Lead's commitment back to him (msg `25974b3b`): each saved item gets a follow-up decision,
**without becoming a list he has to clear**. Both halves are requirements.

## 2. Gap in v0.3

A saved item can come back only if the model picks it for the "Related" line (00 D15, scope
item 11), or through the one-item "Not opened in 14+ days" line (01 §6.7 item 7). An item that
is never picked never gets a decision, which is the "saved then forgotten" case. v0.3 also
has no way to say "less of this, but don't drop it": the only option is **Don't resurface**.

## 3. Rules

### G-1 Follow-up states [Design]

Every saved material item has one follow-up state. Saving material never asks a question;
new items start as **To sort**.

| State | Set by | Comes back in the sort step | "Related" candidate |
| --- | --- | --- | --- |
| **To sort** | Default on first save | Yes, when eligible (G-2) | Yes |
| **Keep watching** | Brian | Yes, 7 days later or on a date Brian picks | Yes |
| **Lower priority** | Brian | No | Yes, but the model is told it is low priority and the line must give a reason tied to tomorrow's plan |
| **Done with it** | Brian | No | No |
| **Made into a task** | Brian | No | No (the item becomes the new task's source link) |

- **Don't resurface** (P18) stays a separate flag, not a state. It excludes the item from the
  sort step and from "Related" whatever the state. It's for things like shopping links.
- Every state change applies on tap, shows a notice with **Undo**, and can be changed later
  from the material item's ⋯ menu. Nothing deletes the material or its source lines.
- Saving an already-saved URL again (P14) does not reset the state, except that a **Done with
  it** item moves back to **To sort**, because saving it again means it matters again.

### G-2 The sort step [Design, refines Jazz's proposal in msg `69eac423`]

- **Where:** an optional step in the evening guided review, right after step 1 (Today's plan),
  titled "Saved items". It appears only on nights when at least one item is eligible.
- **Eligible:** **To sort** items saved at least 2 days ago, and **Keep watching** items whose
  return date has arrived. Items marked Don't resurface are never eligible.
- **How many:** at most 3 a night, oldest first (by save date, or return date for Keep
  watching).
- **Each card:** the title, the source line from the day it was saved ("Saved Tue in Good
  Stuffs"), Brian's note if he wrote one, and **Open**. Choices are one tap: **Keep watching**
  (a date picker is optional) · **Make it a task** · **Lower priority** · **Done with it**.
- **Skipping:** **Skip** on a card, or skipping the whole step, leaves the item in its state.
  Only the cards actually shown that night get the 3-day delay; other eligible items are not
  affected. This keeps the same three items from blocking the queue every night.
- **No AI.** This step makes no model call and works when the budget is used up or the model
  is down.
- **Not part of review completion.** `review_saved` is unchanged (01 §7). The step never
  blocks or delays it, and skipping it isn't a skipped review. **Finish** on this step sets
  `review_saved` exactly as Finish on any other step does.
- **Phone layout (Jazz, 01):** the card shows **Keep watching · Lower priority · Done with it**
  as buttons; **Make it a task** and **Pick a date** sit under the card's ⋯ menu. After Make it
  a task the notice reads "Task created · Unscheduled · Open". The rules above don't change.

### G-3 Not a list to clear [Goal, from msg `25974b3b`]

- **No counts anywhere:** not on the facts strip, not in the review header, and no badges.
  This changes Jazz's proposal, which had "N saved items to sort" on the facts strip.
- No "you're behind" or "inbox zero" language. When there's nothing eligible, the step is
  simply not shown, with no "all done" message.
- Pages may offer a **To sort** filter on the material list, so Brian can sort on purpose.
  That list shows items, not a count.
- The cap of 3 and the 3-day skip delay mean an unsorted backlog grows silently instead of
  being pushed at Brian. Whether that's acceptable is a trial question (§5).

### G-4 Relation to v0.3

- **Replaces** the "Not opened in 14+ days" fallback line (01 §6.7 item 7, and the line in
  01 §7 "Optional review lines"). Two non-AI resurfacing mechanisms would compete; the sort
  step covers the same need with a decision attached.
- **Extends** 00 D15. The resurfacing set is unchanged (Good Stuffs links, optional seeds, minus
  Don't resurface), minus **Done with it** and **Made into a task**. Lower priority items stay in
  the set, marked as such in the model input (03, Ratchet).
- **Leaves alone** the "Related" line, its kill rule, the morning hand-off, and "Bring to
  today" for Good Stuffs lines (01 §3.5). Bringing a line to today doesn't change its state.

## 4. Acceptance cases (to be folded into 04 §R)

These use the 04 fixture (G1, G2, G3 with G3 Don't resurface). Dates are Vancouver days.

| ID | Action | Expected | Invariant |
| --- | --- | --- | --- |
| G01 | Save G1 and G2 on Mon; open the review on Mon and on Wed | Mon: no "Saved items" step. Wed: the step shows G1 and G2 (oldest first), never G3. Saving asked no question. | — |
| G02 | Save 5 items on Mon; review on Wed | The step shows 3 cards. No count of the other 2 appears anywhere in the app. | U06 |
| G03 | Tap Keep watching on G1 on Wed; review Thu and the next Wed | Thu: G1 not shown. Following Wed: G1 shown again. A picked date overrides the 7 days. | — |
| G04 | Tap Lower priority on G2 | G2 never comes back in the step. It stays in the resurfacing set marked low priority, and stays searchable. Undo restores To sort. | I2 |
| G05 | Tap Done with it on G1; later save G1's URL again | After Done: G1 is not in the step and not in the resurfacing set; it still opens from its source line. After saving again: G1 is To sort, with both source lines kept (P14). | I2 |
| G06 | Tap Make it a task on G2 | One new task, placed nowhere until Brian places it, whose source link is G2. G2 is out of the step and the resurfacing set. Retrying the tap creates no second task. | I2 |
| G07 | Skip the whole step on Wed; review Thu and Sat | Thu: same items not shown. Sat: they can show again. `review_saved` on Wed is not affected. | — |
| G08 | Budget exhausted (X23) or model down; open the review | The step works normally. No model call is made from it. | I5 |
| G09 | Nothing eligible | No step, no empty state, no "all sorted" message. | U06 |

All state changes are logged with the item, the state, and the date, for §5.

## 5. Trial measures (to be folded into 00 Success and 04 §T)

Thresholds below are proposals for 00; they're hypotheses, not evidence.

- **Main signal:** the share of saved items (excluding Don't resurface) that get a decision
  within 7 days of becoming eligible. **Target ≥ 50%.** The point is that saved items stop
  vanishing without a decision.
- **Usefulness:** items opened from the step, and Keep watching items later opened, used in a
  note, or made into a task.
- **Burden fail signal:** Brian says the step feels like a list to maintain (added to the
  existing burden question in 04 §T), or he skips the step on 5 or more of the 7 trial nights
  when it was shown. If that happens, the next options are to move the step to a weekly
  review, or to show it only when Brian opens the To sort filter. We would not add reminders
  or counts.
- **Daily log question (add to 04 §T):** "Did the saved-items step help you decide what to do
  with things you saved, or did it feel like a chore?"

## 6. Follow-ups by owner

| Owner | Change |
| --- | --- |
| Wheeljack (02) | Follow-up state, return date, skip-until date, and state-change log on material. Saving the same URL again reopens Done items (G-1). Make it a task is idempotent (G06). |
| Ratchet (03) | Lower priority marking in the daily-draft input; Done / task items left out of the resurfacing set. |
| Jazz (01) | Sort step in §7, item menu actions in §6, removal of §6.7 item 7 and the §7 optional line, no count on the strip. |
| Bumblebee (00, 04) | Fold G-1 to G-4 into D15 and scope item 11; G01–G09 into §R; §5 into Success and §T; traceability. |

Nothing here needs a decision from Brian before building. The defaults (2 days, 3 a night,
7-day return, 3-day skip delay) are team choices to adjust after the trial.
