# 01 · Flows and interaction — v0.2 draft

- Author: Jazz (task #6) · Reviewer: Bumblebee · 2026-10-15
- Status: **draft, not approved.** It revises `docs/specs/01-flows-and-ux.md` (v0.1, hash in `docs/reviews/round-1/BASELINE.sha256`) according to `docs/reviews/round-1/synthesis.md` R1–R11. v0.1 is unchanged.
- Depends on: v0.2 `00` (scope, Bumblebee), `02`/`03` (data and AI, Wheeljack). Where this file states a data rule, `02` is authoritative. Any mismatch is a bug in this file.
- Kinds used: **[Goal]** Brian's stated need · **[Design]** a proposed default · **[Hypothesis]** to be checked in the prototype session or trial. Nothing here has been prototyped or tested.
- Layout-dependent sections are written twice, **A** (structured Today zone + free Notes) and **B** (plan rows inside the free body). Both are marked *decided in the prototype session* (synthesis §5). All other rules hold for both.

## Change log vs. v0.1

| Ref | Change | v0.1 sections |
| --- | --- | --- |
| R1 | The Task is the fact, the placement is the day's selection, and a block is only presentation. Placement rows are distinct from ordinary references. **Not today** is an explicit action, and Backspace never pauses or cancels. The attention area never repeats placed items, and placed rows carry their deadline and attention tags. Layout A and B variants added. | F01, F03, F05, F06 |
| R2 | One open pool with three views: up to 3 suggestions, a "Still open" line and an Upcoming tab. Paused tasks get a separate "Not today" summary. | F07, F09 |
| R3 | No AI call when a day page opens. Suggestions are made at review time; mornings after a skipped review get a hand-off and an optional **Draft my day** button. | F01, F07, F08 |
| R4 | AI changes to existing items wait in an inline confirm card. A capture with only new items applies immediately with an editable receipt. A mixed capture (new items plus changes) waits as one group for a single confirmation (aligned with 02/03). Direct UI actions never ask. Multi-line capture shows a preview first. | F02, F08 |
| R5 | The capture bar means "my words"; Pages paste means "material". **Turn into tasks** is explicit. | F02, F04 |
| R6 | Visible stages for capture and review (saved → committed → draft). Retry never re-applies. | F02, F08, 通用状态 |
| R7 | The receipt and the draft state what the model actually saw. Overflow is explicit. | F02, F04, F08 |
| R8 | A "Related" line on Today is reserved for if resurfacing passes the test. A non-AI fallback goes in the review. | F04, F08 |
| R10 | Removed: the `selected_text` "整理这段" (tidy this paragraph) action, the backlink UI, the per-task history timeline UI and the conflict-merge UI. Added: a state and copy table, the interaction defaults (row actions, date labels, navigation), Top 3 markup and date edge cases. | F03, F04, F09, 通用状态 |
| R11 | Flows are grouped around the first thin slice (§9). | — |

## 1. Navigation [Design]

| Entry | Contains |
| --- | --- |
| **Today** | The capture bar, the day page for the current date with ← → date navigation, a **Back to today** chip when viewing another date, and the review. |
| **Pages** | The material list, sorted by recently opened; new page; paste. |
| **Upcoming** | Tabs: **By date** (planned / start / due / event), **No date**, **Not today**. |
| **⌘K** (global) | One search over pages, blocks and tasks. It is not a separate screen. |

There are no badges or counts that ask to be cleared. Crossing midnight doesn't move the page being edited. A quiet banner says "It's a new day · Go to today".

## 2. Vocabulary [Design]

These are the only user-facing names for task actions. Internal state names (`excluded`, `auto_carry_paused`, `planned_on`, `attention_on`) never appear in the UI.

| Action | Where | Effect (rule in 02) | Toast |
| --- | --- | --- | --- |
| **Done** | Checkbox on any task row | Task → done; every row showing it updates | "Done · Undo" |
| **Another day ▾** | Placement row, task detail | Menu: Tomorrow · This weekend · Next week · Pick date… · No date. Sets the planned date; the deadline is unchanged | "Moved to Fri 10/16 · Undo" |
| **Not today** | Placement row on today or a future page | Removes the task from that day and pauses carry-over. Deadline and start date are kept | "Not today — due Fri still tracked · Undo" (the deadline part only when one exists) |
| **Cancel task** | Row overflow, task detail | Task → cancelled; restorable | "Cancelled · Undo" |
| **Remove reference** | Reference row in Notes | Removes only that row; never changes a task | "Reference removed · Undo" |
| **Open** | Any row | Opens task detail (title, dates, source capture) | — |

Date labels show plain phrases and only the fields that are set:

- "Do Wed"
- "Start Wed · Due Fri"
- "Due Fri 17:00"
- "Unscheduled"

Overdue items read "Was due Mon". Upcoming shows one row per task per date, tagged `do` / `start` / `due`, so the same task appearing twice is visibly the same task.

## 3. Day page

### 3.1 Opening a date (F01 revised) [Design · R3]

1. Get the workspace's local date. Open the single Daily Page for that date, or create it.
2. Render immediately from saved data: facts for the date, the open-pool views (§3.4), any saved suggestions from last night's review, and the user's notes. **No model call happens on open.**
3. If no review ran last night, show the morning hand-off (§3.5) and an optional **Draft my day** button. The button is the only way a draft is generated on this page.
4. An empty page is not a trigger. The "already generated" state comes from Generation status (02), so clearing the notes never regenerates anything.

First run, with no data: the capture bar is focused and shows 2–3 example phrases ("Fri: submit materials, start Wed") that disappear after the first capture. No setup, projects or categories.

### 3.2 Layout — *decided in the prototype session*

**Variant A — Today zone + Notes**

```text
┌ Capture bar ─────────────────────────────────────────┐
│ Today · Thu Oct 15                         ← → Today │
│ ─ Events        14:00 Design sync                    │
│ ─ Plan          □ Draft outline        Due Fri       │
│                 □ Email Alex           Unscheduled   │
│ ─ Continue?     □ Fix export bug  [Today] [Not today]│  ≤3 suggestions
│   Still open · 6 · oldest 9 days ▸                   │
│   Not today · 2 (1 reached start date) ▸             │
│   Due soon      Submit materials  Due Fri  ▸         │  only items not placed above
│ ─ Related       (reserved; only if R8 passes)        │
├ Notes ───────────────────────────────────────────────┤
│ free document: headings, paragraphs, quotes,         │
│ [[references]], inline task mentions                 │
├ Review ──────────────────────────────────────────────┤
```

- The Today zone is always computed from current data, so nothing in it needs merging. Within Plan, the user can reorder rows (the order is saved per day) and use every action in §2.
- Notes is fully free. A task mentioned in Notes is an **ordinary reference**: it shows a live checkbox and status, but deleting it never changes the plan.
- Top 3: the user, or a review suggestion, can star up to 3 Plan rows; starred rows sort first. This is display only and adds no task state.

**Variant B — plan rows inside the free body**

- The prefilled body contains headed sections (Plan, Notes, Review) that the user can rename, move or delete.
- **Placement rows** look visibly different from ordinary references: a left rail and a date tag, against a plain inline chip. Hovering a placement row shows "Planned for today".
- Backspace or Delete on a placement row doesn't remove it. The row is selected and an inline prompt appears: "Not today? · Remove from page only". **Not today** is the default, triggered by Enter. *Remove from page only* keeps the placement and moves the row to the attention area, so the plan never disagrees with the page silently.
- New facts that arrive after the page was opened appear as one collapsed line ("2 new for today · Add"), never as inline cards.
- The attention area outside the body shows only items **not** already present as placement rows.

**What the session decides:** Does Brian interleave plan lines with prose in his real notes, which favours B? Does he lose track of what's planned, which favours A? Count the "where did it go?" moments in each variant (synthesis §5).

### 3.3 Facts on a date [Design · R1]

Facts are computed from data (02 §每日构建). Events on that date, tasks planned for it, tasks whose start date has arrived, and tasks due or overdue.

- A placed row carries its own `Due` / `Start` tag. The attention ("Due soon") list shows only facts that aren't placed, so deduplication never hides a deadline.
- After **Not today**, a task with a deadline stays visible in "Due soon" with the label "Not today · due Fri".
- Wording depends on the real local date. Viewing tomorrow's page says "Due that day", never "Overdue".

### 3.4 Open pool views [Design · R2]

The open pool is every task that is `open`, not paused, and has no future planned date, including tasks that were never dated. The rule lives in 02. This file defines only its views.

1. **Continue?** shows up to 3 suggestions, taken only from pool tasks that were scheduled at least once. Tasks already placed on today are never suggested. Rotation is off by default. It turns on when the same 3 have been suggested for more than 3 days in a row; the rule lives in 02 (least recently shown first, never changing within a day). The user sees only that the set changes; there's no rotation control. Row actions are **Today** (places it) and **Not today**; the suggestion's ⋯ menu also offers **Another day ▾**. A suggestion doesn't change the task until the user acts.
2. **Still open · N · oldest X days** is collapsed by default. It expands to the full pool, with never-dated tasks labelled "Unscheduled". Each row offers **Today**, **Another day ▾** and **Not today**.
3. **Upcoming → No date** shows the same pool as a list.

The **Not today · N** summary (paused tasks, "M reached start date") is separate. It's not counted in N and never produces suggestions. Expanding it gives **Bring back** (unpause) and **Another day ▾**.

The cap of 3 limits only what's shown. The count line is shown on Today every day, even when N = 0 ("Nothing else open").

### 3.5 Morning hand-off [Design · R3]

When no review ran on the most recent previous day page, the hand-off row **replaces Continue? for that morning**, so no task appears in both. It covers that page's tasks that are still in the open pool (not done, not paused, not placed today), **capped at 3** in the same stable order as Continue?. Any others stay in the "Still open" line. If none qualify, the row isn't shown and Continue? behaves normally.

> Yesterday: N open · **Continue** · **Not today** · **Later**   (N ≤ 3)

- **Continue** places all N on today.
- **Not today** applies Not today to all N, with one undo.
- **Later** dismisses the row for today and changes nothing. Continue? then appears as usual.
- Expanding the row shows the N items, each with its own actions.

The row never blocks the page or reappears after **Later**. If several days were skipped, it still covers only the most recent previous page, and older items stay in the pool's "Still open" line. There is no back-filling of missed reviews.

## 4. Capture (F02 revised)

### 4.1 Entry points [Design · R5]

| Entry point | Meaning | Can create or change tasks? |
| --- | --- | --- |
| **Capture bar** (Today, plus a global shortcut) | "I'm speaking" | Yes. New items apply immediately; changes to existing items are confirmed |
| **Pages → New / Paste** | "Material" | No, unless the user selects text and runs **Turn into tasks**, which opens the same preview as a multi-line capture |
| Typing in Notes or a page body | Writing | No (D03). A faint, ignorable hint `↵ Make task?` appears when a line contains a date phrase, and `/task` or `[]` creates a task row directly. Neither calls the AI |

A long pasted body inside a capture (for example "save this: <article>") stays source content. Only the user's own sentence around it is treated as instruction.

### 4.2 Flow

1. **Submit.** The capture is saved first, with its text, time, time zone and page. Inline: `Saved · organizing…`. The user can keep typing or capture again. If saving fails: `Not saved — retry`, the text stays in the bar, and no model call happens.
2. **Multi-line or list input.** Before saving any objects, show a preview: "8 items → 8 tasks". Each line has a checkbox and a type chip, plus **Save all** / **Save selected** / **Keep as note**. This is the import path for the trial.
3. **Result → receipt card** (§4.3), anchored under the capture.
4. **The original text is not repeated in the page.** It's available through **Show original** on the receipt.

"Maybe learn to paint someday" stays a note. "Email Alex, time not set" becomes an unscheduled task. A link alone becomes a material page marked "no body provided". It's not a reading task, and the receipt never claims the link was read.

### 4.3 Receipt card [Design · R4, R6, R7]

```text
Saved from "Fri: submit materials, start Wed, ref https://…"
Pure-new capture (saved immediately):
  ✓ Task   Submit materials     [Start Wed 10/14] [Due Fri 10/16]
  ✓ Page   example.com          no body provided
  Undo all · Show original · Model saw: today + 4 open tasks + titles of 12 pages

Mixed capture (nothing saved yet except the capture text):
  Waiting for you · 3 items · includes new items, saved together   [Apply all] [Discard all]
  + Task   Submit materials     [Start Wed 10/14] [Due Fri 10/16]   [×]
  + Page   example.com          no body provided                     [×]
  ~ Change Design sync  Wed → Thu                                     [×]
  Show original · Model saw: …
```

- **Pure-new capture:** the items (✓) are already saved. Each chip (type, title, each date) is editable in place, and an edit is a normal versioned change. No second natural-language round is needed to fix a date.
- **Any capture that changes an existing item (complete, cancel, reschedule, clear deadline)** is held **as one group**, including any new items in it. The card shows "Waiting for you" and nothing is reported as saved except the capture text. One apply key and one transaction cover the group (02/03).
  - **Apply all** (Enter) re-checks versions and commits everything. On conflict, nothing is applied and the card says "Changed since — review again".
  - **Discard all** applies nothing. The capture text stays, with "Discarded · Organize again".
  - Editing a chip or removing a row (×) before applying is an edit to the proposal: a new proposal revision, still one group. Removing every change row leaves only new items in the group. **Nothing is saved automatically.** The card keeps waiting, and the new items are saved only when the user picks **Apply all**.
  - The card is never a modal. While it's unhandled, the capture stays `needs_confirmation` (02). The card persists across reloads and days, and it isn't collapsed into history.
  - **Today always shows "N captures waiting · Review"** in the facts area: the attention list in A, and the attention area outside the body in B. This applies on any day until each group is applied or discarded, so a new task in a held group can't be forgotten. Review scrolls to the oldest card. Discarded groups leave the count.
- **Clarification:** one question inside the card, with one-tap answers when the options can be listed ("Which meeting? [Thu design sync] [Thu 1:1]"). Answering continues the same capture and never creates a duplicate.
- **Undo all** reverts every object the capture created or changed, or none of them. If anything changed since, it says which items are blocked and keeps them.
- **Model saw…** states the actual input scope (R7). If the input was too large: "Too much to send — narrow to: this page / pick pages", and the text is kept.
- **Relative dates on another day's page:** "Tomorrow = Fri Oct 16 (from today, not from Oct 9)".
- Only a **handled** card (a pure-new receipt, or a group that was applied or discarded) collapses into the capture history once the user moves on. A card waiting for confirmation never collapses (see above).

## 5. Editing (F03 revised) [Design]

- **Supported:** paragraph, heading, single-level list, quote, task row, event row and reference. Blocks can be added, edited, deleted and moved (move up/down or drag handle).
- **Save indicator per page**, persistent and not a toast. See §8.
- Editing a task row's title or checkbox updates the same Task. A date-like phrase typed into a task title does **not** change its dates; dates change through chips or **Another day**.
- Editing the text of a capture that is still organizing makes the old result stale (02 revision rule). The receipt shows "Edited — organize again?".
- Removed in v0.2: the AI "整理这段" (tidy this paragraph) action on selected text (R10). **Turn into tasks** on selected text in Pages remains, and it runs the capture preview.

## 6. Material and references (F04 revised) [Design · R5, R8, R10]

1. Pages → New: title, optional source link, pasted body, own notes. Saves automatically. A quote block can carry its own source.
2. In Notes, or any page, type `[[`. Results include **pages and matching blocks**, each showing a snippet and its page title, so referencing one paragraph takes one search. A toolbar button provides the same picker on touch devices.
3. The inserted reference shows title + short preview + **Open**. Opening a block reference scrolls to it and highlights it; opening a page reference that came from a block match lands on the matched passage.
4. References show current content. To keep the wording as it was then, copy it as a quote with a source link; that quote is independent text.
5. Target removed: "Original removed · Restore", with the position kept.
6. **Backlink UI is deferred** (R10). The data keeps stable IDs so it can return without migration.
7. **Related line (reserved, R8):** built only if the concierge test shows resurfaced items get used. One dismissible line in the Today zone (A) or the attention area (B), with 0–2 items and a one-line reason each. Never inserted into the body. Opens and uses are logged.
8. **Non-AI fallback in the review:** "Not opened in 14+ days: <page> · Open · Dismiss", one item at most.

Block-level references stay in scope. The prototype tests whether "a page reference that lands on the passage" would be enough; any cut goes to Brian as a scope change (synthesis R10).

## 7. Review (F08 revised) [Design · R3, R4, R6]

1. Opened from the Review section on today's page. It shows done and open items for today and the deadlines that are close. In A, it also shows the "Still open" count.
2. Free text, with optional prompts: "What changed today?", "Anything for tomorrow?". Every prompt can be skipped.
3. **Submit shows three stages inline:**
   - `Saved` — the review text is stored;
   - `Changes: 2 to confirm` — the same confirm card as §4.3;
   - `Tomorrow: suggestions ready` or `Tomorrow: couldn't prepare — Retry`.

   Retrying the last stage never re-applies the changes.
4. Tomorrow's suggestions are stored, not written into tomorrow's notes. Up to 3 may be marked Top 3. They appear on tomorrow's page in Continue? (A) or as one "Suggestions for today · Add" line (B).
5. "Too tired, don't want to do anything" is a feeling. It's saved and changes no task.
6. Optional review lines: "Not today · 4 this week · Look" and the non-AI material line from §6.8. No badges.

Skipped review → next morning: §3.5. Nothing is lost, and events in the past stay in history without turning into tasks.

## 8. State and copy table [Design · R6, R10]

The wording is a proposal for review. What each state promises the user is binding (X01, X13).

| Situation | Indicator / copy | Actions |
| --- | --- | --- |
| Page saving | `Saving…` (page header, quiet) | — |
| Page saved | `Saved` (fades to nothing after 2 s) | — |
| Page save failed | `Not saved — your changes are still here` (persistent, red) | **Retry** |
| Capture saved, organizing | `Saved · organizing…` under the capture | **Cancel** |
| Capture save failed | `Not saved` in the bar, text kept | **Retry** |
| Model failed / timed out | `Couldn't organize — your text is safe` | **Retry** · **Add manually** |
| Invalid model result | `Couldn't organize this one — your text is safe` (no partial objects) | **Retry** · **Add manually** |
| Needs clarification | One question in the receipt card | One-tap options · free reply |
| Stale result (text edited) | `Edited — organize again?` | **Organize** · **Keep as note** |
| Input too large for the model | `Too much to send at once` | **This page only** · **Pick pages** |
| AI group waiting (mixed or change-only capture) | Card: `Waiting for you · N items · includes new items, saved together` (no item reported as saved). Today: `N captures waiting · Review`, persists across days | **Apply all** · **Discard all** · per-row edit / × |
| Group discarded | `Discarded · your text is kept` | **Organize again** |
| Retry after a lost response | Shows the stored outcome (applied, waiting or discarded). Never applies twice | — |
| Apply conflict | `Changed since — review again` | **Review** |
| Edit conflict (another tab or device) | `This paragraph changed elsewhere` | **Keep mine** · **Use other** · **Keep both**. This is a choice of version, not a merge screen (R10) |
| Undo blocked | `Can't undo — changed since. Previous value: Wed 10/14` | **Copy previous** |
| Reference target removed | `Original removed` in place of the preview | **Restore** |
| Daily page removed, date reopened | `This day's page was removed` | **Restore** (never a second page) |
| Session expired | `Signed out — unsaved text is kept here` | **Sign in** |
| Midnight while editing | `It's a new day` | **Go to today** |
| No suggestions | Nothing shown; Continue? hidden | — |
| Empty pool | `Nothing else open` | — |
| First run | Capture bar focused, with 2–3 example phrases | — |

## 8a. Flows carried over from v0.1 with small changes

**Sign-in (F00).** An existing session opens Today. Without one, the user signs in first. There is no registration funnel and no invitations. When a session expires, unsaved text is kept and the user is never shown a false "Saved" (§8).

**Future items returning (F05).** Example: "submit on the 20th, start on the 17th".

- From the 17th the task shows in "Due soon" / the attention list as "Start today · Due Tue 20".
- If the user places it on the 18th, it's a Plan row on that day.
- On the 20th it reads "Due today"; after that, "Was due Tue" until it's handled.

When a task has both a start date and a deadline, the label always shows both, with **Due** first once the deadline is within 2 days. A future page that already exists shows new facts through its attention list (A), or the collapsed "N new · Add" line (B).

**Setting aside, removing and cancelling (F06).** The §2 vocabulary is the whole contract. Additional cases:

- On a **past** page, task rows are read-only for placement and labelled "Shown at current status". Only **Done** / reopen is offered. Removing a task mention from a past page's Notes removes only that mention.
- Removing a task from a **future** page uses **Not today**, worded "Not on Fri 10/16".
- Explicit **Cancel task** stops future prompts. The task stays findable in ⌘K and can be restored.
- "Do it Friday" in a capture is a change to an existing item. It waits in the confirm card as "Do Thu → Fri", and applying it clears the pause.

**History and Upcoming (F09).** Notes on past pages show the text as it was saved. Task rows and references show the current state, and the page says so. The per-task timeline UI is deferred (R10); task detail shows only "Created from capture on …" and the current dates. Upcoming shows past events as history, never as overdue tasks.

## 9. First thin slice — flows required (R11)

These are the flows the first end-to-end slice must support. Everything else in this file follows after it.

1. Capture a new task with dates → editable receipt.
2. Today page opens from data → **Done** / **Not today** / **Another day**.
3. Review → stages → tomorrow's suggestions stored.
4. Next morning → suggestions, or the morning hand-off; the pool line.
5. Save one material page → `[[` reference from Today's Notes → open lands on the passage.

## 10. Date edge cases shown to the user [Design · R10]

- "Tomorrow" typed on a past page resolves against the capture time, and the receipt names the date (§4.3).
- Reviewing a past day: the receipt says which day the suggestions are for ("Suggestions for Fri Oct 16").
- A deadline with a time shows the time ("Due Fri 17:00"). If a DST change makes a time ambiguous or non-existent, the receipt asks and doesn't guess.
- Changing the workspace time zone doesn't move existing day pages. A one-time notice explains this.

## 11. Open questions for the prototype session (not for Brian to answer up front)

1. A vs. B (§3.2).
2. Is a page reference that lands on the passage enough, or does Brian reach for block references (§6)?
3. Does Brian correct the receipt by chips, or does he retype the sentence (§4.3)?
4. Is the "Still open" line read as helpful or as backlog pressure (§3.4)?
