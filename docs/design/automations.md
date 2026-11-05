# Automations: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **approved to build, in §9's order, after Buttons (Lead 9d5b3c33, 2026-11-05); Roadbuster builds.** Not built.
- Asked by the Lead (3f046122). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [database automations](https://www.notion.com/help/database-automations), which I read but haven't used. **Where I depart from Notion, I say so and why.** His use: no databases at the last read (Nov 2), so the examples are illustrations.
- Shares its steps with `buttons.md` §2.

## 1. The idea

An automation is a rule on a database: **when** something happens to a row, **do** these steps. "When Status is set to Done, set Finished to today." "Every Monday, add a row to Weekly review."

## 2. Where it lives

- **Database `⋯` → Automations**, a list of his rules at both widths, as a popover at 1280 and a sheet at 390. Each line reads: name, a switch for Active, and "Last ran Nov 3, 09:14". `+ New automation`.
- **A rule is on the database,** so every view and linked view shares it, and it's deleted, trashed and restored with the database. Undo works on adding, changing and deleting a rule.
- **Editor:** "When" with triggers, "In", then "Do" with steps. As in Buttons, Done is off until every part is complete.

**Jazz's read (96c42328, from the doc and Buttons' rules, no sketch; approved by the Lead 9d5b3c33):**

- **The list.** Two lines per rule, the name with its switch and a status line below. A tap opens the editor, and Delete lives there. With no rules, "No automations" and `+ New automation`. Rules reorder by ↑↓, as they run in list order (§5, point 6). The status line:

| State | Second line | Switch |
| --- | --- | --- |
| On, has run | Last ran Nov 3, 09:14 | on |
| On, never run | Not run yet | on |
| Off by hand | Off · Last ran Nov 3, 09:14 | off |
| Broken: a target deleted or changed type | Paused · Status was deleted · Edit | off, and a tap opens Edit |
| Stopped by a limit | Paused · Not run · command limit reached | off, and it can be turned on again |

- **Fixing a broken rule** turns it back on when the edit is finished, with a notice and Undo. A rule switched off by hand stays off after an edit. Reasons wrap, with red only on the words of a broken or stopped rule.
- **A pause stays findable.** The menu's own row reads "Automations · 1 paused", and costs nothing when all is well. A failure found on opening shows once then.
- **The failure notice keeps Undo:** "Moved to Done · Log finish paused · Edit · Undo", with a long rule name taking the ellipsis and several rules reading "2 paused". A failed scheduled run has no edit, so it shows Edit alone.
- **The editor** is Buttons' shell: Done in the head, the same leaving rule, one row per step, and Buttons' step pages shared. When, In and Do are three sections on the first page, and "All" or "any" only appears with a second trigger. Choosing "Every…" with an Edit property step marks that step incomplete and says why, rather than dropping it, and likewise for a second trigger added to Every. A blank name falls back to its first step's words, as a placeholder that saves if left alone.

## 3. Triggers

| Trigger | Fires when | Notes |
| --- | --- | --- |
| **Row added** | A row is made in the database, by `+ New`, a Duplicate, a button or a form. | Not an Undo, a restore from Trash, or a CSV import, which would fire hundreds of times (my proposal; Notion's page doesn't say). |
| **Property edited** | Any change, or "is set to", "contains", "is empty" and so on, per type. | Only a value change. Typing in a row's body doesn't count. |
| **Every …** | Daily, weekly, monthly or yearly, at a time, with start and end dates, in his time zone. | Can't combine with other triggers, and can't use Edit property, since no row started it. Both are as Notion. |

- **Several triggers:** any or all, as Notion. Notion's "all" needs edits within about 3 seconds, which is hard to explain. **My proposal:** "all" means every condition is true after this edit, with no time window. He sees the same result for "is set to", and it doesn't depend on timing.
- **In:** the whole database or one view, whose filter limits which rows count. If the row no longer matches when it fires, nothing runs, as Notion.

## 4. Steps

From `buttons.md` §2: **Edit property, Add row to, Edit rows in, Define variables**, then the steps that reach outside, once the Lead has decided each. Insert blocks, Open page and Show confirmation don't apply, since nobody may be there to see them. A step can read the row that fired it.

**No chains, as Notion.** An automation never fires another automation, or itself. A button can fire one. Rows added by a repeating template or by an automation's Add row don't fire any. That's what stops loops, so there's no separate loop check to explain.

## 5. How it runs, where I depart from Notion

Notion runs these some time after the edit. **I'd run row and property triggers on the server, inside the command that made the change.** With one person and a small workspace, this gives:

- **One Undo for both:** "Moved to Done · Undo" undoes the move and what it set off, with no leftovers to chase.
- **Same from anywhere:** old tabs, the phone and other tabs all set it off, because it's on the server.
- **No queue and no new service.** It isn't free of CPU or latency, which §5.3 measures (Ratchet 2dcbd199).
- **What he sees:** the usual notice, plus the rule's name when it did something: "Moved to Done · Log finish · Undo".

**Rules that protect his data:**

1. **His own edit always stands.** If a rule fails, his edit is kept, the rule's steps are dropped whole, and the rule pauses. The notice says "Log finish paused · Status was deleted · Edit", and the rule's line shows the same. Notion pauses too, but doesn't always say. We always do.
2. **Limits:** "Edit rows in" stops at a stated number of rows (for Roadbuster to set from what a Worker request can do), and refuses rather than doing part of it. The refusal pauses the rule as in point 1.
3. **Typing speed:** a property edit isn't slowed noticeably. A database with no rules pays nothing, which is R1-18's bar. Measure with rules on.
4. **A rename of something a rule uses** keeps working, as targets are held by id, and updates its label. **A delete or an incompatible type change** shows the rule as broken at once, not on its next run (corrected, Ratchet 2dcbd199).

**Contracts before building (Ratchet 2dcbd199, a read of the code, nothing built or run):**

5. **Save his edit, stage each rule separately.** Apply his action first, and run each rule on a disposable copy of that state, accepting the copy only if all its steps succeed. His edit, the successful rules and the failed rules' pauses commit in one transaction with one Undo. `execute` mutates its cloned workspace today, so catching an exception without a fresh copy per rule could leave partial steps. **"His edit always stands" covers a rule's failure, not a failed database:** an outage fails the whole commit.
6. **Freeze what fired, then run in order.** Matches come from his action's before and after rows, ahead of any rule's writes, and matched rules run in their saved list order. "All" needs at least one watched property to have changed, with all its conditions true afterwards, so an unrelated edit doesn't repeat a Done rule. A rule can read what an earlier rule wrote, but those writes never add matches.
7. **No chains by provenance.** A rule's own steps are marked as coming from an automation, and Undo, restore, import and repeat-made rows are excluded by name. A button's direct changes can fire rules once, and those rules' changes can't. Bulk edits and property conversions are covered explicitly. A retry of the original operation doesn't evaluate rules again, and keeps its generated ids and date.
8. **Bound the whole command.** Limits count across all rules and steps, rather than each rule getting a fresh allowance, and it's stated what hitting the limit does. **Decided (Lead 9d5b3c33):** the remaining matched rules pause, each showing "Not run · command limit reached", while earlier successful rules stay applied, his edit is kept, and rules that weren't triggered stay active.

## 6. Scheduled rules

**Decided (Lead f5362d4f): A, catch-up on open, for scheduled rules and repeating templates.** **Corrected 2026-11-05 (Ratchet 2dcbd199, Lead 7b6bbb77's question):** since B60 the Worker's cron runs every minute on Workers Paid, so price and "nothing runs without a request" are no longer the reason. **Catch-up stays for the first scheduled release, because of Undo and unattended writes:** repeating rows wait for a visible, idle tab, as `run-repeats` clears Undo, and a cron would run past that protection every minute. The cron also only walks workspaces with a push subscription today, so scheduled rules can't simply join that loop. Cron gets its own decision if a scheduled step ever has to reach outside the app (Lead 9d5b3c33). **Either way:** a rule and period's key, its effects and its progress marker commit together under the workspace lock, and cron and open share them. Time zone and period rules are fixed, and the schedule has a version, changed on an edit or a resume, so a late tick can't run an old schedule. Reaching outside the app needs its own delivery design, as the push lease isn't exactly-once.

Days are made by an open tab at midnight (`ensure-day`), and **"Every Monday" and repeating templates (R4-6) need a way to wake up.**

| | A. Catch up when he opens the app | B. A Worker cron |
| --- | --- | --- |
| On time? | Only if a tab is open at that time; otherwise at his next open | Yes, within the minute |
| Running cost | None | Workers Paid, already ours, with the cron already running (B60): about 0.7 M CPU-ms a month of the 30 M included, by the Lead's arithmetic, before any rule work |
| Mail, webhook or Slack at a set time | Not honest: it would send late | Works |
| New failure mode | None beyond today's | A run with nobody watching, needing its own logging and alert, that can clear the Undo of someone working |

**Why A:** it uses the path Brian's days already use, and it's enough for rows in a person's own databases, since they're only seen when the app is opened. Look at B again when a scheduled step reaches outside the app.

**With A:**

- **Each period runs once,** by a key of rule and period, as days are keyed by date, including two tabs, retries and a rollback.
- **A missed period:** only the latest one runs, because five "Weekly review" rows at once on his return is clutter. **A repeating template (R4-6), Jazz fb7d3274 and Bumblebee:** also only the latest, with a notice once, "Weekly review · 2 earlier weeks skipped", and no Undo needed, as missed day pages aren't backfilled. **Each template also has a "Make every missed one" switch in its first version,** off by default, because a log-style template would otherwise have gaps that Notion, running on its server, wouldn't. The period key already prevents duplicates, so it should be cheap; if it isn't, Roadbuster says so. Each row made this way dates itself to its period through `@today`-style values, with a true Created time, and a stated limit on how many it makes at once.
- **Pausing a repeating template (Jazz 2e2f4ee4, Bumblebee yes):** turning Paused off counts from that moment. Someone back from a holiday doesn't want those rows, so none are made and no "skipped" notice appears, even with Make every missed one on. Notion's guide only describes turning Repeat off, so this one is ours.
- **Weekdays (R4-6):** Weekly can pick its weekdays, as in Notion's "on Tuesday and Thursday every week". A skipped notice counts rows, not weeks, when there's more than one weekday. With Every above 1, weeks are calendar weeks by the Week starts setting, so "every 2 weeks on Tue and Thu" keeps that week's two days together (Roadbuster 3afc01a9).
- **A row made while Brian is working (Roadbuster 3afc01a9):** a run clears Undo, and keeping it would mean changing Undo in both stores. So opening the app runs at once, and after that a run waits for a visible tab with no typing or clicks for 2 minutes. A row can arrive a little after its time, with a true Created time. Two visible windows, or a tab open on another device, can still take the Undo.
- **What he sees:** the rule's line shows "Last ran" with its real time, and a row's Created time is true. No notice unless it failed.

## 7. To-dos as a source

"When a to-do is done, add a row to Log" is an obvious use. A tick on a day page would then run a rule, so it touches his main path. Steps use the same task commands (R2-9), and §11's no-extra-properties rule holds. I'd put it **in the second batch, after rules on ordinary databases have run for a while,** with R2-7's bar on tick speed.

## 8. For Roadbuster to size

- Running steps inside a command, and dropping them whole on failure while keeping his edit. Does the reducer allow a savepoint, or does it need to check first?
- Where the trigger check lives so that a database with no rules pays nothing.
- Old tabs: rules should survive an older tab's save, and an older tab's edit should still fire a rule.
- The stated limit in §5.2.

## 9. Release order, within Automations

1. Row added and Property edited, with Edit property, Add row and Edit rows.
2. Scheduled rules (§6, catch-up on open), together with R4-6.
3. To-dos as a source.
4. Steps that reach outside, per `buttons.md` §7.

## 10. Checks before release

- Undo reverses his edit and the rule's steps together, on real Postgres.
- A broken rule keeps his edit, pauses, and says so; turning it back on after a fix works.
- No chain or loop: a rule that sets the property it watches runs once.
- A rule fires from an older tab's edit and from the phone.
- A period runs once across two tabs and a retry.
- A copy of his real data with rules on: R1-18 and R2-7 hold, and his day pages don't change.
- Rules survive a rollback, and the floor is stated.
