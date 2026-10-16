# 01 · Flows and interaction — v0.3 draft

- Author: Jazz (task #15) · Reviewer: Bumblebee · 2026-10-16
- Status: **draft, not approved.** Brian approved building a first thin slice (#daythread:3cf148c1 msg `78871f09`), not this document. v0.2 (`docs/specs-v0.2/01-flows-and-ux.md`, sha256 `892da1ff…`) is frozen.
- Inputs: `docs/reviews/refs-delta/SUMMARY.md`, `refs-delta/Jazz.md` (incl. Addenda 1–2), the Lead's rulings in #daythread:3cf148c1 (after msg `78871f09`), Brian's daily-note sample (msg `78871f09`).
- Depends on: v0.3 `00` (scope, Bumblebee), `02` (data and state, Wheeljack), `03` (AI contract, Ratchet), `04` (acceptance, Bumblebee). Where this file states a data, context or budget rule, `02`/`03` are authoritative. Any mismatch is a bug in this file.
- Kinds used: **[Goal]** Brian stated it (cite `refs/02-user-quotes.md` or a thread message) · **[Design]** a proposed default · **[Hypothesis]** to be checked in the trial. Nothing here has been built, run on a device, or tested.

## Change log vs. v0.2

| Ref | Change | Source | v0.2 sections |
| --- | --- | --- | --- |
| C1 | Layout A/B closed. The day page is one editable document prefilled with Brian's own sections: Top 3 · Other · Events · Good Stuffs · Notes. Plan rows live in Top 3 / Other. Sections can be renamed, added, removed or written anywhere. Computed facts sit in a strip above the document. | O-U06, D-C, sample `78871f09`, Lead ruling | §3.2, §11.1 |
| C2 | Top 3 is a section, not a star. | sample | §3.2, §7.4 |
| C3 | Deleting a whole plan row applies **Not today** at once, with a notice and Undo; no prompt. Bulk deletion sets nothing aside. "Remove from page only" replaced by **Keep planned**. | O-U07, Lead ruling (Ratchet's conditions) | §2, §3.2 B |
| C4 | Done rows stay on the page, checked. | sample | §2 |
| C5 | Morning **Start the day** card is a main path: last night's Top 3 suggestions, **all** of yesterday's open tasks (Keep / Not today), and **Bring to today** for Good Stuffs / Notes lines Brian picks. Skippable in whole or part; nothing needs clearing. | sample, Bumblebee, Ratchet/Lead boundary | §3.5 |
| C6 | Evening review becomes a guided 4-step flow opened by a repeating iOS reminder link, phone first. `Review saved` and `Tomorrow's draft ready` are separate states. Reflection is never parsed. | O-U03, D-B, Brian OK on iOS reminder | §7, §9 |
| C7 | iPhone / MacBook split and touch rules. | D-B | §1, §2, §5 |
| C8 | Links in the material section (prefilled as Good Stuffs), or captured as material, become saved material. Task-row links stay with the task; Notes links stay text unless saved. **Don't resurface** per item. Replaces R5's "material only via Pages → Paste". | sample, Lead ruling, Bumblebee, Wheeljack | §4.1, §6 |
| C9 | First-slice references are page-level: they open the page. Passages are kept as quotes with a source link. Block references and passage anchors are later features. | O-U11 source correction, Ratchet | §6 |
| C10 | "Related" line (0–2 items/day) is in the first slice, drawn from past Good Stuffs material. | O-U03, SUMMARY §1 | §6.7 |
| C11 | New states: context line, linked context too large (nothing sent), titles-only candidates, daily budget reached/close. | D-C, SUMMARY §3 | §4.3, §8 |
| C12 | Events can have no time. | sample | §3.3 |
| C13 | Prototype questions replaced by trial observations. | D-A | §11 |

Kept from v0.2 unchanged in intent: the action vocabulary, the open pool and its views, capture saved first, the receipt card and mixed-group confirmation (R4), no AI call on page open (R3), the state and copy table's promises.

## 1. Navigation and devices [Design]

| Entry | Contains |
| --- | --- |
| **Today** | The capture bar, the facts strip and the day page for the current date, with ← → date navigation and a **Back to today** chip on other dates. The review opens from the page or its own link. |
| **Pages** | Saved material and longer pages, sorted by recently opened; new page; paste. |
| **Upcoming** | Tabs: **By date** (planned / start / due / event), **No date**, **Not today**. |
| **Search** | One search over pages, material and tasks. ⌘K on MacBook; a search button on iPhone. Not a separate screen. |

There are no badges or counts that ask to be cleared. Crossing midnight doesn't move the page being edited; a quiet banner says "It's a new day · Go to today".

**Devices [Hypothesis, D-B].** Brian uses a MacBook and an iPhone. Working assumption, checked in the first week:

| Device | Main jobs | Designed |
| --- | --- | --- |
| iPhone | Evening review (the reminder lands here), quick capture, the morning card, ticking Done | Phone first. Readable and fully tappable at 390 px width; capture bar at the bottom |
| MacBook | Writing the day's note, material, references, longer planning | Laptop first. Full editor, `[[`, paste |

- Every action has a tap path through a row **⋯** menu. Nothing depends on hover, right-click or keyboard shortcuts.
- **First-slice scope choice:** on iPhone, plain text editing, task rows, Done and the row menu work. Block drag/move, multi-block selection and **Turn into tasks** are laptop-only and hidden on the phone, not shown disabled. This is a scope choice, not a finding: nothing has been tested on a phone. The first build includes a check on a real iPhone, and these limits are lifted if it passes.
- **Saving from other iPhone apps:** iOS web apps can't receive the system share sheet. The path is copy link → paste into capture or into Good Stuffs.

## 2. Vocabulary [Design]

These are the only user-facing names for task actions. Internal state names (`excluded`, `auto_carry_paused`, `planned_on`, `attention_on`) never appear in the UI.

| Action | Where | Effect (rule in 02) | Notice |
| --- | --- | --- | --- |
| **Done** | Checkbox on any task row | Task → done. The row **stays on the page, checked**; every row showing the task updates | "Done · Undo" |
| **Another day ▾** | Plan row, task detail | Menu: Tomorrow · This weekend · Next week · Pick date… · No date. Sets the planned date; deadline unchanged | "Moved to Fri 10/16 · Undo" |
| **Not today** | Plan row on today or a future page; also deleting a whole plan row (below) | Removes the task from that day and stops carry-over. Deadline and start date are kept | "Not today — won't carry over · due Fri still tracked · Undo · Keep planned" (the deadline part only when one exists) |
| **Keep planned** | The Not today notice after a row deletion | Two steps: undo the pause, then remove only this row from the page. The task stays planned for today and shows in the facts strip as "Planned · not in note" with **Put back** | — |
| **Move to Top 3 / Move to Other** | Plan row ⋯, or drag on MacBook | Moves the row between plan sections. Display only; no task state | — |
| **Cancel task** | Row ⋯, task detail | Task → cancelled; restorable | "Cancelled · Undo" |
| **Remove reference** | Reference row | Removes only that row; never changes a task | "Reference removed · Undo" |
| **Bring to today** | Start the day card; any block on a past page (⋯) | Copies the line into the same section on today's page, with a small "from Wed" source link. A task line brings the same Task (a placement), never a copy | "Brought to today · Undo" |
| **Don't resurface** | Material item ⋯, Related line | The item stays saved but is never suggested again | "Won't suggest this again · Undo" |
| **Open** | Any row | Opens task detail or the material page | — |

**Deleting rows** [Design · C3]:

- Deleting a **whole plan row** (Backspace/Delete on the selected row, or the iOS keyboard deleting an empty row) applies **Not today** with the notice above. No prompt (O-U07: "don't make me choose every time").
- Deleting **characters** in a title edits the title. Deleting an **ordinary reference** or a row on a **past** page never changes a task.
- **Bulk deletion** (a selection containing text and plan rows) sets **nothing** aside. The text is removed (02: remove presentation only), the tasks stay planned for today, and the facts strip shows "Planned · not in note (3)" with **Put back** and a per-row **Not today**. One notice: "Text removed · 3 planned items still on today's plan · Undo". The removal, the strip update and the notice commit together; Undo carries a version check (02).

The "Not today" summary and tab are for finding things. They are never a count to clear, and this design doesn't claim to shrink the stored backlog; it removes repeated suggestions and the "choose where it goes" step.

**Date labels** show plain phrases and only the fields that are set: "Do Wed" · "Start Wed · Due Fri" · "Due Fri 17:00" · "Unscheduled". Overdue items read "Was due Mon". Upcoming shows one row per task per date, tagged `do` / `start` / `due`. When a task has both a start date and a deadline, **Due** comes first once the deadline is within 2 days.

## 3. Day page

### 3.1 Opening a date (F01) [Design · R3]

1. Get the workspace's local date. Open the single Daily Page for that date, or create it from the template (§3.2).
2. Render immediately from saved data: the facts strip, the Start the day card (§3.5) if it applies, and the page. **No model call happens on open.**
3. An empty page is not a trigger. Clearing the page never regenerates anything.

First run, with no data: the capture bar is focused and shows 2–3 example phrases ("Fri: submit materials, start Wed") that disappear after the first capture. The first run also asks for the review time (§7.0). No projects or categories.

### 3.2 Page template [Design · C1, C2]

```text
┌ Capture bar ──────────────────────────── (bottom on iPhone) ┐
│ Today · Fri Oct 16                              ← → Today   │
├ Facts strip (computed, not page text) ──────────────────────┤
│ Start the day · 3 suggested · 5 open from Thu · 2 lines  ▸  │  §3.5
│ Continue?  □ Fix export bug           [Today] [Not today]   │  ≤3, older days
│ Still open · 6 · oldest 9 days ▸   Not today · 2 ▸          │
│ Due soon   Submit materials  Due Fri                        │  only unplaced
│ Planned · not in note (1) · Put back                        │  after bulk delete
│ Related    Article title — reason · Open · Not useful       │  0–2, §6.6
│ 1 capture waiting · Review                                  │  §4.3
├ Page (one editable document) ───────────────────────────────┤
│ ## Top 3                                                    │
│ ▌□ Rewind - APPX PR - Provider        Due Fri               │  plan rows
│ ## Other                                                    │
│ ▌□ Tax return                         Unscheduled           │
│ ## Events                                                   │
│ ▌ Lunch with Kevin                                          │  untimed OK
│ ## Good Stuffs                                              │  material section
│ - https://… Article title                                    │
│ ## Notes                                                    │
│ free writing, quotes, [[references]]                        │
└ Review ─────────────────────────────────────────────────────┘
```

- **The template mirrors Brian's note** [Goal: sample]. Sections are ordinary headings. Brian can rename, reorder, add or delete any of them and write anywhere, including prose between plan rows. Nothing locks where text goes.
- **Plan rows** are visibly distinct from ordinary references: a left rail plus the date tag, against a plain inline chip for a reference. Only plan rows carry the day's placement. A plan row typed or moved under any heading is still a plan row; the sections only order things.
- **What prefills on creation:** tasks placed on that date (in Top 3 if they were picked as Top 3, otherwise Other), events on that date (in Events), and empty Good Stuffs and Notes headings. If Brian deleted a section on earlier days, the template still offers it; the template itself is editable in settings later, not in the first slice.
- **Facts that arrive after the page was created** (a new task placed for today, a new event) appear as one strip line "2 new for today · Add". **Add** inserts them in the matching section. Nothing is inserted into the page by itself.
- **Top 3** is a section: plan rows move in and out (§2). There is no limit enforced; "3" is the heading's name.
- **The material section** is the section prefilled as Good Stuffs. Its role belongs to the section, not the heading text, so renaming it keeps the behaviour (§6.1). If Brian deletes it, a hint explains once that links will then be saved only through capture or **Save**.

### 3.3 Facts on a date [Design · R1, C12]

Facts are computed from data (02). Events on that date, tasks planned for it, tasks whose start date has arrived, and tasks due or overdue.

- A plan row carries its own `Due` / `Start` tag. "Due soon" shows only facts that aren't on the page as plan rows, so deduplication never hides a deadline.
- After **Not today**, a task with a deadline stays in "Due soon" as "Not today · due Fri".
- Events show a time only when one exists; capture never asks for one.
- Wording depends on the real local date. On tomorrow's page: "Due that day", never "Overdue".

### 3.4 Open pool views [Design · R2]

The open pool is every task that is `open`, not paused, and has no future planned date, including never-dated tasks. The rule lives in 02. This file defines only its views.

1. **Continue?** shows up to 3 suggestions from pool tasks that were scheduled at least once, **excluding tasks from yesterday's page** (the Start the day card covers those) and tasks already placed today. It appears once the Start the day card is done or set aside. Rotation follows 02 (on only when the same 3 have shown for more than 3 days in a row; least recently shown first; never changes within a day). Row actions: **Today**, **Not today**, and **Another day ▾** in ⋯. A suggestion changes nothing until Brian acts.
2. **Still open · N · oldest X days** is collapsed by default and expands to the full pool, never-dated tasks labelled "Unscheduled". Each row offers **Today**, **Another day ▾**, **Not today**. Shown every day, even when N = 0 ("Nothing else open").
3. **Upcoming → No date** shows the same pool as a list.

**Not today · N** (paused tasks; "M reached start date") is separate. It isn't counted in N and never produces suggestions. Expanding gives **Bring back** (unpause) and **Another day ▾**. It is for finding, not clearing.

### 3.5 Start the day (morning hand-off) [Design · C5]

The card shows on today's page each morning when it has anything to offer. It replaces copying lines from yesterday's note by hand, which is Brian's current routine (sample `78871f09`) and the recall cost in O-U03.

```text
Start the day · Fri Oct 16
  Suggested last night (Top 3)   □ Rewind APPX PR  □ Tax return  □ Call Kathy's school
                                 [Add to Top 3]
  Still open from Thu (5)        Keep · Not today    (each row)      [Keep all]
  From Thu's page                Good Stuffs: 2 · Notes: 1           Bring to today (each)
                                                    [Done] [Later]
```

- **Suggested last night** appears only when last night's review saved tomorrow's draft (§7). **Add to Top 3** places the checked ones on today in Top 3. Unchecked suggestions change nothing. They are suggestions until Brian acts (R3).
- **Still open from <previous page>** lists **all** tasks from the most recent previous day page that are still in the open pool (not done, not paused, not already placed today). No cap. **Keep** places the task on today (Other); **Not today** pauses it. **Keep all** keeps everything listed.
- **From <previous page>** lists that page's Good Stuffs and Notes lines. These are lines for Brian to pick, not unfinished items: they carry no checkbox and nothing counts them as open. **Bring to today** copies a line exactly once (§2); afterwards it shows "Brought" and isn't offered again. Nothing is brought by default.
- **Skipping is normal** [Ratchet/Lead boundary]. Brian can act on some rows, none, or all. **Done** closes the card; **Later** collapses it to the strip line "Start the day ▸" for the rest of the day. Untouched tasks keep their state and stay in the pool's "Still open" line. Nothing asks to be cleared, and no reminder repeats.
- **The hand-off counts as done** for the trial when Brian taps **Done** (04 logs it separately from the review).
- **No suggestions from last night** (review skipped, partial, or the draft failed): the first line reads "No suggestions from last night · **Draft my day**". The button is the only way a draft is generated in the morning; it uses the same context and budget rules as the review (§4.4).
- If several days were skipped, the card covers only the most recent previous page; older open tasks stay in "Still open". No back-filling.
- **Last night's review not finished:** an extra line "Thu's review wasn't finished · Finish (1 min)" opens review step 1 for Thursday.

## 4. Capture (F02)

### 4.1 Entry points [Design · R5 revised by C8]

| Entry point | Meaning | Creates or changes tasks? | Creates material? |
| --- | --- | --- | --- |
| **Capture bar** (Today, plus a global shortcut) | "I'm speaking" | Yes. New items apply immediately; changes to existing items are confirmed | Only when the capture is just a link, or says to save it ("save this: <link>"). A link inside a task sentence becomes that task's source. The model never decides on its own that a link is material (03) |
| **Pasting or typing a link in the material section** (Good Stuffs) | "Something to keep" | No | **Yes**, automatically (§6.1) |
| **Pages → New / Paste** | Longer material | No, unless Brian selects text and runs **Turn into tasks** (MacBook), which opens the multi-line preview | Yes |
| **Typing in other sections** | Writing | No. `/task` or `[]` creates a task row directly; a faint `↵ Make task?` appears on a line with a date phrase. Neither calls the AI. A link inside a task row stays attached to that task; a link in Notes stays text with a quiet **Save** | Only via **Save** |

A long pasted body inside a capture stays source content. Only Brian's own sentence around it is treated as instruction.

### 4.2 Flow

1. **Submit.** The capture is saved first, with text, time, time zone and page. Inline: `Saved · organizing…`. If saving fails: `Not saved — retry`, the text stays in the bar, and no model call happens.
2. **Multi-line or list input** shows a preview first: "8 items → 8 tasks", each line with a checkbox and type chip, plus **Save all** / **Save selected** / **Keep as note**.
3. **Result → receipt card** (§4.3), anchored under the capture.
4. The original text is not repeated in the page; it's available through **Show original**.

"Maybe learn to paint someday" stays a note. "Email Alex, time not set" becomes an unscheduled task. A link alone, or "save this: <link>", becomes a material item marked "no body provided". "Review the PR https://…" becomes a task with that link as its source, not material. It's not a reading task, and the receipt never claims the link was read.

### 4.3 Receipt card [Design · R4, R6, R7]

```text
Saved from "Fri: submit materials, start Wed, save https://…"
Pure-new capture (saved immediately):
  ✓ Task       Submit materials   [Start Wed 10/14] [Due Fri 10/16]
  ✓ Material   example.com        no body provided
  Undo all · Show original · Used: today's page + 4 linked items

Mixed capture (nothing saved yet except the capture text):
  Waiting for you · 3 items · includes new items, saved together   [Apply all] [Discard all]
  + Task       Submit materials   [Start Wed 10/14] [Due Fri 10/16]   [×]
  + Material   example.com        no body provided                     [×]
  ~ Change     Design sync  Wed → Thu                                   [×]
  Show original · Used: …
```

Rules are unchanged from v0.2:

- **Pure-new capture:** items (✓) are already saved. Every chip is editable in place as a normal versioned change.
- **Any capture that changes an existing item** (complete, cancel, reschedule, clear deadline) is held **as one group**, new items included. Nothing is reported as saved except the capture text. One apply key and one transaction (02/03).
  - **Apply all** re-checks versions. On conflict nothing applies: "Changed since — review again".
  - **Discard all** applies nothing; the text stays with "Discarded · Organize again".
  - Editing a chip or removing a row (×) revises the proposal, still one group. **Nothing is saved automatically**, even if only new items remain.
  - The card is never a modal. While unhandled, the capture stays `needs_confirmation`; the card survives reloads and days and never collapses.
  - The facts strip shows **"N captures waiting · Review"** every day until each group is applied or discarded.
- **Clarification:** one question in the card, one-tap answers when the options can be listed. Answering continues the same capture.
- **Undo all** reverts all or nothing, naming any blocked items.
- **Relative dates on another day's page:** "Tomorrow = Fri Oct 16 (from today, not from Oct 9)".
- Only a handled card collapses into the capture history once Brian moves on.

### 4.4 What the model is given — user-facing [Design · C11; rules in 03]

The day's page is the root of the model's context: the page plus the **full content** of everything it explicitly links to (03 E1). Separately, at review and Draft my day, the resurfacing candidates (03 E2). Every AI call shows a small context line before or with its result:

- "Used: today's page + 6 linked items"
- With candidates: "Used: today's page + 6 linked items (full text) + 18 saved items (titles only)" when the candidates had to fall back to titles. Only candidates can fall back; linked items are never cut.

If the linked content alone is too large, **nothing is sent** and the input is kept (§8). There is no silent truncation or summary.

## 5. Editing (F03) [Design]

- **Supported:** paragraph, heading, single-level list, quote, task row, event row, link line and reference. Blocks can be added, edited, deleted and moved (drag or move up/down on MacBook; see §1 for the phone).
- **Save indicator per page**, persistent and not a toast (§8).
- Editing a task row's title or checkbox updates the same Task. A date-like phrase typed into a title does **not** change dates; dates change through chips or **Another day**.
- Editing the text of a capture that is still organizing makes the old result stale: "Edited — organize again?".
- Removed since v0.2: the AI "tidy this paragraph" action (R10).

## 6. Material and references (F04) [Design · C8, C9, C10]

1. **Saving material.** A link pasted or typed in the material section becomes a saved material item, shown as that line with the page title once known and **Open**. Capture can also save material. Pages → New / Paste is for longer material and notes. Every item has **Don't resurface**. Shopping or other "not again" links are marked by Brian, not guessed from the URL.
2. **Referencing.** In any page, type `[[` (or the toolbar button on iPhone). Search covers page titles and text; the result inserts a **page reference**: title, short preview, **Open**. Opening goes to the top of the page. There is no promise to land on a passage.
3. **Keeping a passage.** Copy it as a quote with a source link. The quote is independent text and keeps its wording.
4. References show current content. A removed target shows "Original removed · Restore", position kept.
5. **Deferred:** block references, stable passage anchors and backlink UI. The data keeps stable IDs so they can return without migration.
6. **Related line** [C10; rules in 03/04]. One dismissible strip line with 0–2 items and a one-line reason each, drawn from past Good Stuffs material (and any seed items Brian adds), never from items marked **Don't resurface**. Actions: **Open** · **Not useful**. Never inserted into the page. When the candidate came from titles only, the reason reads "Might be useful · Open" and never implies the model read it. Opens and dismissals are logged for the kill rule in 04.
7. **Non-AI fallback in the review:** "Not opened in 14+ days: <item> · Open · Dismiss", one item at most.

## 7. Review (F08) [Design · C6]

A short guided flow, opened from a reminder, designed for the iPhone first. Target length about 3 minutes [Hypothesis; not shown in the UI].

**7.0 Reminder.** A repeating iOS reminder that Brian sets up, linking to the review page [Brian OK, msg `78871f09`]. The first run asks for the evening time and shows the link to add to Reminders. The link opens **step 1 of today's review directly** and marks that it came from the reminder (04 counts "review opened from the reminder"). Snoozing is done by iOS Reminders itself. Step 1 has **Skip tonight**, which records a deliberate skip. If the link is opened after midnight and yesterday's review isn't saved, step 1 asks "Review Thu?" with Thursday as the default (date boundary rules in 02).

**Steps.** Each step fits one phone screen. Each can be skipped, and progress is saved per step, so an interruption resumes at the same step.

1. **Today's plan.** One card per open task placed today, with one-tap **Done · Tomorrow · Another day ▾ · Not today**. These are direct UI actions (no confirmation) and apply as tapped. Untouched cards keep their state. Header: "Thu · 4 open of 7" · **Skip tonight**.
2. **Anything new?** The normal capture bar with its receipt (§4); dictation is the expected input on the phone. Any task change written in words goes here and uses the confirm card.
3. **One line about today** (optional): "What changed today?". Saved as text and **never parsed** into task changes. "Too tired, don't want to do anything" stays a feeling.
4. **Tomorrow.** Brian taps **Prepare tomorrow**. This is where the daily-draft model call happens (R3). It shows up to 3 Top 3 suggestions, plus 0–2 Related items for tomorrow, with the context line (§4.4). Brian can remove any, then **Save for tomorrow**. Copy: "Tomorrow: 3 suggestions saved". Suggestions are not placements; "N planned" appears only for tasks Brian placed on tomorrow in step 1, and only after the save succeeds.

**States** (02/04 log them separately):

- **Review saved** is set when Brian's own input is saved: reaching the end of step 3, or tapping **Finish** on any step. This is what the trial's completion rate counts. Stopping before that is **partial**, and the next morning offers "Finish (1 min)" (§3.5).
- **Tomorrow's draft ready** is set only when step 4 saves.
- A failed draft (budget, context too large, model error) shows "Review saved · Tomorrow's suggestions couldn't be prepared — **Retry**". It never counts as a skipped review. Steps 1–3 never need the model.
- Retrying step 4 never re-applies step 1 or step 2 changes.

Optional review lines, no badges: "Not today · 4 this week · Look" and the material line from §6.7.

## 8. State and copy table [Design · R6, C11]

The wording is a proposal for review. What each state promises the user is binding (X01, X13).

| Situation | Indicator / copy | Actions |
| --- | --- | --- |
| Page saving | `Saving…` (page header, quiet) | — |
| Page saved | `Saved` (fades after 2 s) | — |
| Page save failed | `Not saved — your changes are still here` (persistent, red) | **Retry** |
| Capture saved, organizing | `Saved · organizing…` | **Cancel** |
| Capture save failed | `Not saved` in the bar, text kept | **Retry** |
| Model failed / timed out | `Couldn't organize — your text is safe` | **Retry** · **Add manually** |
| Invalid model result | `Couldn't organize this one — your text is safe` (no partial objects) | **Retry** · **Add manually** |
| Needs clarification | One question in the receipt card | One-tap options · free reply |
| Stale result (text edited) | `Edited — organize again?` | **Organize** · **Keep as note** |
| Context line (every AI call) | `Used: today's page + 6 linked items` | **See list** |
| Linked context too large | `Too much linked material to send in one go (14 items). Nothing was sent.` Input kept | **Choose items** (leave some out for this run only) · **Try without links** |
| Candidates as titles only | Context line adds `+ 18 saved items (titles only)`; Related reasons read `Might be useful` | — |
| Daily budget close (≥ 80 %) | Once per day, in the receipt: `Most of today's AI budget is used.` | — |
| Daily budget reached | `Today's AI budget is used up ($10). Your text is saved. You can retry once the budget resets.` Writing, task actions and review steps 1–3 keep working | **Retry** (enabled after the reset; nothing retries in the background) |
| AI group waiting | Card: `Waiting for you · N items · includes new items, saved together`. Strip: `N captures waiting · Review`, persists across days | **Apply all** · **Discard all** · per-row edit / × |
| Group discarded | `Discarded · your text is kept` | **Organize again** |
| Retry after a lost response | Shows the stored outcome; never applies twice | — |
| Apply conflict | `Changed since — review again` | **Review** |
| Plan row deleted | `Not today — won't carry over · due Fri still tracked` | **Undo** · **Keep planned** |
| Bulk delete with plan rows | `Text removed · 3 planned items still on today's plan`; strip `Planned · not in note (3)` | **Undo** · **Put back** · per-row **Not today** |
| Start the day card | `Start the day · 3 suggested · 5 open from Thu · 2 lines` | **Done** · **Later** · per-row actions |
| No suggestions from last night | `No suggestions from last night` | **Draft my day** |
| Review saved | `Review saved` | — |
| Review saved, draft failed | `Review saved · Tomorrow's suggestions couldn't be prepared` | **Retry** |
| Review partial (next morning) | `Thu's review wasn't finished` | **Finish (1 min)** |
| Review skipped deliberately | `Skipped tonight` (step 1, small) | **Review anyway** |
| Edit conflict (another tab or device) | `This paragraph changed elsewhere` | **Keep mine** · **Use other** · **Keep both** (a choice of version, not a merge screen) |
| Task changed on another device while a page is open | The row updates in place; no conflict, since task state isn't page text | — |
| Undo blocked | `Can't undo — changed since. Previous value: Wed 10/14` | **Copy previous** |
| Reference target removed | `Original removed` | **Restore** |
| Daily page removed, date reopened | `This day's page was removed` | **Restore** (never a second page) |
| Session expired | `Signed out — unsaved text is kept here` | **Sign in** |
| Midnight while editing | `It's a new day` | **Go to today** |
| Material section deleted | One-time hint: `Links will now be saved only through capture or Save` | **OK** |
| No suggestions / empty pool | Continue? hidden · `Nothing else open` | — |
| First run | Capture bar focused, 2–3 example phrases; review time prompt | **Set time** · **Later** |

## 8a. Flows carried over from v0.2 with small changes

**Sign-in (F00).** An existing session opens Today. Without one, Brian signs in first. No registration funnel or invitations. When a session expires, unsaved text is kept and a false "Saved" is never shown.

**Future items returning (F05).** Example: "submit on the 20th, start on the 17th".

- From the 17th the task shows in "Due soon" as "Start today · Due Tue 20".
- If Brian places it on the 18th, it's a plan row on that day.
- On the 20th it reads "Due today"; after that, "Was due Tue" until handled.

A future page that already exists shows new facts through the strip line "N new · Add".

**Setting aside, removing and cancelling (F06).** §2 is the whole contract. Additional cases:

- On a **past** page, task rows are read-only for placement and labelled "Shown at current status". Only **Done** / reopen and **Bring to today** are offered.
- Removing a task from a **future** page uses **Not today**, worded "Not on Fri 10/16".
- **Cancel task** stops future prompts. The task stays findable in search and can be restored.
- "Do it Friday" in a capture is a change to an existing item. It waits in the confirm card as "Do Thu → Fri"; applying it clears the pause.

**History and Upcoming (F09).** Past pages show text as saved; task rows and references show current state, and the page says so. Task detail shows only "Created from capture on …" and the current dates. Upcoming shows past events as history, never as overdue tasks.

## 9. First thin slice — flows required (R11, C6)

1. Capture a new task with dates → editable receipt; capture a link as material.
2. Today page from the template → plan rows with **Done** / **Not today** / **Another day**, delete mapping (§2), Top 3 / Other.
3. iOS reminder link → guided review steps 1–4 on iPhone → review saved; tomorrow's suggestions saved.
4. Next morning → Start the day card (suggestions, all of yesterday's open tasks, Bring to today) → Continue? and the pool line.
5. Link in Good Stuffs → saved material → `[[` page reference from Notes → **Open**; Related line with **Open** / **Not useful** / **Don't resurface**.
6. Context line, linked context too large, and daily budget reached, each reachable in the first slice.

## 10. Date edge cases shown to the user [Design]

- "Tomorrow" typed on a past page resolves against the capture time, and the receipt names the date.
- Reviewing a past day: "Suggestions for Fri Oct 16".
- After midnight, the review link offers the previous day's review if it isn't saved (§7.0).
- A deadline with a time shows the time ("Due Fri 17:00"). If a DST change makes a time ambiguous or non-existent, the receipt asks and doesn't guess.
- Changing the workspace time zone doesn't move existing day pages; a one-time notice explains this.

## 11. What to watch in the first week of the trial [Hypothesis]

Not questions for Brian up front; 04 owns the measures and success rules.

1. Does Brian finish the review from the reminder, and how long does it take (§7)?
2. Does he use Start the day, Keep everything, or skip it (§3.5)? Which signals reveal the morning-first switch?
3. Is the "Still open" line read as help or as backlog pressure (§3.4)?
4. Does he correct receipts by chips, or retype (§4.3)?
5. Does he reach for passages that a page reference can't open (§6.2–6.3)?
6. Does editing on the iPhone hold up well enough to lift the laptop-only limits (§1)?
7. Are Related items opened, or dismissed (§6.6)?
