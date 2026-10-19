# Capture receipt v2 — fixable at a glance (Jazz, 2026-10-19)

- Status: **draft**, for the feat/model step 1 plan. Product rules unchanged: new items apply at once with a receipt; changes to existing tasks wait for Apply (03 contract, 01 §5).
- Why now: Roadbuster's probe (`docs/validation/model-quality-probe-run-2026-10-19.md`) on Brian's model has about **1 in 6 single captures wrong** (wrong date, invented event or URL, placeholder title, update instead of new). Today's receipt (`src/components/capture.tsx`) only shows what was saved. It doesn't show dates, can't fix an item after it's saved, and has no Undo. If Brian keeps this model, the receipt is the safety net.

## Problems in the current receipt (main eb67bbd, read from source)

1. **Saved state shows no date.** A created task always shows the tag "Unscheduled" (`capture.tsx:155`), even when a date was parsed, so a wrong date can't be seen.
2. **Nothing can be fixed after saving.** Saved rows are plain text: no edit, no remove, no change of type.
3. **No Undo** on a saved capture.
4. **Invented content looks the same as real content.** An event or URL the model made up has the same row as one Brian wrote.
5. Waiting state: only the first item's title is editable (`editable={i === 0 && …}`), and dates aren't editable at all.

## Receipt layout (saved and waiting states share rows)

```
Saved from "Lunch with Kevin next Mon 12:30, 月底交房租"      Simulated
[Event] Lunch with Kevin         [Mon, Oct 26 · 12:30]   ⋯
[Task]  月底交房租                [Fri, Oct 31]           ⋯
Undo all · Show original
```

Each item row has three parts, left to right:

- **Type chip** (`app-chip`): Task · Event · Saved link · Note · Update. Tapping it opens a small menu to change the type (Task ↔ Event ↔ Note). Update can't be changed into anything else here.
- **Title**: plain text. Tapping it edits in place (the same input as the waiting state today). Enter or blur saves, Esc reverts. This works for every item, not only the first.
- **Date chip** (`DateTag` style): the parsed date as the app shows dates elsewhere ("Today", "Mon, Oct 26", plus "· 12:30" for events; tasks prefix the role the same way Upcoming does: "Do Mon, Oct 26", "Due Fri, Oct 31"), or **"No date"** in `--ink-3`. Tapping it opens the same date list as Another day on the Tasks screen, plus "No date". Saved links show the URL host ("example.com") instead of a date.
- **⋯**: **Remove** (undoes this item only) and **Open** (goes to the task, event or page).

Footer: **Undo all** (one step, the whole capture), then the existing "Show original". Undo all is refused whole if any item was changed elsewhere since, with the same notice wording as the morning card ("Can't undo · edited since").

## Items that don't match his text wait for him

This follows Bumblebee's grounding check (b842c6d3, abee294e). Ratchet's caution applies: a passed check isn't proof that the item is right, and it has to be tested on its own.

- An item that fails the server's check **isn't auto-applied.** It sits in the same receipt, in a **"Needs a look"** group above the saved items, as a waiting row with **Save** and **Remove** on the row. Editing the flagged field and then tapping Save saves it.
- The row shows why, as an amber chip (`--warn` colours, 12 px) placed before the date chip: **"Time not in your text"**, **"Link not in your text"**, **"Title not in your text"**, **"Task not in your text"** (for an update) or **"Date missing"** (his text has a date word such as 明天, 周五, 月底, next Mon or 11/2, but the item has no date; Bumblebee, b842c6d3). **This applies to Tasks, Events and Updates that change a date (update with a new date) only** (Ratchet: C15 runs 2–3 lost the date only on the update). A Saved link or Note may have no date, so it never gets this hold (Ratchet #67 found Luna C5#1, a dateless link, wrongly held). **"Date unclear"** (Bumblebee, after Ratchet's dateRole finding C13): a task has a date but no role (do / start / due), so the app can't tell "do it Tuesday" from "due Tuesday". It's held the same way, **for new tasks only**. An update with a date and no role is read as a new do-date ("moved to"): it already waits for Apply, and its row shows "Do Tue, Oct 20", so he confirms or changes the role there without a reason chip (Roadbuster's offline data: C13 updates never carry a role, and a chip there would be wrong every time). Tapping the date chip offers **Do · Start · Due** above the date list. A date that is present but wrong isn't held. The receipt shows the date so he can spot it.
- When every item is saved or removed, the group disappears. The receipt header reads "Saved from …" once nothing is waiting, and "1 waiting for you · from …" while something is.
- The saved items in the same capture are unaffected: they're already saved, with Undo.

**Eng (Roadbuster):** the check result per item, `flags: ('time-not-in-text' | 'url-not-in-text' | 'title-not-grounded' | 'task-not-named' | 'date-missing' | 'date-role-missing')[]`, stored with the capture. Plus `edit-capture-item` (title, type, date), `save-capture-item` and `remove-capture-item`, each with its own receipt so Undo works.

## Model status states (wording from Roadbuster's step 1 plan §1, 8577d8e)

| State | Receipt | Capture bar / sheet |
|---|---|---|
| Model working | header tag "Organizing…" in `--ink-2` with the 14 px spinner; his text shows at once as the header quote | Save button returns to normal right away; he can keep capturing |
| No key | header tag **"Simulated · no model key"**, same grey `sim` tag as today | one muted line under the field, the same text, until a key is added |
| Key rejected / model error | **"Model unavailable · text saved"** in `--warn` text, with **Retry** (same attempt rules as Roadbuster §2) | no line; the receipt carries it |
| Budget used up | **"Today's model budget is used up · text saved"** in `--warn` text, no Retry until tomorrow | no line |

- His text is always the first thing on the receipt, in every state, so "saved" is visible before anything else.
- No red: none of these lose data. Red stays for "Not created" style failures that need an action to avoid losing something.
- The morning card uses the same header tag for proposals in the same states.

## Items the app couldn't use

If the model returns an item the server rejects (bad shape, unknown task id, invalid date), it never just disappears (Ratchet, b842c6d3 81a1eb86). The receipt adds one muted line above the footer: **"1 part of your text wasn't organized · Show original"**. "Show original" opens his text, which is always kept, so he can capture that part again or type it into the page. It isn't red: nothing he wrote is lost.

## Updates to existing tasks (unchanged rule, clearer row)

The row reads **"[Update] Fix export bug → done"** and stays in the waiting state with Apply / Discard. The chip uses `--blue-soft` so it's clearly different from the new items above it. This was where the probe's "APPX update instead of a new Cairn task" happened, and it's already safe because nothing applies without Brian.

## Copy

Task · Event · Saved link · Note · Update · No date · Needs a look · Save · Time not in your text · Link not in your text · Title not in your text · Task not in your text · Date missing · Date unclear · Do · Start · Due · {n} waiting for you · {n} part(s) of your text wasn't organized · Remove · Open · Undo all · Show original · Can't undo · edited since. Bumblebee owns final wording.

## Acceptance (Ratchet)

1. A capture with a parsed date shows that date on the saved row, not "Unscheduled".
2. Editing title, type or date on a saved row changes the same item (same id). One Undo reverts that edit.
3. Remove on one row leaves the others. Undo all reverts every item of the capture in one step.
4. Ratchet's three run-3 cases (invented event time, placeholder title, update instead of new) land in "Needs a look", unsaved, with the right reason chip. A grounded item saves at once.
5. 390 and 1280: chips wrap under the title rather than squeezing it, and every target is 44 px.

## Not in scope

Changing the model, confirm-first capture for new items, and judging whether a title is good. If Brian chooses confirm-first or another model, problems 1–3 are still worth fixing.
