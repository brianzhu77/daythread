# The review on the page: a Tomorrow block, no screen, no button

Status: built Oct 26 (PR 2 of 4 after design system v2), replacing B31's one-screen review.

## What his data says (export of Oct 26, rev 408)

- B31's one-screen review went live Oct 24. On Oct 24 and Oct 25 the review was not saved once; the morning card was
  used both mornings (`handoffDone` on every day since Oct 22).
- Before B31, the only evening list he made was written by hand on the day page itself (Oct 23, "明天：" under
  Notes, two lines that never reached Oct 24).
- His Oct 23 note on the review: "Review 太难用了，一大堆按钮，还有很多steps，一点都不直观" (too hard to use, a pile
  of buttons, many steps, not intuitive). His Oct 25 note on the page: "#daythread 过度设计：Top 3/Others/Events/Good
  Stuffs" (over-designed).

So the review's job, "say what tomorrow is", happens on the day page or not at all. A separate screen, however short,
is a step he does not take. Ticking what he finished he already does on the page. Carrying what is left he already
does on the morning card.

## The shape

The review is a block at the bottom of today's page, under the page and its subpages: **Tomorrow · Mon, Oct 26**.

1. **Tomorrow's to-dos**, if its page already has any (a line he added earlier, or something planned from a task's
   ⋯). Each row is a to-do marker and the title; ⋯ on a row has one item, Remove from tomorrow.
2. **A line to type into**, "Add for tomorrow". Return adds the line and moves to the next. Each line becomes a to-do
   on tomorrow's page at once (`ensure-day` for tomorrow on the first line, then `add-task` into its TODO), the same
   mechanics as B31's add list: a plain input, so Return while a pinyin candidate is open confirms it (B49); every
   line has its own operation id and stays on screen with Retry until it is saved; a reload keeps unsaved lines.
   B68 (Oct 29, task #227): nothing typed here vanishes. Unsaved lines are kept on the device under the signed-in
   account (`daythread.tomorrow-lines.<owner>`; sign-out leaves them, another account never sees or sends them), each
   with the date it was for. A line still unsaved after its day shows in the next day's block as "From last night ·
   Not added to today · Retry" ("From Mon" when older) and saves to the later of its date and today. Every pending
   row has its state on its own line under the title. Lines under the old per-day keys go once to the first account
   that opens the block after the update. The input is kept as he types and becomes a line on Return, when he leaves it, and on `pagehide`, never while
   a pinyin candidate is open; a draft found after the app was killed goes back in the input, not into the list.
   The draft is kept under the account too.
3. **One quiet line** under it when today still has open to-dos: "3 unfinished to-dos come along in the morning."
   That is what the morning card does; the block only says so.

There is no Done. The first line that saves marks today's review as saved (`save-review`), so the day's record says he
planned the next day from this page; nothing else reads that flag. Tomorrow's hand-off stays with the morning card:
open to-dos come along in the morning as they do today, and after midnight the morning card is the plan for the day
that just started, which is how he used it on Oct 24.

Removed: the `/review` screen (the route stays and opens today's page, for reminder links in the wild), the sidebar's
Review entry, the "Review today" and "Review saved · open again" buttons at the bottom of a day page, the "Comes
along tomorrow" list with its per-row ⋯ (ticking and moving are done on the page), the review's header, sub line
and Done.

The block shows on today's page only. A past day has no next day to plan; a future day is a preview.

## Success check (7 evenings after live)

- Lines added from the block on 3 or more evenings, and every one of them on the next morning's page.
- No hand-written "明天" list in Notes.
- No new complaint about buttons or steps.
