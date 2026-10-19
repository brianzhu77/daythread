# Morning card — build spec (Jazz, 2026-10-19, rev 2)

> **Rev 2 (after model step 1 and pages step B):** §12 lists what changed since this was written on 24a1b4b. Where §12 and the text below disagree, §12 wins.

- Status: **draft for build**. Product and Weave rules are approved in `docs/design/v05-morning-and-weave.md` rev 2 (Bumblebee, 890325e). Brian chose this direction on Oct 17 (O4=b). On Oct 19 (9e538364, a4fd5686) he answered C5 = Auto and "Bring to today for plain lines" = restore.
- This file only turns §1 of that doc into screens, states, copy and code touch points on main `24a1b4b`. Where they disagree, v05 §1 wins.
- Replaces: the card in `src/components/start-the-day.tsx`. Placement on the day page (`day-screen.tsx:48`), `useHandoffLater` and `handoff-done` stay.

## 1. What changes from today's card

| Today (v0.3 card) | Build |
|---|---|
| Two groups by source: "Suggested last night" (checkboxes + "Add to Top 3") and "Still open from Thu" (Keep / Not today / Keep all) | **One Tasks group**, de-duplicated, one reason line per row |
| Checkbox to pick, then a separate Add button | **Round `+` adds at once**, then the row shows an **Undo** strip |
| Not today as a visible button | Not today and Another day move into the row's **⋯** menu |
| Prose lines from the previous page not offered (`start-the-day.tsx:27`) | **Restored** as a collapsed "Lines from Thu" group (Brian, a4fd5686 #5) |
| No proposals | **From your notes** group (internally "proposals"): text lines that aren't tasks yet. Shown only when there are any (see §4) |

## 2. Layout

One white card at the top of the day body, in the same place as now. It uses the existing `.app-card` and card radius and stays inside the content column (420–1120 at 1280; 20 px sides at 390).

```
Start the day                                  Simulated ·
Thu's review wasn't finished · Finish (1 min)          ← unchanged line, only when true

TASKS
(+)  Rewind APPX PR                              ⋯
     Suggested last night
(+)  Fix export bug                    Due Wed   ⋯
     Unfinished · from Thu
     Add all tasks                                      ← text button, only with 2+ rows

FROM YOUR NOTES                                         ← only when non-empty
(+┄) Call the dentist                            ⋯
     Mon · Notes

2 lines from Thu ▸                                      ← collapsed; tap expands in place

Done                                         Later
```

- Group labels: 12 px, semibold, `--ink-2`, uppercase with .05em tracking, the same as the sidebar "PAGES" label. 16 px above each group, 6 px below.
- Row: min height 52 px. A 32 px round `+` (44 px tap target) is the leading control. Title in 17 px `--ink`, wraps to 2 lines then ellipsis (same rule as tag-page groups). The reason line underneath is 13 px/18 px `--ink-2`, one line. The date tag (`DateTag`, already shared) sits to the right of the title. ⋯ sits at the right edge, 44 px target.
- Task `+`: `--fill` circle with a `--ink` plus. Proposal `+`: transparent with a 1.5 px dashed `--ink-3` outline. That's the only visual difference, and it means "not a task yet".
- Rows are separated by the same 1 px `--line` divider as card lists. No dividers between groups.
- Phone: same structure. The ⋯ and `+` targets stay 44 px. Reason lines must not wrap under the `+`, so text starts at a fixed x after the `+`.

## 3. Tasks group: sources and order

Sources, merged into one list with each task appearing **once**:

1. `page.draft.taskIds` (open tasks only) → reason **"Suggested last night"**. Goes to **Top 3** when added.
2. `view.handoffTasks` → reason **"Unfinished · from {Thu}"** (weekday of `previousDailyPage`). Goes to the **plan list** ("other") when added.

- A task in both lists keeps the first reason only.
- Order: source 1 in draft order, then source 2 in its existing order.
- Excluded, as now: tasks already planned for today (`plannedOn === today`), paused tasks, tasks already in Top 3. A task already in Top 3 is no longer shown greyed out with "In Top 3". It's simply not a suggestion.
- **Add all tasks** applies each row's own destination in list order. Proposals and lines are never bulk-added.

## 4. From your notes (proposals)

Lines from earlier threads that aren't tasks yet, including text that named today ("call dentist Friday", written on Mon).

- **Source: the draft.** This needs a new field from the provider, `draft.proposals: { text, sourcePageId, sourceBlockId }[]`. The simulated provider should return one example so the state can be reviewed. **Eng dependency (Roadbuster):** the field, the simulated example and the "add as task" path.
- Until a real model is connected (Brian's OpenRouter key, C1), proposals come only from the simulated provider and carry the existing "Simulated" mark in the card header. With no proposals, the group isn't drawn. There is no empty text.
- Reason line: "{Mon} · {Section title}".
- `+` creates a **new task** with that text in the plan list and records the source block. It never edits the source line.

## 5. Lines from the previous page (restored)

- Source: `view.handoffBlocks` (already computed: Notes and Good Stuffs lines from the previous daily page that are not tasks and not already brought).
- Collapsed by default: one row "{n} lines from {Thu} ▸" in `--ink-2`. Tap expands the lines in place. Each line gets a `+` labelled **"Bring to today"** (aria) that copies the line into the **same-named section** of today's page, or into Notes when no section has that name. It keeps `sourcePageId` / `sourceBlockId`, so the line isn't offered again. Lines never become tasks this way.
- **Eng dependency:** there's no domain command for this. The old one went away with the old `DayPage`. It has to insert into the editor document through the same save path as typing, so the editor, tags and the Good Stuffs material rule all see it.

## 6. After a tap: the Undo strip

- The row is replaced in place, same height, by a muted strip: **"Added to Top 3 · Undo"**, **"Added to {Section} · Undo"** ({Section} = the real name of the plan section on this page), or **"Brought to today · Undo"**. It stays 5 s, then the row collapses out (180 ms).
- Top 3 already full (3 rows): the item goes to the plan list, and the strip reads **"Top 3 is full · added to {Section} · Undo"**.
- No plan section with the plan role left on the page: before anything is added, a muted line under the card header reads **"Adding creates a {Section} section at the top"** ({Section} = the template's name for the plan section). After the tap, the strip reads **"Added · {Section} section created · Undo"**. Undo removes both unless the section was edited since.
- Undo uses the existing `undo` command with the receipt's operation id. If Undo is refused (something changed in between), the strip reads "Can't undo · edited since" for 3 s. Undo is never partial.
- When the last row leaves, the card closes on its own with no "all done" message.

## 7. ⋯ menu per row

- Task rows: **Not today**, **Another day ▸** (the same date list as the Tasks screen row menu), **Open task**.
- Proposal rows: **Hide for today** (screen-only, like Later).
- Line rows: none. Lines just stay collapsed.
- On desktop it uses the HeroUI menu already used for task rows. On phone, the same HeroUI sheet.

## 8. Card states

| State | What shows |
|---|---|
| Nothing qualifies | No card (as now: `hasHandoffContent`, extended with proposals and lines) |
| Only lines | The card shows only "{n} lines from {Thu} ▸" + Done / Later |
| No draft, and the previous review didn't run | The Tasks group shows "No suggestions from last night · Draft my day" (as now) |
| Draft failed | "Suggestions couldn't be prepared · Retry" (as now) |
| Later | The card collapses to the existing strip line, labelled **"Suggestions · {n} ▸"** |
| Done | The card closes for today. Untouched items stay as they were (open, not planned). Nothing is offered again today |
| Simulated provider | "Simulated" tag in the header (as now) |

## 9. Copy (final, Bumblebee b842c6d3 0a735158)

Start the day · TASKS · FROM YOUR NOTES · Suggested last night · Unfinished · from {Thu} · {Mon} · {Section} · Add all tasks · {n} lines from {Thu} · Bring to today · Added to Top 3 · Added to {Section} · Brought to today · Top 3 is full · added to {Section} · Added · {Section} section created · Adding creates a {Section} section at the top · Undo · Can't undo · edited since · Not today · Another day · Open task · Hide for today · Suggestions · {n} · Done · Later · Simulated

{Section} is always the section's real name on Brian's page, never "the plan".

## 10. Acceptance (for Ratchet)

1. A task found by both sources shows once, with "Suggested last night".
2. `+` on a suggested task → it's in Top 3. On an unfinished task → it's in the plan list. Same task id both ways.
3. With Top 3 full, the Top 3 item goes to the plan list, with the right strip text.
4. Undo within 5 s restores the exact previous state. Undo after an edit elsewhere is refused whole.
5. Add all tasks → every row goes to its own destination, and proposals and lines are untouched.
6. Bringing a line puts it in the same-named section, it's not offered again, and Good Stuffs links brought this way still become saved material.
7. A proposal's `+` creates a new task, and the source line in the old page is unchanged.
8. Done and Later change no item.
9. 390 and 1280: no overlap, every target 44 px, long Chinese titles wrap to 2 lines.

## 11. Order of work

1. **Tasks group, + / Undo / ⋯, Add all** (UI only, existing commands). This can start now.
2. **Lines from the previous page** (needs the bring command through the editor save path).
3. **Proposals** (needs `draft.proposals`; real content only after the model key).

I'll provide a static mock of states M1–M4 for Brian if the Lead wants one before step 1 ships. Otherwise I check the build on screen at 390 and 1280.

## 12. Rev 2 deltas (main b63eb4e)

1. **Proposals come from the real model now**, not only the simulated provider. The prompt from the quality probe
   (`src/server/model/morning-prompt.ts`) is the starting point; it isn't wired yet. The model's job is narrowed:
   - **Title = his line, verbatim** (2 lines, then ellipsis). The model only decides *propose yes/no* and an
     optional *date*. It doesn't reword the title. Same lesson as the capture receipt: about 1 in 6 model calls
     got something wrong, and a reworded title is the hardest error for him to spot. If the line is long, the UI
     truncates; the task created by `+` gets the full line text.
   - **Reason line is computed by the app**, never written by the model: "{Mon} · {Section}" from the source page.
   - **Date:** if the model gives one, the row shows the shared `DateTag` with its role ("Do Fri, Oct 23") and the
     created task gets that do date. A date that isn't grounded in his text (the receipt's "not in your text"
     check) is dropped, not shown. No date → no tag.
   - The dashed `+` and "From your notes" label stay; they mark "not a task yet".
2. **Model states in the card** (same vocabulary and colours as the receipt spec `capture-receipt-v2.md`):
   - Organizing: the group shows one muted line "Looking through your notes…" (no spinner rows).
   - No key / key rejected / unavailable / paused / budget used up: the group isn't drawn; one muted `--warn`
     line under the Tasks group: "Suggestions from your notes unavailable · {short reason}", with Retry only where
     the receipt has Retry. Tasks and lines work as normal. Never red.
   - Simulated: the existing "Simulated" header tag.
   - Cost: shown nowhere in the card; "Cost unknown" rules follow the ledger as for capture.
3. **Section names are real everywhere.** On Brian's page the plan sections are "TODO - Top 3" and "TODO - Other",
   so the strips read "Added to TODO - Top 3 · Undo" and "Added to TODO - Other · Undo" (replaces the fixed
   "Added to Top 3"). "Top 3 is full · added to {Section}" keeps the real plan-list name.
4. **Proposal `+` and pages:** a proposal whose source line is a page card isn't proposed (a card isn't a to-do).
5. **Acceptance addition:** every check in §10 also runs on an isolated copy of Brian's real database (built app or
   own Vite `cacheDir`, no shared cache), at 390 and 1280, before the build is called done.
