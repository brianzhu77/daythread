# A7 · Weave pages: states and layout

Status: **draft 3 for the A7 engineering plan** (matches plan 0c8baa0; Jazz review 0505e257) (Jazz, 2026-10-23; draft 2 takes Bumblebee's calls 0869f63e: task lines in, no correction line). Behaviour comes from Bumblebee's brief
`docs/plan/a7-weave-brief.md` (main b3744d7), accepted as the basis by the Lead (98046c4c) with his three notes. Where this
file and the brief disagree, the brief wins and this file is fixed. A7's build waits on the Oct 27 check and on the offline
run (brief §3), and the brief itself is still Brian's call, so these screens are for planning, not final.

Reused from `docs/design/v05-morning-and-weave.md` §2 (rev 2): the Pages placement (option A, Brian a4fd5686), the
read-only page, "Copy to my pages" and "You have a copy ›", and the Weave mark. v05 §1 (morning card) is superseded by A8.
Dropped from v05: the amber "May be out of date" band (lines are live now, see §4) and "fills in after you plan or review"
(review never runs, brief §1).

Line links, the jump and the line states are A11's: `docs/design/line-links-states.md` (main 057488b).

---

## 1. Where Weave lives

- **Phone, Pages tab:** two pills under the title, **Mine · Weave**. Mine is the current Pages screen unchanged (tree, In your
  days, Trash). Weave is the list in §2. The pill choice is kept for the session, so Back from a Weave page returns to Weave.
- **Desktop sidebar:** a **Weave** group under the Pages tree, before Trash: up to 3 topics, newest update first, then
  "N more" opening the full list (the same pattern as the day pages in the sidebar, B20). The group label opens the list.
- **No sixth tab.** The bar already holds Today, Tasks, Calendar, Pages, Tags and `+`.
- **New since he last looked:** a 6 px `--blue` dot after "Weave" on the pill and the sidebar label, when a run has made or
  changed a page since he last opened the list. Opening the list clears it. No count and no badge on the Pages tab: nothing
  here needs doing.

## 2. The Weave list

Flat, newest update first. Each row:

- the **Weave mark** (woven-lines icon, `--ink-2`), the **title** (model-written) in ink, semibold, as page rows are;
- under it in `--ink-3`, 13 px: **"6 lines · 3 days · updated today"** ("updated Oct 24" after the day it changed).

One status line above the rows, `--ink-3`, 13 px, never more than one:

| State | Status line | Rows |
|---|---|---|
| **Before the first run** | "Weave gathers what you write about one topic across days. It updates when you finish your morning plan." | none |
| **A run made nothing** | "Nothing to gather yet · a topic gets a page once you write about it on 2 days" | none |
| **Running** (he opens it right after Done) | "Updating…" | the previous pages, unchanged |
| **Updated** | "Updated today" | the pages |
| **Run failed, busy or stuck** | "Couldn't update today · will try at the next plan" | the previous pages, unchanged |
| **Too much to gather** (over the run's size cap, plan §2) | "Too much to gather today · nothing was updated" | the previous pages, unchanged |
| **No run today yet** (hand-off not done) | "Updated Oct 24" (the last run's day) | the pages |

- **No Retry and no Update button** (brief §2.2: no button in v1). The failure line is plain text, not a link.
- A run counts as stuck after 5 minutes, then shows as failed (the standing stuck rule, server-side).
- The morning card and the day thread show **nothing** about Weave: no "Weave updated", no toast. He finds it in Pages.

## 3. A Weave page

Top to bottom:

1. **Title band:** the Weave mark and the title on a `--fill-soft` band the width of the text column, radius
   `--app-radius-sm`. Under the title, `--ink-3`, 13 px: **"Weave · from 3 days · updated today"**. His pages never have
   this band, so a Weave page can't be mistaken for his.
2. **Summary line:** one line in `--ink-2`, regular weight, with a small "Written by Weave" label after it in `--ink-3`. It's
   the only model-written text besides the title. It shows only while every line it cites is live (Lead 98046c4c note 3);
   otherwise it is hidden, with no placeholder, until the next run.
3. **The lines, grouped by day, newest day first.** Each group has a date heading ("Thu, Oct 18", 13 px, `--ink-3`, a link to
   that day). Under it, his lines as he wrote them:
   - **live words** from the A11 projection, in ink, the same size and inline formatting as in his page; tags and links render
     as they do on his page;
   - a line from one of his own pages (not a day) gets the page name after it in `--ink-3` ("· Recipes notes");
   - a gathered **page card or link card** (his Oct 18 recipe cards, Lead dry run cfbbab8) shows as a **one-line page link**:
     the page icon and the page's title, the same as an inline page link, not the full card with its preview. Tapping it opens
     **that page**, not the day the card sits on, since the page is what the line is about. A trashed page's card follows
     §4 (hidden while trashed);
   - **tap or click a line** to open where he wrote it, with the A11 jump (a third from the top of the visible area, tinted);
   - a **task line** is gathered too (Bumblebee 0869f63e: his recurring topics are mostly tasks, e.g. the `#rewind` ones). It
     shows as **its words plus a muted status**, with **no checkbox**: "open · planned Oct 23", "done · Oct 22", "cancelled".
     Open tasks are in ink; done and cancelled ones use the app's done style (`--ink-3`, done struck through), so done reads the
     same everywhere. The status's day comes from the A11 task rule (plan day, then done day). Tapping it uses the same A11
     jump to the task's row, where he can tick it, so there's no dead tap.
4. **Copy to my pages** (the one primary button), or **You have a copy ›** after copying (§5).

- **Read-only:** no cursor, no `/` menu, no selection bar, no drag handles, no ⋯ on rows. Text can be selected and copied with
  the system copy (plain text, the Notion model).
- **Page ⋯ menu:** only "Copy link to page". No Rename, Move, Delete or Trash, since Weave pages aren't his to manage.
- **Linked from** doesn't show, because no page of his links here in v1 (brief §2.5: Weave doesn't link into the day thread).

## 4. Lines changing under a page

Because the lines are live links, his edits show straight away, with no "out of date" state:

| What he did | The Weave page |
|---|---|
| Edited a line | shows the new words at once |
| Deleted a line, or cut it | the line is **gone** from the page. No "Line not found" here (brief §2.1) |
| Trashed the page holding lines | those lines are **hidden** while it's in the trash, and come back on Restore |
| A day group lost all its lines | the date heading goes too |
| Every line gone | the topic is **hidden** from the list straight away (plan 0c8baa0 §3); an open page or old link shows §7's removed screen |
| A cited line gone | the summary line hides (§3.2) |
| Moved a task to another day | the task line follows it into that day's group (A11 task follow) |

The counts in the list row ("6 lines · 3 days") are live too, so the list never contradicts the page.

## 5. Copy to my pages

- **Tap:** makes a normal page at the **top level of Mine**, titled like the Weave page, without the band or the mark. It holds
  the same day headings and his lines as **his own editable text**. **No summary line**: in his page it would become
  unmarked model text among his words (plan §4). Each day heading is a
  link to that day, so every line keeps a way back to where he wrote it. The receipt reads **"Copied to your pages · Open"**
  (the standing receipt pattern).
- **Why day links, not a link per line:** an A11 chip after every line would show each line's words twice, and a small inline
  "jump" mark would be a new kind of inline element. Day links keep the copy calm and add nothing new. *If Bumblebee needs
  per-line links, I'd use a trailing ↳ link with no words, as a second step.*
- **Then:** the Weave page shows **You have a copy ›** in place of the button, and it opens the copy.
- **Copy in the trash:** "Your copy is in the trash ›" opens it on the trashed-page screen with Restore (A4).
  **Deleted forever, or the copy undone with ⌘Z:** the button is back. The copy's state is read live, never stored.
- **Copy failed** (save error): "Couldn't copy · nothing was added" under the button, and the button stays. Never "Copied".
- The copy never updates, and Weave never touches it again (brief §2.3). The Weave page doesn't say "N lines added since".
- **Topic dropped later:** the copy is his and stays.

## 6. Corrections

- **Words:** nothing to design. He edits his line, and the page follows (§4).
- **Grouping or naming:** he writes it in his own words in today's thread ("that's not a recipe"), and the next run follows
  (brief §2.4). Nothing on the page asks for this. The before-first-run line doesn't explain it either. It's a habit Brian
  already has (c377e316), and a hint would be clutter.
- **No "changed after your note" line in v1** (Bumblebee 0869f63e). He sees a correction landed by opening the page. If
  corrections don't land, the success check (brief §4) shows it, and it's added then.

## 7. Removed or missing pages

- **The run dropped a topic, or every line of it is gone:** its page leaves the list. Opening an old link (or Back into it) shows the Weave screen with
  "This Weave page was removed at the last update" and a link "See Weave", never a blank page.
- **Rebuild** (brief §2.4): no special screen. The list shows "Updating…" and then the new pages.
- **Before the first run, opening /pages?weave:** the list with the before-first-run line.

## 8. Notes

1. **Task lines are in** (decided, Bumblebee 0869f63e): words plus a muted status, no control (§3).
2. **Lines under a tag only:** a tagged line whose topic page exists shows on both the Tags list and Weave. That's fine, and
   it's the Lead's note 2: the check is whether Weave also shows what Tags can't.
3. **Empty and one-character lines** are never gathered (brief §5).

## 9. Checks (for Ratchet and the build check, 1280 and 390, on a copy of his data)

1. Before any run: Pages › Weave shows the before-first-run line, no rows. No dot.
2. After Done on the morning card: the list shows "Updating…", then the pages, newest first, with live counts. The dot shows
   on the pill and the sidebar label until he opens the list. Nothing appears on the day thread or the morning card.
3. A failed run (fake model error): "Couldn't update today · will try at the next plan", the previous pages unchanged,
   no button. A second Done the same day doesn't start a second run.
4. A Weave page: band and mark, summary with "Written by Weave", lines grouped by day, newest first. No cursor, no `/`, no
   handles, and ⋯ offers only "Copy link to page". A gathered page card shows as a one-line page link and opens that page.
   A task line shows its words and "open · planned …" / "done · …" with no
   checkbox; tapping it lands on the task's row, where ticking it works, and the Weave status reads "done · {today}" after.
5. Tap a line: opens its day with the line a third from the top and tinted (A11 jump). Back returns to the Weave page.
6. Edit a gathered line on its day, then return: the new words show, with no reload needed past the normal page load. Delete
   it: the line is gone, the counts drop, and the summary hides if it cited that line.
7. Trash the page holding a gathered line: the line is hidden. Restore: it's back.
8. Copy to my pages: the receipt "Copied to your pages · Open"; the copy is at the top level of Mine, editable, with day
   headings linking to the days; the Weave page shows "You have a copy ›". Trash the copy: "Your copy is in the trash ›".
9. Old link to a dropped topic: "This Weave page was removed at the last update · See Weave".
10. Geometry: the Weave list row, the band and a gathered line pass `check-alignment` as required types, with a fixture on
    2026-12-31 (the standing alignment rule). At 390, the last line clears the tab bar's fade (B20).
