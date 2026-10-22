# A11 · link to a line — plan for review (revision 2)

- Author: Roadbuster · revised 2026-10-22 (rev 3) · status: **plan, not built**. No code until Ratchet's #141 passes
  (task #120).
- **Rev 3 (Ratchet #141, Lead `00ff189d`, Bumblebee `7fa4d1fb`, `f9abca12`):** a renamed duplicate is a real copy (new
  refIds and a new task) and derived ids are checked for freeness (§3); the shared cut note is the only move record (§4);
  `seen` is stamped on first save and on custom headings, with a rule for entries without it (§2); task targets come
  before trash, with the B16 case stated (§2); no server pruning, browser trim only (§2a); the rollback claim is
  narrowed to what the evidence shows (§7).
- Inputs: Brian `c5c9142e` #1 ("block-level reference like Notion"); Lead `4aa0a79b`, `5a74c8cd` (rollback degradation
  accepted), `2735c328` (bounds for #98 points 2–3), `a0c0a578` (this revision); Bumblebee `961b5f0f`, `565cad22`
  (task-link rules); Jazz `docs/design/line-links-states.md` @ 173fa93 (the design source).
- **Ratchet #98 REVISE** (`fb4dae8`, `docs/reviews/a11-plan-ratchet.md`): the five points are answered in §2–§5, and
  their checks are in §8.
- Base: main b0c80ef. Save-on-leave (B25) shipped on Oct 22, so the cut-then-switch blocker is gone.
- **What changed since 8c9020b:** storage is Postgres (Supabase), so the rollback statement is about the Postgres
  workspace row (§7, verified). The resolver now has durable task and last-holder lookups (§2). The server is the only
  authority on line-id uniqueness (§3). Only whole-line cuts keep ids, and the cut note has a window (§4). Custom
  headings can be link targets (§2).

## 0. Which changes keep a line's id today

| Change | Line id | Plan |
| --- | --- | --- |
| edit, split by Enter (first half), indent/outdent, drag within the page | kept | followed |
| **task moved to another day** (row menu, review, hand-off) | new row id, **same task** | followed **by the task** (§2) |
| **cut and paste** of whole lines (same page or another page) | new id today | **kept** (§3–§4), so followed |
| **Bring to today** | a **copy**; the source line is unchanged | the link stays on the source line (not a move) |
| merged into the line above, deleted | gone | "Line removed · {last page}" (§2) |

## 1. Where a line link lives

- **The same inline node as a `[[` link**, with optional props: `{ type: "pageRef", props: { pageId, refId, lineId,
  taskId? } }`. `pageId` is the page the line was on when the link was made. `taskId` is set when the line is a task
  row.
- **The server's view:** `inlineRefs` and the `refs` projection gain optional `lineId`/`taskId`. B15 keeps one time
  per `refId`, so a line link is one reference with its own time, as now.
- **Not in a task title** (unchanged from rev 1, Jazz agreed): the server refuses a `pageRef` in a task row, so pasting
  a line link there inserts the line's words as text, as a page link does.

## 2. Resolving a link: one pure function, every reader uses it (Ratchet 1, 4, 5)

`resolveLine(ws, { pageId, lineId, taskId? }) → { state, pageId, blockId, words }` in `page-refs.ts`. The chip, the
jump, the plain URL and Linked from all call it, so they can't disagree.

**Two durable lookups it relies on** (no format change; both live in the JSON document):

- **A line's last holder.** `save-editor` already copies every block of the page's previous projection into
  `editorBlockMetadata` and never prunes it. A11 adds two things (Ratchet #141):
  - **Every save also writes an entry for each block and custom heading of the *new* projection, stamped `seen: <this
    save's revision>`.** So a line gets its stamp the first time it's saved, not one save later, and a custom heading
    gets one too (as `heading:<id>`, beside its `[[` refs and #8's role). A block still on the page keeps getting a new
    `seen`, and a removed one keeps the revision of the last save that had it.
  - **Live holder** = the page whose current projection has the id. **Last holder** = the page whose entry for it has
    the highest `seen`. **Entries without `seen`** (written by an older build, §7) rank below any with one. Among
    those, the link's own `pageId` wins if it has an entry, then page id order. This also gives a removed line's
    `taskId` (it's on the `NoteBlock`).
- **A task's done day.** `Task` gains `doneOn: LocalDate | null`, set by every path that marks it done (the
  `task-status` command and the editor tick) and cleared when it's reopened or cancelled. Tasks done before A11 have no
  `doneOn`. For those it's derived as the latest `included` placement date, else `plannedOn`, else `lastPlannedOn`.

**Order:**

1. **Which task, if any:** the link's `taskId`; else the URL's `task=` (§5); else, if `lineId` is a task row on its live
   holder, that row's task; else the `taskId` on its last-holder metadata entry. A task found this way is followed even
   after every row the link was made on has gone (Ratchet 1: "not merely while the original history row exists").
2. **A task:** the **target is chosen first, and trash applies after** (Ratchet #141, Bumblebee `f9abca12`):
   1. **Open and planned:** the page of its `plannedOn` day, if it has a row for the task.
   2. **Done:** the page of its `doneOn` day, if it has a row (Bumblebee).
   3. Otherwise (no plan day, i.e. Not today or paused, or no row there): **the newest live row**. That's daily pages by
      date, newest first, then document pages by the highest `seen` of the row's block, then page id. Never workspace
      array order (Ratchet 1). If **only trashed rows** exist → **trashed**, naming the newest trashed page by the same
      order.
   4. Two rows for the task on one page (rare): the first in document order.
   → **live**, or **moved** when that page isn't `pageId`. A cancelled task resolves like a done one, using its last
   included day.
   - **Day pages can't be trashed today** (A4 is document pages only), so a plan or done target is never trashed now.
     **When B16 (deleting a day) lands:** a trashed plan or done day shows **trashed** for that day, never a silent jump
     to an older row, because that's where he last put the task. Stated now so B16 doesn't decide it by accident.
   - **Examples:** only trashed rows → "trashed · {newest trashed page}". Plan day trashed while a history row is live
     (only possible after B16) → trashed for the plan day, not the history row.
3. **Not a task:** the live holder of `lineId`, which is a block **or a custom heading** (a `Section` whose kind is
   `custom`; template role headings are never targets, Ratchet 5) → **live**, or **moved** when it isn't `pageId`.
4. **Holder state applies even when the line is found (Ratchet 4):** if the resolved page is trashed → **trashed**
   (chip and jump both go there, with Jazz's trashed chip). A restore needs nothing new.
5. **Gone:** no live holder → **removed**, naming the **last holder** from the metadata (A→B→delete says "Line removed ·
   B" and opens B). If the last holder is trashed → **trashed**. With no metadata (pruned, §2a, or never seen) → the
   link's or URL's own page, `pageId`, opened at the top with "That line was removed" (Jazz `569d9180`).
6. **Not found** only when that page doesn't exist either.

**Words:** from the resolved block's projected `NoteBlock` text, or the section title for a heading. Always the current
projection, never stored editor JSON or metadata (Ratchet 5). A removed line shows no words, just the state.

## 2a. How big the retained metadata gets, and what the browser gets (Lead `109312d3`, Bumblebee `0392b629`)

- **Today, before A11:** `editorBlockMetadata` is already never pruned, and it holds a copy of **every block a page has
  ever had** (each save copies the whole previous projection), live ones included. **It goes to the browser in full**:
  B26's `forBrowser` drops only receipts and the undo copy. The browser reads one thing from it, the `paste:` records
  (`page-editor.tsx` "first made"). A11 adds one number (`seen`) per entry. So the growth is pre-existing, and A11
  bounds what the browser gets.
- **Server: nothing is pruned (Ratchet #141, Bumblebee `7fa4d1fb`).** Entries keep other jobs: `wasBrought` uses them
  so a Bring-to-today line he deleted isn't offered again, and B15/A9a reuse their times on Undo and moves. So A11 drops
  no entry. Server-side growth stays what it is today, roughly the text he has ever written, in one row. That's
  measured in §8, and it's a separate decision if it ever matters.
- **Browser, trimmed like B26:** `forBrowser` sends `paste:` records and **only** the removed-line entries that a line
  link or URL points at, slimmed to `{ id, seen, taskId? }`. That's what `resolveLine` needs on the client. Everything
  else stays on the server. The load size stays at today's ~49 KB plus a few bytes per line link.
- **What the trim costs:** none for links inside the app. A URL he pasted outside Daythread, to a line later deleted, is
  resolved by the server when he opens it (the jump asks the server), so it still finds the last holder.
- **Checks:** the browser payload carries no metadata beyond `paste:` records and the linked removed-line stubs; payload
  size before and after on a copy of his data; the server row's metadata size on that copy; Bring to today still not
  re-offered for a deleted copy; Undo two saves later still restores B15 card times and `[[` link times.

## 3. The server is the only authority on line-id uniqueness (Ratchet 2, Lead 2735c328)

- **Rule, in `save-editor`, under the workspace lock:** if a block id (or custom-heading id) in the incoming document is
  **already live on another page**, trashed pages included, the server gives it a **new id** before projecting. The page
  that already holds the id keeps it, so the first saver wins.
- **The new id is derived and checked:** candidate *n* = `sha256(oldId + pageId + n)` as a UUID, for n = 0, 1, 2…. The
  first candidate that is **free** (not live on any other page, and not used anywhere in the incoming document) is
  taken, all in the same locked pass (Ratchet #141: A holds x; B's x becomes d; d is cut to C; B's old draft saves x
  again and would get d again, so it gets the next free candidate). A client that misses the rename and saves again gets
  the same answer, so nothing flips back and forth.
- **A renamed block becomes a real copy, not a partial move (Ratchet #141 ①):**
  - each `pageRef` inside it gets a derived new `refId` (same scheme), so it's a new reference with its own B15 time;
  - **a renamed task row becomes a new task**: its `taskId` prop becomes `editor-task:<new id>` (role `reference`, no
    plan date), exactly what the paste handler gives a copy today, and the normal create path makes the task. The
    original task stays with the original row.
  - So "source Undo after a move" brings the line back as a **copy** (a new task, if it was a task row), and the moved
    line keeps the identity. That's honest: the line exists twice, the identity once.
- **The save reply carries `renamed: { blocks: { old: new }, refs: { old: new }, tasks: { old: new } }`.** The editor
  applies it to its own nodes (`setNodeMarkup` on the block container's `id` and the inline nodes' props), outside Undo
  history, and restashes the draft. A link to the old id now resolves to wherever the original lives, which is the
  point.
- **What it settles:**
  - A two-tab paste race, a delayed source save, or a reloaded source draft: whichever saves second gets a new id. There
    are never two lines with one id, and no client-side snapshot check (rev 1's `latestWorkspace` check is dropped).
  - **Source Undo after a move** brings the line back, and the server renames it, because the moved line is live
    elsewhere (Lead). The link keeps following the moved line.
  - A failed source save: the line stays on the source with its id, and the destination's copy is renamed when it
    saves. That's an honest **copy**, and the link stays on the source. Rev 1's "never on two pages" claim is
    withdrawn. The text can appear on both pages; the identity can't.
- **Task rows that aren't renamed:** a task's identity is its `taskId`, and tasks legitimately have rows on several
  pages (history rows). A cut-and-paste **move** keeps its `taskId`, as today. A client-side **copy** already gets a new
  task from the paste handler. Only a server rename turns a kept `taskId` into a copy (above).
- **Size:** the rename pass, plus the reply field and the editor applying it, is about ½ day with tests.

## 4. Cut and paste keeps ids only for whole lines, once, within 2 minutes (Ratchet 3, Lead 2735c328)

Our cut already writes the blocks to our clipboard type with `cut: true` and a token, and mirrors them to
`localStorage` (`daythread:cut:<token>`). The paste handler already treats a matching note as a move (`moving`), and
then gives every block a new id. The change:

1. **Only wholly removed blocks are candidates.** A selection cut's first and last blocks are partial when the cut
   started or ended inside them. `getSelectionCutBlocks` reports `blockCutAtStart`/`blockCutAtEnd`, and **those get fresh
   ids**, as do partial task titles (already turned into paragraphs). Whole blocks keep their ids, nested children
   included. A handle selection (whole rows) keeps all of them.
2. **The note gets a time and is consumed once.** The note is `{ blocks, at, token }`. A paste is a move only if
   `now − at ≤ 2 min` **and the note is still in `localStorage`**. That shared note is the one record of "not yet
   pasted"; this tab's in-memory token counts only when `localStorage` is unavailable. The first such paste removes the
   note. An expired, reused or missing note pastes as a **copy**, with fresh block ids, fresh `[[` refIds and new tasks.
   So the original tab's stale token is a copy, not a second move (Ratchet #141 ①).
3. **Cross-tab races left:** two tabs pasting within the same moment can both see the note. The server then renames
   the second save into a real copy (§3), which is the right result. No cross-tab locking.
4. **On cut, save the source page right away** (`registerEditorFlush`), now that save-on-leave has shipped, so the
   source normally saves first.
5. External clipboard behaviour is unchanged: `text/plain` and `text/html` are written as now.

## 5. Copy, paste and the URL

- **Copy link to line** (Jazz §1): in the row menu (⌘/ on any line), in the task ⋯, and in the selection bar when exactly
  one line is selected. It writes `application/x-daythread-line` = `{ pageId, lineId, taskId? }` and `text/plain` = the
  URL **`/pages?page=<pageId>&block=<lineId>[&task=<taskId>]`**. The notice reads "Link to line copied". If the
  clipboard write fails, it says "Couldn't copy" and never announces success (Ratchet §7).
- **Paste:** `pasteHandler` checks the line type first, then a `text/plain` that is **this app's own origin** with
  `page=` and `block=`, and inserts a line link at the caret. Both checks run before A2's link paste, so an in-app URL
  never becomes a link card. Other hosts, unknown params and malformed URLs paste as they do today.
- **Opening the URL** (from another app, or a reload): when the block isn't on the URL's page, the `?block=` jump calls a
  small server function that runs the same `resolveLine` on the full workspace. The browser only carries metadata stubs
  for lines linked inside the app (§2a), so a plain URL still lands exactly where the chip would, last holder included.
  A removed line opens its last holder, at the top, with "That line was removed".

## 6. Opening, Linked from, trash

- **Tap:** go to the resolved page with `block=`, reusing the tag jump (scroll, tint, nothing focused). The scroll
  position becomes Jazz's "a third from the top" and clears B20's bottom fade at 390. A second tap on the same page
  jumps again.
- **Linked from:** a line link counts for its **resolved** page (live or last holder), deduplicated per linking page as
  now. The B15 time is the link's own.
- **Trash:** per §2 step 4, from the same resolved holder as the chip and the jump.

## 7. Format and rollback, on Postgres (verified)

- **No schema or migration.** Storage is one JSON workspace row. Everything new is optional JSON: the `pageRef` props,
  `refs[].lineId/taskId`, `editorBlockMetadata[].seen`, `Task.doneOn` and the save reply's `renamedIds`. (Local SQLite
  dev storage needs a nullable `doneOn` column, added the existing way, layout 7. Production doesn't use SQLite.)
- **Rollback = deploy the previous build. Verified** on a throwaway schema (`daythread_check_a11`) with the current main
  b0c80ef standing in as the rollback build (`scripts/exp-a11-pg-seed.ts`, `tests/evidence/a11-plan-pg/`):
  - A11-shaped data (a line link, a task line link, `doneOn`, a `seen` stamp) **opens with no errors**. The links render
    as page links ("Target page", "Today").
  - The old build's first save of that page **drops `lineId` and `taskId` from both links**: their props are then exactly
    `newTitle+pageId+refId`, read from the saved editor JSON. Both links remain as page links, as Lead accepted in
    `5a74c8cd`. (The check's earlier `taskIdPropAfterOldSave: true` was the task **row's** own `taskId`, a different
    field. The check now reads the links' props directly.) Lead repeated the links part on Supabase with the same result. Rolling forward again doesn't bring the line part back.
    The rollback note to Brian says so, plus "reload".
  - **`seen`, narrowed (Ratchet #141 ②):** the old build keeps `doneOn`. It keeps `seen` **only on entries for lines
    already removed** (the probe keeps 7). Its save **rewrites the entries for the page's live blocks without `seen`**
    (all 3 lost it). So after rolling forward:
    - live lines get `seen` again at the A11 build's first save of that page;
    - lines removed **while rolled back** have entries without `seen`. The resolver ranks those below stamped ones
      (§2), so their last holder can be imprecise only when the same id has entries on several pages, which takes a
      move during the rollback window. The rollback note can say that line links made before the rollback may point at
      an older page for lines moved and deleted while it was rolled back.
  - Schemas dropped afterwards. Lead can repeat this on Supabase, on a copy of his row, as for #6.

## 8. Checks before the candidate (copy of his data, 1280 / 390 / 390 touch)

Jazz §7 checks 1–10, plus Ratchet's lists, each verified after a **reload** (ids, refIds, Linked from times):

- **Tasks (R1):** past → today (history row stays), today → tomorrow (source row removed), another reschedule, done
  (lands on `doneOn`), done before A11 (derived day), paused / Not today (most recent row). Open each original plain URL
  **and** chip in a fresh view. Chip, jump, URL and Linked from agree.
- **Uniqueness (R2):** a two-tab paste race; a failed source save; source Undo after the destination saved; a same-page
  move before autosave; a reloaded source draft, then edits on both pages. No two lines share an id, the renamed side
  reports `renamedIds`, and the editor applies them.
- **Cuts (R3):** partial first/last line, nested selection, whole-line cut, paste twice (including in the original tab
  and across tabs), expired note (> 2 min), Undo before paste. Copies get fresh block ids and refIds, and whole moves
  keep ids and B15 times.
- **Removed and trashed (R4):** A→B→delete ("Line removed · B", opens B); A→B→trash B→restore B; A trashed while B
  is live; the task's page trashed. Chip text, jump and Linked from use the same holder.
- **Headings (R5):** copy a custom-heading link; rename it; move it; delete it; open its URL. Template headings offer no
  "Copy link to line".
- **Also:** Bring to today leaves the link on the source line; merging the line into the one above gives "Line removed";
  pasting into a task title gives text; an in-app URL on an empty line becomes a line link, not a card; external hosts,
  unknown params and malformed URLs are untouched; a failed clipboard write never says "copied"; the long excerpt at 390;
  keyboard activation and Back.
- **Rollback:** the §7 round trip, rerun on the candidate's own build.
- **Units:** every branch of `resolveLine`, including the tie-breaks; the rename rule in `save-editor` (deterministic,
  first saver wins, trashed holders count); `doneOn` set and cleared on every path.
- Unchanged from A12/B25: `stable-check`, `actions-check`, and the caret check from today.

## 9. Size

**About one build round.** The resolver with both lookups is about 1 day; the rename rule and `renamedIds` about ½ day;
cut windows and whole-line ids about ½ day; the chip, three entry points, paste, URL jump and Linked from about 1 day.
The checks above come on top, with the existing evidence scripts as the base.

## 10. For review

- **Ratchet:** §2 (the two lookups, the order, the tie-breaks), §3 (the rename rule and its reply), §4 (whole lines
  only, the window, cross-tab), §7 (the rollback evidence).
- **Jazz:** no state changes from 173fa93, except that "Line removed · {page}" now names the **last** page the line was
  on (A→B→delete says B), which is what the "deleted" row of your states table already says ("Line removed · {last page}").
- **Bumblebee:** the done day comes from `doneOn`, derived for tasks done before A11 (§2).
