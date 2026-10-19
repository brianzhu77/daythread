# Capture receipt v2 — design check list for Step 1 (c) (Jazz)

Spec: `docs/design/capture-receipt-v2.md` at 76774f7. I check on my own copy of the (c) commit with the fake provider (no paid calls), at **1280** and **390**, screenshots kept in `/tmp/jazz-receipt/`. Each line passes or fails; "rough" counts as a fail.

**Fake-provider fixture (please seed or make reachable):** one capture that returns
1. a grounded new task with a do-date ("月底交房租" → Do Fri, Oct 31),
2. a grounded event with a time ("Lunch with Kevin next Mon 12:30"),
3. a saved link with its own title,
4. an invented event time (→ "Time not in your text"),
5. a task with a date word but no date (→ "Date missing"),
6. an update to an existing task with a new date and no role (→ shows "Do …", waits for Apply),
7. one item the server rejects (→ "1 part wasn't saved as an item").

Plus the five status states: no key, key rejected, other model error, budget used up, and Organizing… while waiting.

## Layout

- [ ] His text is the first line of the receipt in every state.
- [ ] Group order: "Needs a look" (only when non-empty), then saved items, then Updates waiting for Apply, then the "wasn't saved" line, then the footer.
- [ ] Every row reads type chip · title · date chip · ⋯ on one line at 1280. At 390 the chips wrap under the title and the title keeps at least half the row.
- [ ] A long Chinese title wraps to 2 lines then ellipsis, and no chip overlaps it.
- [ ] Every tap target (chips, ⋯, Save, Remove, Retry, Undo all) is 44 px at 390.

## Rows

- [ ] Date chip shows the real date with role, like Upcoming: "Do Fri, Oct 31", "Due …", "Mon, Oct 26 · 12:30" for an event, "No date" in `--ink-3`. Never "Unscheduled" when a date exists.
- [ ] Saved link shows the URL host instead of a date.
- [ ] Tapping the title edits it in place, same font. Enter or blur saves, Esc reverts.
- [ ] Tapping the type chip offers Task / Event / Note. Tapping the date chip offers Do · Start · Due and the date list plus "No date".
- [ ] ⋯ offers Remove and Open.

## Needs a look

- [ ] Reason chip is amber (`--warn`), 12 px, before the date chip. The copy is exactly: Time not in your text · Link not in your text · Title not in your text · Task not in your text · Date missing · Date unclear.
- [ ] The row has Save and Remove. Nothing in this group is saved until Save.
- [ ] After fixing the flagged field and tapping Save, the row moves to the saved list and the chip disappears.
- [ ] Header reads "1 waiting for you · from …" while something waits, and "Saved from …" when nothing does.

## Updates

- [ ] The update row uses the `--blue-soft` chip "Update", reads "Fix export bug → Do Tue, Oct 20" (or "→ done"), and waits for Apply / Discard. There's no reason chip just because the role was missing.

## Undo and failure

- [ ] "Undo all" sits in the footer next to "Show original". After Undo all, every saved item from that capture is gone and the receipt says so. An edit elsewhere makes it refuse with "Can't undo · edited since".
- [ ] "1 part wasn't saved as an item · See your text" is muted (not red) and opens his kept text.

## Status states

- [ ] Organizing…: grey tag with a 14 px spinner, and the capture field is free again at once.
- [ ] No key: grey "Simulated · no model key", plus the same muted line under the capture field.
- [ ] Key rejected (401/403): "Model key rejected · text saved" in `--warn`, with Retry, plus the muted line under the capture field.
- [ ] Other model error: "Model unavailable · text saved" in `--warn`, with Retry.
- [ ] Retry after midnight on a "明天" capture written before midnight lands on the day after he wrote it.
- [ ] Every item rejected: no empty receipt; it shows "Model unavailable · text saved" with Retry.
- [ ] Unknown cost: muted "Cost unknown" tag in the header. "$0" or "nothing charged" never appears.
- [ ] Budget used up: "Today's model budget is used up · text saved" in `--warn`, with no Retry.
- [ ] Nothing in any status state is red.

## Not checked by me

Motion timing, real iPhone keyboard and IME, and paid-model output. Ratchet covers behaviour and failure paths.
