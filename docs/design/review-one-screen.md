# B31 · Evening review on one screen (design proposal)

Status: **proposal** for Lead to pick against Bumblebee's day-end read (task #150). Not approved.
Mock: `docs/design/b31/mock.html`, screenshots `b31-shape-390.png` and `b31-shape-1280.png` (his real Oct 23 lines).

## What his data says (row rev 362, read-only copy)

- Reviews: opened on Oct 22 and Oct 23, both left on step 1. Saved once (Oct 23), reflection empty every day.
- On Oct 23 he wrote tomorrow's list by hand in Notes: "明天：" with "万圣节装饰、衣服" and "Kathy 的作业，family culture".
  **Neither line reached Oct 24.** Notes don't carry, so the list he actually made was lost; Oct 24's Top 3 holds only the three carried tasks.
- The morning card already carries every open task (hand-off done on Oct 22, 23 and 24). So the review's per-task
  Tomorrow / Not today / Another day buttons repeat a decision the morning card makes again a few hours later.

## The shape

One screen, no steps, one button. The screen is about **tomorrow**, because that's what he wrote by hand.

1. **Title** "Tomorrow · Sat, Oct 24", a quiet line "Friday: 2 done · 3 still open", and **Done** top right
   (the only button; top right so the phone keyboard never covers it).
2. **Comes along tomorrow**: today's open tasks, in outline order (B28 tree), with their Top 3 tag. Each row has a
   checkbox (done, with Undo in the row) and ⋯ (Another day…, Not tomorrow). No other buttons. Nothing to do here
   means they come along, as today.
3. **Add for tomorrow**: a list he types into, like his 明天 list. Return adds the next line. Each line becomes a
   to-do on tomorrow's page right away (`ensure-day` for tomorrow on the first line, then `add-task` into Other).
   ⋯ on a line: Remove, Make it Top 3.
4. **Done** does tomorrow's hand-off and saves the review: `plan-tasks` for tomorrow with the rows still in
   "Comes along" (each with its section, the same call as the morning card's Add all, so B34 nesting holds), then
   `handoff-done` for tomorrow, then `save-review` (finish). Back to today with "Saturday is set · 2 come along, 2 added".
   The morning card then has nothing left to ask, so there is one place for this job, not two (Bumblebee's risk).
   Leaving without Done loses nothing already ticked or written; the carry then happens on the morning card as today.

Removed from the review: step numbers, Skip tonight, the capture bar (the add list does that job), the reflection
box (never used), the saved-items sorting (moves out of the review; still reachable later if wanted), and
Prepare tomorrow / suggestions / Save for tomorrow (B47 put "Draft my day" on the morning card, which is where he
looks at suggestions).

1280 is the same single column, centered, max 640 px. It's a short list, not a dashboard.

## States

- **Nothing open, nothing added:** "Nothing comes along from Friday." The add list shows its empty line focused.
- **A line fails to save:** it stays in the list with "Not added · Retry"; the text is never lost.
- **Another device changed things:** the list follows the workspace as everywhere else; a ticked task shows as done.
- **Late review (after midnight, or an older day):** title uses that day + 1, e.g. reviewing Friday at 00:49 Saturday
  (what he did on Oct 24) adds to Saturday, which is now today, and Done is that day's hand-off. The title's date makes that clear.
- **Reminder link:** unchanged URL; the opened-from-reminder count stays.

## Choices for Lead

- **New lines go to Other (recommended) or Top 3 while it has room.** Other keeps the carry rules unchanged and
  Top 3 stays his explicit choice (⋯ Make it Top 3).
- **Done performs the carry (recommended, revised after Bumblebee dd816a10).** He already planned Saturday from the
  morning card at 00:49 his time, so the card is his night tool too; Done doing the same hand-off makes them one job.
  Reviewing after midnight is then exactly the morning card's hand-off for today. Fallback if it proves risky: card
  unchanged and the evening list is only a preview.

## Not decided here

- Whether a "明天：" note should be picked up automatically. My lean: no; give him the add list instead and see if
  he uses it (success check is Bumblebee's).
