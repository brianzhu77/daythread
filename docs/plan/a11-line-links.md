# A11 · link to a line — plan for review

- Author: Roadbuster · 2026-10-21 · status: **plan, not built**. No code until Ratchet's pre-review.
- Inputs: Brian `c5c9142e` #1 (Oct 18, "block-level reference like Notion"); Lead `4aa0a79b` (layout 6, moves,
  rollback, B15/Linked from); Bumblebee `961b5f0f` (follow the line; a removed line opens its last page and says so);
  Jazz `docs/design/line-links-states.md` @ 0cf83e7 (the design source).
- Base: main 0cf83e7.

## 0. Two findings that shape the plan

1. **It stays layout 6, with no migration: verified.** A link with an extra `lineId` prop was saved through
   `save-editor` on a copy of his data, then opened in the current build (main, which is also the rollback build):
   - it renders as an ordinary page link, with no errors;
   - the first save of that page in the current build **drops `lineId`** (BlockNote keeps only known props). So after
     a rollback, line links on any page he edits become page links to the line's page. Nothing he wrote is lost.
   Evidence: `scripts/exp-line-link-seed.ts` and `tests/evidence/a11-plan/old-build.{mjs,txt}`.
2. **Which moves keep a line's id today** (Jazz §5, Lead), read from the code:

   | Change | Line id | Plan |
   | --- | --- | --- |
   | edit, split by Enter (first half), indent/outdent, drag within the page | kept | followed |
   | **task moved to another day** (row menu, review, hand-off, carry-over) | **new row id**, same task | followed **by the task** (§2) |
   | **cut and paste** (same page or another page) | **new id** (the paste gives every block a fresh id) | **kept from now on** (§3), so followed |
   | **Bring to today** | it's a **copy**; the source line is unchanged | the link stays on the source line (not a move) |
   | merged into the line above (Backspace at its start), deleted | gone | "Line removed · {last page}" |

   So "follow the line" needs two things beyond the id: the task's identity for task rows, and keeping ids on
   cut-and-paste moves. Jazz's §5 lists Bring to today as a move. It isn't one: it copies the line, so the link
   rightly stays on the original.

## 1. Where a line link lives

- **The same inline node as a `[[` link**, with optional props: `{ type: "pageRef", props: { pageId, refId,
  lineId, taskId? } }`. `pageId` is the page the line was on when the link was made, which is the fallback.
  `taskId` is set when the line is a task row.
- **The server's view:** `inlineRefs` and the `refs` projection gain optional `lineId`/`taskId`. B15 keeps one time
  per `refId`, so a line link is one reference with its own time (when it was made), as now.
- **Where it can go:** the same lines as a page link. **Not in a task title.** The server refuses a `pageRef` in a
  task row (A9a §1, `A task row cannot hold a page link`), so pasting a line link into a task title inserts the
  line's words as text, as a page link does there. **@Jazz, your §2 says "a link inside the title, as page links
  are", but page links aren't allowed there today.** I recommend text, to keep one rule.

## 2. Resolving a link (one pure function, every reader uses it)

`resolveLine(ws, ref) → { state, pageId, blockId, words }`, in `page-refs.ts`. **A task line resolves to its task,
not to the row** (Ratchet `8acaaf61`, Jazz `a5d1ba2b`). Moving a task from a past day leaves a history row on that
day (`plan-task` keeps it, workspace.ts 1191), so following the row id would keep jumping to Oct 18. Order:

1. **Which task, if any:** the link's `taskId`; otherwise, if block `lineId` (on `pageId` or any page) is a task row,
   that row's task. The plain URL (page + block) goes through the same step, so the URL and the in-app chip always
   land in the same place without `taskId` in the URL.
2. **A task:** its row on the page of the day it's planned for now. If it has no plan day (or that page has no row
   for it), the row the link was made to if it still exists, else any page's row for it → **live** (moved when not on
   `pageId`). A done or cancelled task still resolves.
3. **Not a task:** the block `lineId` on page `pageId`, else on any other page (a cut-and-paste move, §3) → **live** /
   **moved**.
4. Otherwise, if page `pageId` exists → **removed** ("Line removed · {page}"), and if that page is in the trash →
   **trashed**.
5. Otherwise → **not found**.

The chip's words come from the resolved block's `NoteBlock` text (live, nothing stored), and its "where" from the
resolved page (day label or title).

## 3. Keeping ids on cut-and-paste moves (Bumblebee `043938fe`, Lead)

This is how he moves a line between pages today, so it has to keep the id. **No new clipboard data is needed.** Our
own cut already leaves a note: `copyBlocks` writes the blocks with `cut: true` and a token to our clipboard type, and
also to `localStorage` (`daythread:cut:<token>`). The paste handler already recognizes a move from it (`moving`). The
one thing that loses the id is that `fresh()` gives every pasted block a new id even when `moving` is set. The plan:

1. **On cut, save the source page right away** (the existing `registerEditorFlush` save, not the 450ms timer). Today
   a cut followed by a quick switch to another page leaves the source's deletion unsaved: the editor unmounts and only
   stashes the draft. So the line would still exist on the old page on the server.
2. **On a move paste, keep each block's id** if no current page in the workspace still holds that id. If one does (the
   source's save hasn't landed, or failed), that block gets a new id, as today, and a link to it reads "Line removed".
   It's never on two pages.
3. **Only for a cut.** A copy always gets new ids, or two lines would share one. Lead's "short time window" is already
   in place: a cut can be pasted as a move once, and its note is removed then. A cut from another tab works through
   the `localStorage` note.
- This is the same approach as the parked A9b note, already built: the clipboard isn't changed, so other apps are
  unaffected.
- **@Ratchet: the risk to check** is anything else that assumes a pasted block always has a new id (B15 card times
  are already kept on a move; A12 row metadata; capture Undo's by-id `appliedSnapshot`).
- **Size:** about half a day, including a two-page check.

## 4. Copy and paste

- **Copy link to line** (Jazz §1):
  - in the row menu, which ⌘/ now opens on **any** line, not only task rows;
  - in the task ⋯;
  - in the selection bar when exactly one line is selected.
  It writes `application/x-daythread-line` = `{ pageId, lineId, taskId? }` and `text/plain` = the URL
  `/pages?page=<pageId>&block=<lineId>` (one form for days and pages, already routed). The notice reads "Link to line
  copied".
- **Paste:** `pasteHandler` checks the line type first, then a `text/plain` that's this app's URL with `block=`, and
  inserts a line link where the caret is, as `[[` does. Both checks run **before** A2's link paste, so an in-app URL
  never becomes a link card.
- **Opening from another app (the URL):** the existing `?block=` jump. When the block isn't on that page, the editor
  asks the resolver (§2) and goes to where it is now. A removed line opens the page at the top with "That line was
  removed".

## 5. Opening, Linked from, trash

- **Tap:** navigate to the resolved page with `block=`, reusing the tag jump (scroll, tint, nothing focused). Jazz's
  "a third from the top" and B20's bottom fade at 390 need one change in the jump's scroll position.
- **Linked from (Jazz §6):** a line link counts for the page its line is on **now** (the resolver), not the stored
  `pageId`. So `referencesTo` resolves line links and deduplicates per linking page as before. B15 times are unchanged
  (the time the link was made).
- **Trash:** a trashed target page gives the trashed chip. Restore needs nothing new.

## 6. Rollback

No layout bump and no script. Rolling back means deploying the previous build, as in finding 0.1: line links show as
page links to the page they were made on, and each page he edits in the old build drops their line part. **Rolling
forward again doesn't bring the line part back.** If that loss isn't acceptable, a small rollback script could hold
`lineId`/`taskId` per `refId`, as A9a did, at about +½ day. I don't recommend it for a link he can recreate in two
taps.

## 7. Checks before the candidate (copy of his data, 1280 and 390)

Jazz §7 checks 1–10, plus:
- a task moved from a **past** day (its history row stays there) and from today: the chip and the URL both land on
  the day it's planned now;
- cut on Oct 18, paste on today (also after switching pages at once, and from another tab): the chip follows it (§3); the line is never on two pages; a cut whose source save failed pastes with a new id;
- Bring to today of a linked line: the link stays on Oct 18's line;
- merge a linked line into the one above → "Line removed";
- pasting into a task title gives text (§1);
- an in-app URL pasted on an empty line becomes a line link, not a link card;
- the URL opened after the line moved lands on its new page;
- rollback: on a copy, the current build shows the links as page links with no errors;
- unit tests for `resolveLine` (each branch of §2) and for the Linked from move.

## 8. Size

**About one build round, smaller than A9a**: no format, migration or rollback script. Most of it is the resolver,
the chip, three entry points, the paste branch, the jump fallback and Linked from. The cut-and-paste ids (§3, about half a day)
are the only part touching existing behaviour.

## 9. For review

- **Ratchet:** §3 (keeping ids on moves) and its by-id lookups; the resolver order (§2); Linked from following a
  move; the rollback trade-off (§6).
- **Jazz:** the task-title case (§1); Bring to today isn't a move (§0.2).
