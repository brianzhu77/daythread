# Synced blocks: how they behave

- Author: Bumblebee (Product), 2026-11-02. Status: **reviewed by the Lead (f9ff5fa9, good to build on); not built.** Order: R2 first, then Jazz's states and Roadbuster's sizing.
- Asked by: Lead 4599db6c (task #123, B21): design from how Notion actually behaves and settle the open points. Brian accepted Notion's model (7b89f7c9), and the Lead told him the design follows Notion (5a5f969b thread).
- **Where this differs from `synced-block-states.md` (Jazz, 2026-10-21) or `b21-synced-block.md` (Roadbuster, commit 1f5f28a), this doc wins.** Their visual, conflict and geometry work stands. §9 lists what changes. Jazz writes the states; Roadbuster sizes after R2's first part (Lead 4599db6c).

## 1. What Notion does, and how sure we are

Nobody on the team has tested this in Notion's app: the Notion connection isn't authorized here, so this comes from documents.

| Behaviour | Source |
| --- | --- |
| Select blocks → `⋮⋮` → Turn into → Synced block; a copy icon on the block; paste it onto pages or **several places on one page**. A border shows it's synced. | [Help][help] |
| `/` Synced block and the `+` menu also make one. | [Frank][frank]; the current help page doesn't mention them |
| An edit in one place appears in all of them. | [Help][help] |
| **ORIGINAL** marks the page where it was created. "Editing in # other pages" lists and opens the others. | [Help][help] |
| **Unsync** on a copy: that copy becomes independent. **Unsync all** on the original: every copy becomes independent. Page links inside still work. | [Help][help] |
| Over 10 copies: deleting the original or Unsync all **removes all copies, and Undo won't restore them**. | [Help][help] |
| 10 or fewer copies: deleting the original isn't documented. An old guide, seen only in a search result, says the others unsync and stay. | Weak; **assumed in §4** |
| Deleting a copy removes only that copy; deleting the lines inside removes them everywhere. | Third-party guides via search; the second follows from "an edit appears everywhere" |
| Nesting: "You can not create a synced block within a synced block" vs. a copy can be pasted inside, then "there is no way to remove it". | [Prototion][proto] vs. [Frank][frank] |
| Template: an original in a template gives each new page **its own unconnected** block. A copy pasted into a template **stays connected** on every new page. | [Frank][frank] |
| A database view can go inside. | [One Substack post][shih], no official statement |
| To-dos and subpages inside: a checklist is a named use, tick behaviour isn't stated. As one shared block, a tick would show everywhere; that's an inference. | [Prototion][proto], [Frank][frank] |

## 2. The model

**Notion's, in one line:** a synced block is one piece of content shown in several places. An edit anywhere is the edit everywhere. The place it was made is the **original**, and that's the only place that differs from the others: it's marked in the list, it offers Unsync all, and deleting it ends the syncing.

This replaces "every place is equal, no original" from the 2026-10-21 doc. That rule was simpler, but it isn't what Brian accepted and it has no Unsync all. Making one follows Notion too: `/` Synced block, the Sync button on selected lines (Jazz's entry for Turn into, not built yet), and the block's copy action. **Two copies on one page are allowed** (the old doc turned the second into plain lines).

## 3. Tasks inside: allowed

**The old "no tasks" reason no longer holds.** It said a task belongs to one day and one place. In his workspace today, one task already has rows on many pages: 10 of the 32 tasks on pages have 2 or more rows, "TRV" has 10 and "买狗窝" has 5 (snapshot rev 765). A tick already reaches all of them. So a to-do in a synced block is an ordinary task row, and `[] ` and `/` Task work inside.

| Case | Rule |
| --- | --- |
| Tick, rename | Same task, as on any row today: shows in every place, the day pages and Tasks. |
| Planning | **Only the page where it's planned has the plan row. Everywhere else the same line is a reference row**, which plans nothing and is never carried. Showing a block on a new day never plans its to-dos. Role is per place, not shared content. |
| Carry and "Planned for" | Planning **never edits a synced block**. Today `planOn` removes a plan row from the day it leaves; inside a block that would delete the line from every place. There it only changes that place's row to a reference, and the line stays. If the target page already shows the row, it becomes the plan row with no duplicate (`planOn` already does this). |
| Deleting one line inside | The line goes from every place (§5, with a notice), and the task then follows today's rule (`settleAfterRowsLeft`). |
| Removing a place | Its rows go. The task stays if another row exists. |
| **Unsync, either kind** | **Differs from Notion on purpose.** Rows stay rows of the **same** task. A separate to-do on each page would add tasks to Tasks that he never wrote. **No sync action changes the number of tasks.** |
| Block on a template | Template saves never create tasks, so a to-do in an original on a template behaves as any template row. A to-do in a *copy* on a template is a reference row on each new day. |

B22 (a pasted task stays the same task) is separate and unaffected: its row said "tasks stay out of synced blocks", and that clause goes.

## 4. Deleting and unsyncing

| He does | That place | Other places | Notice |
| --- | --- | --- | --- |
| Deletes a **copy** | Goes | Unchanged, still synced | "Removed from this page · still on 2 other pages · Undo" |
| **Unsync** on a copy | Stays as ordinary lines | Unchanged, still synced | "Unsynced here · Undo" |
| **Unsync all** on the original | All become ordinary lines, each page keeping them | Same | "Unsynced on 3 pages · Undo" |
| Deletes the **original** | Goes | **Stop syncing and keep their lines**, as ordinary lines | "Removed · the other 2 pages keep their lines, no longer synced · Undo" |
| Original's **page goes to Trash** | Goes with it | **Stay synced with each other and editable.** Trash isn't final, and trashing a page never edits another (A4). The list shows "Original · in Trash". | The Trash notice, as today |
| Restores that page | Back as the original, with the current content | Unchanged | As today |

Those rows apply to day pages too, now that B16 allows deleting them (task #139).

**Why the copies keep their lines:** that's the assumption from §1, and it's the only choice that loses nothing. **We don't copy Notion's over-10 rule** at any count, because removing every copy with no Undo is the opposite of the bar here. If testing shows Notion does something else under 10, tell me: I'd still keep this rule unless Brian wants otherwise.

**Nesting differs from Notion only at the trap.** Sources disagree on whether it's possible, and the one that says yes says it can't be removed. A synced block pasted inside another arrives as plain lines, no notice.

## 5. Undo

The bar: **every action above can be undone by the notice, as one action, on the page he's looking at.** One operation across all pages, one Undo slot (Roadbuster's single-transaction rule, plan §2).

- **Turn into synced:** Undo gives the plain lines back with the **same line ids**, so line links survive.
- **Pasting a copy:** ⌘Z or Undo removes it from this place only.
- **Unsync, Unsync all, delete:** Undo restores the syncing and every place. If a place changed since, it says "Can't undo · edited since", today's rule, and never overwrites.
- **Typing:** ⌘Z undoes on the page he's typing on, and the undo spreads like any edit. If another place has changed the block since, "Can't undo · edited since".
- **Deleting lines inside a block shown elsewhere** is a loss on pages he isn't looking at, and the phone has no ⌘Z, so it gets a notice: "Removed from 3 pages · Undo". Typing gets none. Emptying it keeps one empty line and the block, as Jazz specified.
- **A tick** keeps its own notice and Undo.

## 6. What can go inside

Everything he can put on a page, as in Notion, except another synced block (§4).

- **Page and link cards:** allowed. A page keeps one parent, **the original's page**. A card elsewhere is a link to it, which already exists (a pasted card to a database in R1). Deleting a place's card doesn't trash the page; deleting it from the shared lines follows today's card rule.
- **Headings and template structure:** allowed. Templates are ordinary blocks since B70, so "day's template headings can't sync" no longer has a reason. A draft anchor inside moved or synced lines falls back to the existing moved-anchor rule.
- **Databases (needs R2's linked views, task #263):** a `database` block is allowed. It's the home on the original only and a linked view in every other place, and a view's settings are shared with the block's content. Deleting a copy never trashes a database; deleting the original's block follows R2-3. **Built (B21-11):** deleting the database's line from a copy removes it from the shared lines, so from the original too, and the database stays as a full page on the original's page, with its rows and any views: the notice only ever said a view went. The same when the original block itself is deleted. An Undo of that brings the line back as a view, not as the home again. Deleting the home line on the original still sends it to Trash with its rows, with its usual notice.

Release order is Roadbuster's to propose (databases can come last), but nothing here is dropped.

## 7. Templates

Notion's rule, on his Day template: **made on the template, each new day gets its own unconnected block. A copy pasted into the template stays connected on every new day.** The second is the useful one: one note he edits once, on every day.

**The cost, for Roadbuster to measure.** The 2026-10-21 plan writes the new lines into every page in one transaction. On a template copy that's one more page each day, so after a year one keystroke's save rewrites 365 pages, against a Postgres row per page and "send only what changed". Notion's own limit at 10 copies may come from the same thing. **Size one shared record read on load first, with writing to every page as the fallback (Lead f9ff5fa9).** This is reasoning, not a measurement, so Roadbuster's numbers can overrule it. The cost to weigh is §8's rollback and export: an older build can't draw a shared record, so the sizing states that floor. The **bar**, either way, is that a save from a block on 100 days feels the same as one on 2.

## 8. Elsewhere

- **Day draft:** on a copy of his real workspace and template, draft items land in the same slots, a block with lines counts as filled, and it isn't sent to the model once per place. Its unticked rows on other days don't become "open to-dos planned today" (§3).
- **Tags:** counted once (already decided, 8e998433).
- **Search:** **once**, under the original, with the number of pages. This changes the old doc's "per page", because a template copy would otherwise fill search with one hit per day. Reading a day (review, draft) still sees it on that day.
- **Linked from:** stays per page. A link inside counts once per place.
- **Export:** every place as ordinary lines (unchanged). Export never loses text.
- **Rollback (corrected 2026-11-03, sizing and PR #89):** with one shared record an older build can't draw a block. Below the floor a page holding one shows an error and loses nothing, as Roadbuster ran on SQLite. It no longer becomes ordinary lines. Checklist B21-16.
- **To-dos source (R2):** one row per task, however many places (R2-8).

## 9. What changes in the earlier docs

**`synced-block-states.md`, for Jazz:** §1 gets an original. §2 adds `/` Synced block and allows everything in §6. §3 list marks "Original", and the menu gets Unsync all on the original. §4 allows two copies on one page. §5 removes "task-making is off". §6 is replaced by §4 here. §7 search as above. §9's checks follow. Unchanged: the look, geometry, whole-block copy vs. part copy, conflict handling (both edited: latest in the block, his version below), Sync unavailable.

**`b21-synced-block.md`, for Roadbuster:** the plan predates model v2, Postgres rows and B79, so §1–2 need rechecking, including `sync:<page>:<lineId>` ids. New: role per place, `planOn` and `not-today` leaving synced lines alone (both remove rows today), live update between two copies on one page, and §7's cost. The Backspace edge guards from its experiment still apply.

## 10. Checks when built, and the usage read

Acceptance rows go on the checklist with the first PR. The ones that protect him most:

1. Nothing he wrote leaves any page without a notice on the page he's looking at.
2. The number of tasks is unchanged by Sync, a paste, Unsync, Unsync all or a delete.
3. Carrying or re-planning a to-do in a block never removes its line from another page.
4. Backspace at either edge of a block can't spill its lines or pull a neighbouring line into every page (the 2026-10-21 experiment showed both).
5. Undo restores every place after Unsync all and after deleting the original.

**Usage read, 7 days after release (his workspace only, read-only):** did he make one, and did it reach a second place? Is it edited from a place other than the original? Is one on the Day template? Unsync or delete soon after making it suggests it surprised him. Any lost line is a regression. As always, this sets order and success, never scope (Brian 57deaed7).

[help]: https://www.notion.com/help/synced-blocks
[frank]: https://thomasjfrank.com/notion-synced-blocks-guide/
[proto]: https://blog.prototion.com/synced-blocks-in-notion/
[shih]: https://brendanshih.substack.com/p/how-to-use-notion-synced-blocks
