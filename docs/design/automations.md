# Automations: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **design for Lead and Jazz to review**. Not approved and not built.
- Asked by the Lead (3f046122). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [database automations](https://www.notion.com/help/database-automations), which I read but haven't used. **Where I depart from Notion, I say so and why.** His use: no databases at the last read (Nov 2), so the examples are illustrations.
- Shares its steps with `buttons.md` §2.

## 1. The idea

An automation is a rule on a database: **when** something happens to a row, **do** these steps. "When Status is set to Done, set Finished to today." "Every Monday, add a row to Weekly review."

## 2. Where it lives

- **Database `⋯` → Automations**, a list of his rules at both widths, as a popover at 1280 and a sheet at 390. Each line reads: name, a switch for Active, and "Last ran Nov 3, 09:14". `+ New automation`.
- **A rule is on the database,** so every view and linked view shares it, and it's deleted, trashed and restored with the database. Undo works on adding, changing and deleting a rule.
- **Editor:** "When" with triggers, "In", then "Do" with steps. As in Buttons, Done is off until every part is complete.

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
- **No queue and no running cost.**
- **What he sees:** the usual notice, plus the rule's name when it did something: "Moved to Done · Log finish · Undo".

**Rules that protect his data:**

1. **His own edit always stands.** If a rule fails, his edit is kept, the rule's steps are dropped whole, and the rule pauses. The notice says "Log finish paused · Status was deleted · Edit", and the rule's line shows the same. Notion pauses too, but doesn't always say. We always do.
2. **Limits:** "Edit rows in" stops at a stated number of rows (for Roadbuster to set from what a Worker request can do), and refuses rather than doing part of it. The refusal pauses the rule as in point 1.
3. **Typing speed:** a property edit isn't slowed noticeably. A database with no rules pays nothing, which is R1-18's bar. Measure with rules on.
4. **A rename or delete of something a rule uses** shows the rule as broken at once, not on its next run.

## 6. Scheduled rules

**Decided (Lead f5362d4f): A, catch-up on open, for scheduled rules and repeating templates.** A paid cron is looked at only if being on time matters in use, and then the Lead checks our plan and tells Brian. The comparison stays below as the reason.

Today nothing runs on the server unless a request comes in: days are made by his open tab at midnight (`ensure-day`). So **"Every Monday" and repeating templates (R4-6) need a way to wake up.**

| | A. Catch up when he opens the app | B. A Worker cron |
| --- | --- | --- |
| On time? | Only if a tab is open at that time; otherwise at his next open | Yes, within the minute |
| Running cost | None | Cloudflare's limits page gives 5 crons on the free plan at 10 ms of CPU, which is unlikely to be enough for this, so I'd expect the paid plan. I haven't checked our plan or current price. |
| Mail, webhook or Slack at a set time | Not honest: it would send late | Works |
| New failure mode | None beyond today's | A run with nobody watching, needing its own logging and alert |

**Why A:** it uses the path his days already use, and it's enough for rows in his own databases, since he only sees them when he opens the app anyway. Move to B when a scheduled step reaches outside the app.

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
