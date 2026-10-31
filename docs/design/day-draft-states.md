# A new day as a draft on the page — interaction and states

Owner: Jazz (Design). Status: **proposal for review** (Bumblebee, Roadbuster, Ratchet), not decided. Source: Brian
`361325a5`. Product analysis and cut list: `docs/plan/day-prep-draft.md` (Bumblebee). Engineering read: Roadbuster
`30dd8d29`. Settled by Lead `055b72c0`: OpenRouter, runs when he first opens the new day, nothing waits on it.
Prototype: `docs/design/prototypes/day-draft.html` (open it in a browser; sample content, not his data; the bar at the top
switches states and theme).

Replaces the Start the day card, the "Continue?" line and the Tomorrow block (cut list). Copy follows Brian `1ac6784b`:
no explanatory text; every line states data or a state.

## 1. Shape

- **The draft lives on today's page, in his template's shape.** No card, no second screen. Each suggestion sits where it
  would go, as a **blue band** (`--blue-3` fill, 2 px `--blue-9` bar on the left, his normal ink and size), so it reads as
  "not yours yet" without a label.
- **One item per band.** A to-do, a bullet or a paragraph is one item; that's what "piece by piece" means. Per band: **✓ Apply**
  and **✕ Skip** at the right edge (30 × 28 at 1280, 44 × 36 at 390), always visible, never on hover only.
- **The draft only adds.** A suggestion is a **fill** (it takes the place of one of his template's empty to-do or bullet rows)
  or an **after** (it goes after a given line), the two kinds Roadbuster's experiment returns (`d1f24561`). Only the
  model fills slots, because it reads what a slot is for; the fallback draft (§2) never fills a slot, it only inserts by the
  B74/#44 rules, so a labelled slot like "Today's ONE Start" can't get a carried to-do by accident. The draft It never removes, rewrites or reorders anything on
  the page, and it never fills his reflection prompts (Raw Notes, Daily Reflection), per Bumblebee's rule 5.
- **One state line** under the title, in the facts strip's place: `{n} suggestions · Apply all · Dismiss`. "Apply all" in
  `--blue-text`, semibold; the rest `--ink-2`. It goes away when nothing is left.
- **Carried to-dos** show their age as data: a muted `--ink-3` date after the title ("Oct 23", "Sat"), the day the task was
  first planned. After applying, the date goes; the row is his normal task row (same task, Roadbuster's id rule).
- **Open to-dos the draft didn't place** stay visible: a quiet row at the end of the planning part, `{n} more open ▸`
  (`--ink-3`). Open, it lists them with their age and a **＋** each; ＋ adds that task to today in the first to-do
  section (B74 rule). No date choice, no "today or another day" (that stays in the row ⋯ and on Tasks). This is Bumblebee's
  rule 1: nothing open drops silently.

## 2. States

| State | Page | State line | Notes |
| --- | --- | --- | --- |
| **First open, preparing** | The template page, exactly as today; he can type | `◌ Preparing…` (14 px spinner, `--ink-2`) | No placeholder bands. Starts on first open of a new day only |
| **Ready** | Bands in place | `5 suggestions · Apply all · Dismiss` | |
| **Arrived while he's typing** (caret in the page and a keystroke in the last 3 s) | Nothing inserted | `Suggestions ready · Show` | Bands appear on **Show** or when he stops for 3 s *and* the caret isn't in a section they'd go into. Nothing moves under his caret |
| **He wrote in a slot first** | His words stay | as Ready | That slot's suggestion goes after his line, as an insert, not into the slot |
| **Apply one** | Band becomes his text in place; for a to-do, the existing task is planned for today | count drops | Notice: `Applied · Undo` |
| **Skip one** | Band goes; the empty template slot shows again | count drops | Notice: `Skipped · Undo`. A skipped carried to-do stays open where it was (Tasks); it isn't moved or set aside |
| **Edit before applying** | Text in a band is editable in place; ✓ applies the edited text | | Editing a carried to-do's title edits that task (same as editing its row) |
| **Apply all** | Every band applied, in page order | line goes | Notice: `Applied 5 · Undo` (one Undo for all) |
| **Dismiss** | Every band goes | line goes | Notice: `Dismissed · Undo` |
| **Leave and come back** | Remaining bands still there (stored with the day, not in the browser) | as Ready | Same on another device |
| **Day ends with bands left** | Bands vanish at his midnight; nothing applied | | Their carried to-dos are still open, so tomorrow's draft sees them again |
| **Model fails / times out / offline** | **The fallback draft**: open to-dos placed by today's rules (B74, #44), same bands | `3 suggestions · Apply all · Dismiss · Couldn't draft · Retry` ("Couldn't draft" in `--warn`) | Bumblebee: the interaction never depends on the model. Offline: `Offline` instead of "Couldn't draft · Retry"; it retries when back online |
| **Model returns nothing to add** | No bands | none | The fallback still shows open to-dos if any |
| **Model off** (invitees until they turn it on) | The fallback draft | as Ready | No mention of a model |
| **No open to-dos and nothing to suggest** | The template page | none | |
| **Stale draft** (he edited the page on another device after the draft was made) | Bands whose anchor changed still apply as inserts after his text | as Ready | Never overwrites (Roadbuster's `expectedContent`); a band whose section is gone goes to the end of the planning part |
| **Past days, future days** | No draft | none | |
| **Template without headings / no template** | Bands go where the fallback rules put them | as Ready | Same interaction on the built-in day |

## 3. What he no longer sees

- The Start the day card (Add all, Not today, Another day, Done, Later), the "Continue?" line, and the Tomorrow block.
- Any per-item date choice in the morning.

## 4. Open for review

1. **Granularity**: one band per item (this doc) or one per section? Per item matches "逐个 apply"; per section is fewer
   taps. Prototype shows per item.
2. **"{n} more open" placement**: end of the planning part (this doc) vs in the state line. In the page keeps the line short
   on the phone.
3. **Retry wording** after a model failure, given the fallback draft already shows: is `Couldn't draft · Retry` noise? It's a
   state, not an explanation, so I kept it.
4. **3-second typing rule** needs a check on his phone.
