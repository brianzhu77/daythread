# Synced block: states

- **Revised 2026-11-02 to `synced-blocks.md` (Bumblebee, reviewed by the Lead, f9ff5fa9), which wins if they differ.** Its §9 listed the changes. Not built; the size and record shape are Roadbuster's, after R2's first part.
- Author: Jazz (Design) · 2026-10-21 · status: **design states for review**. Base main df05165 (B21 on the checklist).
- Inputs:
  - Brian `7b89f7c9`: he copies between pages, sometimes plainly and sometimes as a synced block, and accepts
    Notion's model: turn blocks into a synced block first, then copy and paste it onto another page;
  - Lead `dfcb04d4` (to Brian: same content in both places, an edit in one shows in the other, each copy can be
    unsynced; plain copy stays as today) and the go for this doc (tasks inside: propose a rule, "no tasks, first
    version" is acceptable);
  - Bumblebee: v0.3 §6.3 "copied text never re-syncs" stays true, with one exception: a synced block he makes himself.
    Tracked, not counted (17 of 20) until the plan shows its size.
- Design sources reused: the selection bar (`page-editor.tsx`, "N blocks selected · Delete"), the editor's notice
  strip, `[[` links and Linked from (`page-links-states.md` §1, §5), trash (`pages-trash-layout.md`), the geometry
  rule (Lead `4b3ce971`).
- **Out of scope:** plain copy (unchanged; Roadbuster is checking it), syncing a whole page, syncing across days by
  date, anything automatic. A synced block only exists because he made one.

## 1. The model in one paragraph

A synced block is **one piece of content shown in several places**. He can edit it in any of them, and the edit shows in
all of them. The place it was made is the **original**, and that's the only place that differs: the "On" list marks it,
it offers Unsync all, and deleting it ends the syncing, with every other place keeping its lines (§6). This is Notion's
model, which Brian accepted (`7b89f7c9`), and `synced-blocks.md` §2 settles it. Two places can be on one page.

## 2. Making one

There are two ways in, with no tip or onboarding (Lead `10e9e0f0`).

- **From lines he has: the selection bar he already has.** Select whole lines (click the handle, Shift-click to extend, or a
  text selection across lines, as today). The bar gains one button:
  ```
  3 blocks selected   [ Sync ]  [ Delete ]
  ```
  Same bar at 1280 and at 390 (44 px buttons), so there's nothing new to find on the phone.
- **Tap Sync:** the selected lines become one synced block in place. Nothing moves and no text changes. Notice:
  **"Synced block · Copy it to another page · Undo"**, where "Copy" copies it right away (the phone has no ⌘C on a
  block). Undo puts back the plain lines exactly, with the same line ids, so links to them survive.
- **From nothing: `/` Synced block.** It makes the block with one empty line and the caret in it, with the placeholder
  "Empty synced block". No notice. ⌘Z removes it, and so does Backspace on that empty line while this is its only place (§5).
- **What can go inside: everything he can put on a page** (`synced-blocks.md` §6), including to-dos, headings, a day's
  template headings, and page and link cards. **Except:**
  - **another synced block.** If the selection holds one, Sync still shows, and a tap changes nothing and says why:
    **"A synced block can't go inside another. Select only other lines."** (A disabled button can't explain itself on the
    phone.)
  - **a database block, until linked views ship and this is built on them** (`synced-blocks.md` §6). Until then the same
    tap says **"A database can't be synced yet. Select only other lines."**, and `/` Database isn't listed inside one.
    Once it's allowed, this line goes, and `databases.md` §3.1 and §10 change with it.

## 3. How it looks

```
      ┌─────────────────────────────────────────────  ↻ Synced · 2 pages ⌄ ┐   ← label: hover or caret inside
      │ • 周末备菜：大酱汤底，泡菜，豆腐                                        │
      │ • 买 [▢ 韩国大酱汤] 的配料                                              │
      └────────────────────────────────────────────────────────────────────────┘
```

- **At rest:** a 1 px `--line` outline, 8 px radius, drawn in the margin around the lines. The lines inside keep
  **exactly** the columns they'd have outside (bullets, nesting, text start), so the page's alignment doesn't change.
  No colour, no fill: the page stays black, white and grey (Brian `116a40ab`).
- **Hover, or the caret inside:** the outline darkens to `--ink-3`, and a small label sits on the top edge at the
  right: **"↻ Synced · {n} pages ⌄"** in 12 px `--ink-2`, or **"↻ Original · {n} pages ⌄"** on the original. At 390 the
  label shows while the caret is inside (no hover). {n} counts places, and reads "places" instead of "pages" when a page
  holds two.
- **Room for the outline and label (b21 plan: the container's own row takes no line):** the block always keeps 8 px
  above its first line and 6 px below its last, hover or not, so nothing shifts when the label appears. The outline
  runs through that space, and the label straddles the top edge on a `--bg` backing. Its box must clear the first
  line's text and the line above the block (a geometry check). Only vertical space is added; columns don't change.
- **"Only here":** when it's on one page, the label reads "↻ Synced · only here". It stays a synced block, so he can
  still copy it elsewhere later.
- **Tap the label:** a small menu, the app's `RowMenu` style:
  - **On:** each other place, as its page's title or day label ("Sun, Oct 18"), with the original marked:
    **"Books · Original"**, or **"Books · Original · in Trash"**, which opens it read-only. A place on this same page reads
    "Also on this page". Tap one to open that page at the block.
  - **The list stops at 8**, newest first, with the original always in it, then **"and 12 more"**, which opens the rest in
    the same menu. A copy on the Day template adds a day each day, and it also lists the template itself.
  - **Copy:** copies the synced block (same as selecting it and ⌘C).
  - **On a copy: Unsync here. On the original: Unsync all**, or Unsync when it's the only place (§6). While the original is
    in Trash, a copy still has Unsync here, and nothing offers Unsync all.
- **The one thing that differs by place inside the lines:** a to-do reads as a plan row only on the page that plans it,
  and carries the existing "Reference" tag everywhere else (§5). It's the same tag as any reference row, not a new look.

## 4. Putting it on another page

- **Copy, then paste** (Brian's words): select the whole synced block and ⌘C, or use Copy in its label menu or in the
  notice. Paste on an empty line on another page, or replacing whole lines → that page now shows the same block. No
  offer, no question; it simply arrives synced, as in Notion. The label on both pages now reads "2 pages".
- **On the phone, Copy from the label has to arrive synced too.** A block copy carries our own clipboard type, written during a
  copy event. B22's Copy on a to-do does this from a tap, and in the Home Screen app on a Simulator (iOS 26.4) the type reached
  iOS's Paste on another page. It's untested on a real iPhone, and for this label. As a safety, B22 also matches words alone to the
  last row copied, and this can do the same. A plain-lines result isn't acceptable.
- **Copying text inside it** (part of a line, or some lines but not the whole block) is a **plain copy**, as today.
  Only the whole block copies as synced.
- **Two copies on one page are allowed.** A paste on the page it's already on arrives synced, like any other. Typing in one
  shows in the other as he types, with his caret staying where it is, and the label reads "2 places" or more.
- **Pasting it where it can't go becomes plain lines** with today's paste rules, and no notice:
  - inside another synced block (no nesting);
  - into a task row (as today, the text only);
  - into another app (the content as plain and rich text, as any copy).
- **On a template** (`synced-blocks.md` §7):
  - **Made on the template:** each new day gets its own block, an original there, connected to nothing. The label reads
    "↻ Original · only here".
  - **A copy pasted into the template:** stays connected on every new day, one note he edits once. Each day's is a copy.
- **A to-do in a pasted copy** is a reference row there: pasting never plans anything or adds a task.
- **A page card in a pasted copy** is a link to the same page. A page keeps one parent, the original's page.
- **Undo** after the paste removes it from this place only, like any paste.

## 5. Editing

- **An edit in any place is the edit.** Typing, formatting, adding or deleting lines inside the block saves as normal
  and shows on every page that shows it.
- **When another page is open at the same time** (two tabs, or phone and desktop): it shows the new content when that
  tab becomes visible again (b21 plan §4). The refresh never moves his caret or scroll.
- **Both places edited before either saw the other** (b21 plan §2 rule 3): the second save would lose. A plain "draft
  kept" banner has no way out here, because a retry hits the same conflict. So instead, in one step:
  - the block shows the **latest** content, the version saved elsewhere;
  - **his version goes right below the block as ordinary lines**, outside the outline, so nothing he typed is lost;
  - notice: **"Changed on {page} meanwhile · your version is below it"**. No Undo: both texts are on the page, and he
    keeps, merges or deletes them by hand.
  This should be rare (one person, two devices), so it doesn't need a merge view.
- **⌘Z** undoes his own edits on the page where he made them, and the undo spreads like any edit. If another place has
  changed the block since: "Can't undo · edited since", today's rule. It never overwrites.
- **To-dos work inside, as on any page:** `[] `, `/` Task and a pasted task row all make ordinary rows.
  - **A tick or a rename** shows in every place, the day pages and Tasks, with a tick's own notice and Undo.
  - **Plan or reference is per place.** Only the page where it's planned has the plan row. Showing a block on a new day never
    plans its to-dos, and a Reference tag shows on the other places (§3).
  - **Re-planning or carrying one never removes its line from the block.** Where a plan row would leave a day, here that
    place's row only turns into a reference row, and the line stays.
- **Deleting lines inside a block shown elsewhere** is a loss on pages he isn't looking at, and the phone has no ⌘Z, so it
  gets a notice: **"Removed from 3 pages · Undo"**. Typing gets none.
- **The block's edges hold.** The earlier experiment showed lines spilling out and being pulled in, so:
  - Backspace at the start of its first line does nothing to the block, and doesn't pull that line out. The one exception:
    on a block that's empty and in only this place, it removes the block. An empty block shown elsewhere stays, because that
    would be a delete with no notice. He removes a shared block by selecting it (§6).
  - Backspace at the start of the line below it, or Delete at the end of the line above, puts the caret at the block's edge and
    moves nothing in.
  - Enter on an empty last line leaves the block, with a new line below it.
- **Empty:** if he deletes every line inside, one empty line stays inside the outline, with the placeholder "Empty
  synced block". Removing the block itself is §6.
- **A new page made inside a copy** gets the original's page as its parent, and the notice says **"Page made in {page}"**,
  so he isn't surprised where it lives. Deleting a card from one place never trashes the page. Deleting it from the shared
  lines follows today's card rule.

## 6. Unsync and delete

| He does | That place | Other places | Notice |
| --- | --- | --- | --- |
| **Deletes a copy** (select → Delete) | goes | unchanged, still synced | "Removed from this page · still on {n} pages · Undo" |
| **Unsync here**, on a copy | stays, as ordinary lines | unchanged, still synced | "Unsynced here · Undo" |
| **Unsync all**, on the original | all become ordinary lines, each page keeping them | the same | "Unsynced on {n} pages · Undo" |
| **Unsync**, on an original that's the only place | stays, as ordinary lines | none | "Unsynced · Undo" |
| **Deletes the original** | goes | stop syncing and keep their lines, as ordinary lines | "Removed · the other {n} pages keep their lines, no longer synced · Undo" |
| **Deletes an original that's the only place** | goes | none | "Deleted · Undo" |
| **The original's page goes to Trash** (a day page too, since B16) | goes with it | **stay synced with each other and editable**, and the list shows "Original · in Trash" | the Trash notice, as today |
| **Restores that page** | back as the original, with the current content | unchanged | as today |
| **A copy's page goes to Trash** | goes with it | unchanged, and their count drops by one while it's there | the Trash notice, as today |
| **Restores that page** | back, still synced. If the syncing has ended meanwhile, its lines are ordinary lines with the last shared content | unchanged | as today |

- **Unsync and delete are one action across every page, with one Undo** on the page he's looking at. Undo restores the syncing
  and every place. If a place changed since: "Can't undo · edited since", and it never overwrites.
- **No sync action changes the number of tasks.** After any of these, rows stay rows of the same task.
- **Page links inside keep working** after Unsync.
- **We never remove every copy** at any count, unlike Notion over 10 (`synced-blocks.md` §4).

## 7. What it counts as elsewhere

- **Linked from:** syncing doesn't link pages to each other. The "On" list in the label menu is how he moves between
  them. A `[[` link *inside* a synced block counts once for **each** page that shows it, because it's on each of
  those pages. Its time is when that page got the block.
- **Tags (Bumblebee `8e998433`): a tag in a synced block counts once.** A tag classifies content, and this is one
  piece of content. The Tags count goes up by 1, and a tag page lists the block once, with "↻ {n} pages", under the
  **earliest day** among the pages showing it (if no day page shows it, under the page that has shown it longest).
  Tapping it opens that place; the label's menu reaches the others. If that page stops showing it, it moves to the
  next one. Day-based reading (review, Draft my day) still sees it on every day that shows it: that's day context,
  not classification.
- **Search:** **once**, under the original, with "↻ {n} pages" on the result, so a template copy doesn't fill search with a
  hit per day. If the original is in Trash, it's under the oldest live place.
- **Reading a day** (review, Draft my day) still sees it on that day. It isn't sent to the model once per place, and a block
  with lines counts as a filled slot.
- **To-dos as a source (R2):** one row per task, however many places.
- **Export:** every place as ordinary lines. Export never loses text.
- **Rollback (B21-16):** on a build at the floor or newer, nothing changes. Below the floor, a page holding a block shows
  "Something went wrong!", and nothing is lost: going forward brings it back. It doesn't become ordinary lines, because pages
  keep no copy of them.

## 8. Waiting and failure

- **Loading:** the block's lines render with the page; there's no separate spinner.
- **Its shared record can't be read (B21-17):** pages keep no copy of the lines, so there's nothing to show. The block
  stays where it is and reads **"↻ Sync unavailable"** with **Retry**, and no lines. It never disappears silently and no
  save removes it, and the page's other lines work normally. Only a bug or a hand edit could cause this, since the record is
  read in the same transaction as the pages (Roadbuster 884fd4b2).
- **Save failed:** the editor's existing save-failed banner, nothing new.

## 9. Checks (copy of his data, 1280 and 390)

1. Select 2 bullets on a doc page → Sync → outline appears; bullets and text don't move (`check-alignment`).
   Undo → plain bullets, identical, with the same line ids.
1b. `/` Synced block → an empty block with the caret in it; Backspace removes it. Pasted on a second page and emptied: Backspace
   on either does nothing, and selecting it → Delete follows §6.
2. Copy (label menu) → paste on an empty line on today's Notes → the doc page reads "↻ Original · 2 pages", today "↻ Synced
   · 2 pages"; "On" lists the other page, with Original marked, and opens it at the block.
2a. **On the phone, in the Home Screen app:** Copy from the label, paste on another page → it arrives synced, both labels "2 pages".
2b. Paste it a second time on today → "3 places"; typing in one shows in the other with the caret unmoved.
3. Edit on today → switch to the doc page's tab → the edit is there without a reload, and the caret and scroll there
   didn't move. Same the other way.
3b. Two tabs, both edit the block before either refreshes → the second save shows the latest content in the block, its
   own version as plain lines below, and "Changed on {page} meanwhile · your version is below it". Nothing lost.
3c. Record missing (on a copy) → the block reads "↻ Sync unavailable" with Retry and no lines, the other lines still edit,
   and a save leaves the block in place.
4. A selection holding a synced block → Sync → the "can't go inside another" notice and no change. Holding a database, the
   same, until that's allowed.
5. **Tasks unchanged:** count tasks before and after Sync, a paste, Unsync, Unsync all and a delete: the same each time.
5b. A to-do inside: a tick shows in every place; only the planning page has the plan row, and others show Reference; carrying it
   or Planned for removes no line from any place.
6. Unsync here on today → today's lines are plain, the doc page reads "only here"; Undo restores "2 pages".
7. Delete a copy → "Removed from this page · still on 1 page · Undo". Other places unchanged.
7b. Delete the original with 2 copies → both keep their lines as ordinary lines, with the notice. Undo restores every place,
   still synced. Unsync all the same.
7c. Delete lines inside → "Removed from {n} pages · Undo" on the page he's on, and Undo restores them everywhere.
8. Trash the original's page → the others stay editable and list "Original · in Trash"; restore → original again, with the
   current content. Trash a copy's page → the count drops; restore → back.
8b. **The edges:** Backspace at the block's first line, Backspace on the line below, Delete on the line above, and Enter on an
   empty last line: nothing spills out or gets pulled into every page.
9. Paste into another synced block and into a task row → plain lines; copy into a plain text field outside the app → plain
   text.
9b. **Template:** made on the Day template → each new day its own, connected to nothing. A copy pasted into it → every new day
   connected, a to-do in it a reference row, and "On" stops at 8 with "and {n} more".
10. A `[[` link inside → the linked page's Linked from lists both pages. Search shows it once, with the count.
11. Rollback on a copy (B21-16): below the floor a page holding a block shows "Something went wrong!", and going forward
    brings it back with its content.
12. **Geometry:** "synced block" becomes a required row type in `check-alignment` (rows inside keep the columns they
    have outside; the outline stays in the margin; 8 px above / 6 px below; the label clears the first line's text
    and the line above, at 1280 and 390, shown by hover and by caret), and
    `align-fixtures` puts one on 2026-12-31.

## 10. Open questions

- ~~**Roadbuster:** simultaneous edits~~ **Answered** by b21 plan 1f5f28a (§2 rule 3, §4 refresh on visible); design's
  recovery for the conflict is §5 above.
- ~~**Bumblebee:** tags~~ **Decided:** a tag counts once (§7, Bumblebee `8e998433`).
- ~~**Roadbuster:** what shows when the record can't be read~~ **Answered** (Roadbuster 884fd4b2, Bumblebee c3fba8bc): §7 and
  §8 above, per B21-16 and B21-17.
- ~~**Lead:** discovery~~ **Decided (Lead `10e9e0f0`):** Brian is told once, in the release report ("select lines →
  Sync in the selection bar → copy the block to another page"), and nowhere in the app: no tip, no onboarding.
